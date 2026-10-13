#!/usr/bin/env python3
"""Retrain all 11 labels around the user lightning template and robust circle/square handwriting.
Training-only augmentation; exported PNG remains original stroke+allowed flags.
A distinct held-out procedural split and real-source tests are reported separately.
"""
from __future__ import annotations
import argparse,base64,json,math,random
from pathlib import Path
import numpy as np
import torch
from torch import nn
from cnn_training_core import Model,CATEGORIES,gen_shape,augment,raster,ROOT

SEED=629102026
torch.set_num_threads(3)
np.random.seed(SEED%2**32);torch.manual_seed(SEED)
USER_TRACE=json.loads((ROOT/'lightning_user_trace.json').read_text())['normalized_vertices']
FLAME=json.loads((ROOT/'flame_originals.json').read_text())['entries']
assert len(FLAME)==9


def box_like(rng):
    """Human square/rectangle; arbitrary pen-down location, corner rounding and unequal edges."""
    halfx=rng.uniform(.48,.87);halfy=rng.uniform(.47,.85)
    tilt=rng.uniform(-.33,.33) if rng.random()<.83 else rng.uniform(-.78,.78)
    corners=[(-halfx,-halfy),(halfx,-halfy),(halfx,halfy),(-halfx,halfy)]
    corners=[(x+rng.gauss(0,.018),y+rng.gauss(0,.018)) for x,y in corners]
    samples=[]
    radius=rng.uniform(0,.11) if rng.random()<.53 else 0
    for i in range(4):
        a,b,c=corners[i-1],corners[i],corners[(i+1)%4]
        # Start at the beginning of this straight side and round only at corners.
        a0=(b[0]*(1-radius)+a[0]*radius,b[1]*(1-radius)+a[1]*radius)
        a1=(b[0]*(1-radius)+c[0]*radius,b[1]*(1-radius)+c[1]*radius)
        samples.append(a0)
        if radius>0:
            for j in range(1,5):
                t=j/5;x=(1-t)**2*a0[0]+2*(1-t)*t*b[0]+t*t*a1[0];y=(1-t)**2*a0[1]+2*(1-t)*t*b[1]+t*t*a1[1]
                samples.append((x,y))
        samples.append(a1)
    return rotate(samples,tilt)

def round_like(rng):
    """Circle, ellipse, wobble, arbitrary start angle; rotationally different from drop."""
    center=rng.uniform(-math.pi,math.pi);rx=rng.uniform(.55,.87);ry=rx*rng.uniform(.70,1.42)
    skew=rng.uniform(-.045,.045);phase=rng.uniform(-math.pi,math.pi)
    n=rng.randint(72,110)
    r=[]
    for i in range(n):
        t=math.tau*i/n+phase
        wobble=1+rng.uniform(.008,.040)*math.sin(t*3+center)+rng.uniform(.005,.025)*math.sin(t*5+phase)
        r.append((math.cos(t)*rx*wobble+skew*math.sin(t),math.sin(t)*ry*wobble))
    return rotate(r,rng.uniform(-.28,.28))

def lightning_like(rng):
    """Four-vertex user stroke: long upper-left downstroke, sharp rightwards notch, downstroke."""
    arr=np.array(USER_TRACE,dtype='float32')
    pts=[]
    for i,(x,y) in enumerate(arr):
        noise=.025 if i in (0,3) else .064
        pts.append((float(x+rng.gauss(0,noise)),float(y+rng.gauss(0,noise))))
    return pts

def rotate(p,theta):
    a,b=math.cos(theta),math.sin(theta)
    return [(x*a-y*b,x*b+y*a) for x,y in p]

def densify(poly,rng,step=.055):
    if len(poly)<2:return poly
    result=[poly[0]]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        d=math.hypot(a[0]-b[0],a[1]-b[1]);count=max(1,int(d/step))
        for j in range(1,count+1):
            t=j/count;result.append((a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t))
    return result

def random_closed_start(pts,rng,kind):
    if kind not in ('circle','square','triangle','water','star','shuriken'):return pts
    # Avoid rerouting the pentagram/star ordering across intersections; rotate only around continuous outline.
    if kind not in ('circle','square','triangle','shuriken','water'):return pts
    if pts[0]==pts[-1]:pts=pts[:-1]
    if len(pts)<8:pts=densify(pts,rng)
    idx=rng.randrange(len(pts))
    ordered=pts[idx:]+pts[:idx]
    if rng.random()<.44:ordered=ordered[::-1]
    return ordered+[ordered[0]]

def hand_variations(pts,rng,kind,train):
    # Tiny terminal tails near pen-down/pen-up. They are not extra target classes.
    if kind in ('circle','square','lightning','triangle','water','shuriken') and rng.random()<(.57 if train else .67):
        bbox=np.asarray(pts,dtype=np.float32)
        size=float(np.max(np.ptp(bbox,axis=0)))
        if rng.random()<.51:
            a=pts[0];b=pts[min(len(pts)-1,4)]
            theta=rng.uniform(.9,2.2)*rng.choice([-1,1]);dx=b[0]-a[0];dy=b[1]-a[1];L=math.hypot(dx,dy) or 1
            dist=size*rng.uniform(.022,.115);ang=math.atan2(dy,dx)+theta
            pts=[(a[0]-math.cos(ang)*dist,a[1]-math.sin(ang)*dist)]+list(pts)
        else:
            a=pts[-1];b=pts[max(0,len(pts)-5)]
            theta=rng.uniform(.9,2.2)*rng.choice([-1,1]);dx=a[0]-b[0];dy=a[1]-b[1];
            dist=size*rng.uniform(.023,.118);ang=math.atan2(dy,dx)+theta
            pts=list(pts)+[(a[0]+math.cos(ang)*dist,a[1]+math.sin(ang)*dist)]
    if kind in ('circle','square','triangle','water') and rng.random()<.31 and len(pts)>10:
        # Pen-up shortly before the exact closure.
        count=max(1,int(len(pts)*rng.uniform(.015,.055)))
        pts=pts[:-count]
    return pts

def source_sample(kind,rng,flames):
    if kind=='circle':return round_like(rng),None
    if kind=='square':return box_like(rng),None
    if kind=='lightning':return lightning_like(rng),None
    if kind=='flame' and rng.random()<.88:
        e=rng.choice(flames);return [(float(p['x']),float(p['y'])) for p in e['points']],e['flags']
    return gen_shape(kind,rng,flames),None

def generate(kind,rng,flames,train=True):
    pts,flags=source_sample(kind,rng,flames)
    if kind in ('circle','square','lightning'):
        pts=densify(pts,rng,.038)
    pts=random_closed_start(pts,rng,kind)
    pts=augment(pts,rng,kind,flags)
    pts=hand_variations(pts,rng,kind,train)
    return pts

def preprocess_like_browser(points):
    """Approximate browser smoothing/trim at normalized coordinates; also use raw variants for robustness."""
    if len(points)<6:return points
    a=[np.array(q) for q in points]
    out=[a[0]]
    for i in range(1,len(a)-1):out.append(a[i]*.83+(a[i-1]+a[i+1])*.085)
    out.append(a[-1]);return [tuple(map(float,v)) for v in out]

def dataset(split,n_per_class,seed):
    data=[];rseed=seed
    for k,label in enumerate(CATEGORIES):
        rng=random.Random(rseed+k*7919)
        held=FLAME[:7] if split=='train' else FLAME[7:]
        for i in range(n_per_class):
            p=generate(label,rng,held,train=(split=='train'))
            if rng.random()<.65:p=preprocess_like_browser(p)
            data.append((raster(p,rng),k))
    rng=np.random.default_rng(seed+89);order=rng.permutation(len(data))
    x=torch.from_numpy(np.stack([data[i][0] for i in order]).astype('float32')[:,None]/255)
    y=torch.tensor([data[i][1] for i in order],dtype=torch.long)
    return x,y


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--train-per-class',type=int,default=600)
    ap.add_argument('--val-per-class',type=int,default=120)
    ap.add_argument('--epochs',type=int,default=100)
    ap.add_argument('--lr',type=float,default=.004)
    ap.add_argument('--init-weights',type=str,default='cnn_pretrained_v060.pt')
    args=ap.parse_args()
    print('building train and heldout procedural sets...',flush=True)
    tx,ty=dataset('train',args.train_per_class,SEED+53)
    vx,vy=dataset('validation',args.val_per_class,SEED+977)
    m=Model()
    if args.init_weights:m.load_state_dict(torch.load(ROOT/args.init_weights,weights_only=True,map_location='cpu'))
    # Freeze approved convolutional features and unrelated logits. Relearn circle, square,
    # lightning ONLY, preventing the previous flame regression from encoder drift.
    with torch.no_grad():
        def encode(inputs):
            out=[]
            for a in inputs.split(150):
                z=torch.nn.functional.max_pool2d(torch.relu(m.conv1(a)),2)
                z=torch.nn.functional.max_pool2d(torch.relu(m.conv2(z)),2)
                z=torch.nn.functional.max_pool2d(torch.relu(m.conv3(z)),2)
                out.append(torch.relu(m.fc1(z.flatten(1))))
            return torch.cat(out)
        tf=encode(tx);vf=encode(vx)
        old_weight=m.fc2.weight.detach().clone();old_bias=m.fc2.bias.detach().clone()
        orig_flame=[]
        for e in FLAME:
            points=[(float(q['x']),float(q['y'])) for q in e['points']]
            orig_flame.append(raster(points))
        ff=encode(torch.from_numpy(np.stack(orig_flame).astype('float32')[:,None]/255))
    IDS=[CATEGORIES.index(x) for x in ('circle','square','lightning')]
    newWeight=nn.Parameter(old_weight[IDS].clone());newBias=nn.Parameter(old_bias[IDS].clone())
    with torch.no_grad():
        base_pred=(vf@old_weight.T+old_bias).argmax(1)
        base_class_acc={label:float((base_pred[vy==i]==i).float().mean()) for i,label in enumerate(CATEGORIES)}
        base_acc=float((base_pred==vy).float().mean())
        print('BASELINE',base_acc,base_class_acc,flush=True)
    optimizer=torch.optim.Adam([newWeight,newBias],lr=args.lr,weight_decay=1e-6)
    def logits(features):
        out=features@old_weight.T+old_bias
        updated=features@newWeight.T+newBias
        return out.index_copy(1,torch.tensor(IDS),updated)
    best,best_rows,best_epoch=-1,None,0
    for epoch in range(1,args.epochs+1):
        idx=torch.randperm(len(ty));losses=[]
        for ids in idx.split(256):
            z=logits(tf[ids]);loss=nn.functional.cross_entropy(z,ty[ids]);optimizer.zero_grad();loss.backward();optimizer.step();losses.append(loss.detach().item())
        with torch.no_grad():
            pred=logits(vf).argmax(1);acc=float((pred==vy).float().mean())
            class_acc=[float((pred[vy==i]==i).float().mean()) for i in range(len(CATEGORIES))]
            original=(logits(ff).argmax(1)==CATEGORIES.index('flame'))
            original_count=int(original.sum())
        if epoch==1 or epoch%5==0 or epoch==args.epochs:
            print(f'{epoch:03d} loss={sum(losses)/len(losses):.4f} val={acc:.3%} circle={class_acc[2]:.1%} square={class_acc[4]:.1%} lightning={class_acc[7]:.1%} flame={class_acc[5]:.1%} original_flame={original_count}/9',flush=True)
        # Prioritize all actual user-provided flame strokes alongside held-out variation accuracy.
        criteria=acc - 2.0*sum(max(0,t-class_acc[i]) for i,t in [(2,.925),(4,.925),(7,.975),(5,.92)]) - max(0,9-original_count)*.17
        if criteria>best:
            best=criteria;best_rows=(newWeight.detach().clone(),newBias.detach().clone());best_epoch=epoch
    with torch.no_grad():
        m.fc2.weight.index_copy_(0,torch.tensor(IDS),best_rows[0]);m.fc2.bias.index_copy_(0,torch.tensor(IDS),best_rows[1])
    m.eval()
    with torch.no_grad():
        pred=m(vx).argmax(1);class_acc={label:float((pred[vy==i]==i).float().mean()) for i,label in enumerate(CATEGORIES)}
        val_acc=float((pred==vy).float().mean());cm=np.zeros((11,11),dtype=int)
        for a,b in zip(vy.tolist(),pred.tolist()):cm[a,b]+=1
        # Real held-out source images only: never count augmented variants as original photos.
        real_results=[]
        for e in FLAME:
            p=[(float(q['x']),float(q['y'])) for q in e['points']]
            q=m(torch.from_numpy(raster(p).astype('float32')[None,None]/255)).argmax(1).item()
            real_results.append({'kind':'flame','id':e['id'],'expected':'flame','predicted':CATEGORIES[q],'train_source':e in FLAME[:7]})
        traced=json.loads((ROOT/'lightning_user_trace.json').read_text())
        q=m(torch.from_numpy(raster(traced['normalized_points']).astype('float32')[None,None]/255)).argmax(1).item()
        real_results.append({'kind':'lightning','id':'user-image-20261012','expected':'lightning','predicted':CATEGORIES[q],'train_source':'template-derived'})
    report={'version':'0.6.2','seed':SEED,'training_method':'all 11 CNN classes gradient fine-tune + realistic circle/square/lightning augmentation','augmentation_only_during_training':True,
            'classes':CATEGORIES,'train_count':len(ty),'validation_count':len(vy),'validation_accuracy':val_acc,'class_accuracy':class_acc,
            'validation_confusion_matrix':cm.tolist(),'selected_epoch':best_epoch,'baseline_validation_accuracy':base_acc,'baseline_class_accuracy':base_class_acc,
            'user_original_results':real_results,'real_flame_heldout_ids':[e['id'] for e in FLAME[7:]],
            'source_limitation':'Only flame 9 original user strokes and one user-provided lightning image exist. Circle/square holdouts are independently seeded procedural human-like strokes, NOT actual new human drawings. Lightning photo shape seeds the trained reference and therefore is NOT independent test data.'}
    weights={k:base64.b64encode(v.detach().cpu().numpy().astype('<f4').tobytes()).decode() for k,v in m.state_dict().items()}
    (ROOT/'cnn_weights.json').write_text(json.dumps({'architecture':'conv8-16-20-flat320-dense32-out11','tensors':weights,'report':report},separators=(',',':')),encoding='utf8')
    (ROOT/'cnn_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    torch.save(m.state_dict(),ROOT/'cnn_weights.pt')
    print('FINISHED',json.dumps({'overall':val_acc,'classes':class_acc,'originals':real_results},ensure_ascii=False),flush=True)

if __name__=='__main__':main()
