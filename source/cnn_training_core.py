#!/usr/bin/env python3
"""Sketch Town common eleven-way CNN and training-only stroke-source helpers.

Outputs inline Float32 CNN, reference paths, and honest synthetic / held-out-real reports.
Data augmentation happens *only* here; game HTML exports original stroke paths + allowed symmetry flags.
"""
from __future__ import annotations
import base64, json, math, random, argparse
from pathlib import Path
import numpy as np
import torch
from PIL import Image, ImageDraw
from torch import nn

ROOT=Path(__file__).resolve().parent
CATEGORIES=['normal','line','circle','triangle','square','flame','water','lightning','star','shuriken','starcircle']
SEED=20261012
random.seed(SEED);np.random.seed(SEED);torch.manual_seed(SEED);torch.set_num_threads(3)

def smooth(points, n=8):
    out=[]
    for i in range(len(points)-1):
        a=points[max(0,i-1)];b=points[i];c=points[i+1];d=points[min(len(points)-1,i+2)]
        for j in range(n):
            t=j/n;t2=t*t;t3=t2*t
            out.append(tuple(.5*(2*b[k]+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t2+(-a[k]+3*b[k]-3*c[k]+d[k])*t3) for k in (0,1)))
    out.append(points[-1]);return out

def points_circle(rng,steps=86):
    phase=rng.uniform(-.27,.27); rx=rng.uniform(.67,.86);ry=rng.uniform(.65,.85)
    return [(math.cos(t)*rx*(1+.032*math.sin(3*t+phase)),math.sin(t)*ry*(1+.02*math.sin(5*t))) for t in (math.tau*i/steps+phase for i in range(steps+1))]

def points_polygon(n,rng):
    start=-math.pi/2 if n==3 else -math.pi/4
    start+=rng.uniform(-.20,.20)
    angles=[start+i*math.tau/n for i in range(n)]
    rr=[rng.uniform(.73,.88) for i in range(n)]
    pts=[(rr[i]*math.cos(t),rr[i]*math.sin(t)) for i,t in enumerate(angles)]
    pts.append(pts[0]);return pts

def points_water(rng):
    phi=rng.uniform(-.05,.05);scaleX=rng.uniform(.63,.78);scaleY=rng.uniform(.78,.89)
    out=[]
    for i in range(91):
        t=i/90*math.tau
        # 0 and 2pi meet at the upward pointed tip, wide round bottom.
        x=scaleX*math.sin(t)*max(0,(1-math.cos(t))/2)**.47
        y=-scaleY*math.cos(t)
        out.append((x*math.cos(phi)-y*math.sin(phi),x*math.sin(phi)+y*math.cos(phi)))
    return out

def points_lightning(rng):
    # User-drawn four-vertex lightning, not the deleted five/six-point zigzag.
    target=[(-.0922,-1.0),(-.35461,.12057),(.35461,-.16312),(-.07092,1.0)]
    return [(x+rng.gauss(0,.028),y+rng.gauss(0,.035)) for x,y in target]

def vertices_star(rng):
    start=-math.pi/2+rng.uniform(-.12,.12)
    return [(math.cos(start+math.tau*i/5)*rng.uniform(.77,.85),math.sin(start+math.tau*i/5)*rng.uniform(.77,.85)) for i in range(5)]

def points_star(rng):
    v=vertices_star(rng);return [v[i] for i in [0,2,4,1,3,0]]

def points_starcircle(rng):
    # One uninterrupted stroke: circle closes at top -> pentagram from same top vertex.
    r=rng.uniform(.78,.86); a0=-math.pi/2
    ring=[(r*math.cos(a0+math.tau*i/90),r*math.sin(a0+math.tau*i/90)) for i in range(91)]
    v=[(r*math.cos(a0+math.tau*i/5),r*math.sin(a0+math.tau*i/5)) for i in range(5)]
    order=[0,2,4,1,3,0]
    return ring+[v[i] for i in order[1:]]

# Reference-aligned continuous square-corner shuriken: four outer corners,
# each side midpoint recessed into the square. Eight straight segments, closed.
SHURIKEN_REFERENCE=[(-.68,-.68),(0,-.26),(.68,-.68),(.26,0),(.68,.68),(0,.26),(-.68,.68),(-.26,0),(-.68,-.68)]
def points_shuriken(rng):
    # All variants preserve 4 corners + 4 concave edge-notches, not a star outline.
    outer=rng.uniform(.61,.79)
    inset=rng.uniform(.205,.335)
    xs=rng.uniform(.93,1.08);ys=rng.uniform(.93,1.08)
    corners=[(-outer,-outer),(outer,-outer),(outer,outer),(-outer,outer)]
    points=[]
    for i,corner in enumerate(corners):
        x,y=corner
        x+=rng.gauss(0,.020);y+=rng.gauss(0,.020)
        points.append((x*xs,y*ys))
        notch=rng.uniform(.85,1.16)*inset
        if i==0:points.append((rng.gauss(0,.026),-notch*ys))
        elif i==1:points.append((notch*xs,rng.gauss(0,.026)))
        elif i==2:points.append((rng.gauss(0,.026),notch*ys))
        else:points.append((-notch*xs,rng.gauss(0,.026)))
    points.append(points[0])
    # Cardinal rotations are label-preserving and enlarge real orientation coverage.
    turn=rng.choice([0,1,2,3]); a=turn*math.pi/2
    ca,sa=math.cos(a),math.sin(a)
    return [(x*ca-y*sa,x*sa+y*ca) for x,y in points]

def points_flame_synth(rng):
    # Naruto-like spiral flame, one open stroke with a longer outer tongue from the top.
    turns=rng.uniform(1.35,1.83);sense=rng.choice([-1,1]);rot=rng.uniform(-.20,.20)
    out=[]
    for i in range(85):
        t=i/84
        r=.83*(1-t)**.82+.04
        a=-math.pi/2+sense*math.tau*turns*t+rot
        x=math.cos(a)*r*.82
        y=math.sin(a)*r
        out.append((x,y))
    return out

def points_normal(rng):
    choice=rng.randrange(9)
    if choice==0:return [(-.8,.1),(.8,.1),(.72,.32)]
    if choice==1:return smooth([(-.7,-.6),(-.3,.15),(.2,.05),(.7,-.6)],8)
    if choice==2:return smooth([(-.8,.1),(-.3,.75),(.25,-.7),(.78,.12)],8)
    if choice==3:return smooth([(-.8,-.4),(-.45,.3),(-.03,-.2),(.26,.6),(.8,.06)],7)
    if choice==4:return [(-.8,-.65),(-.4,-.2),(-.35,.65),(.5,.35)]
    if choice==5:return [(math.cos(math.tau*i/60)*.7,math.sin(math.tau*i/60)*.45) for i in range(40)]
    if choice==6:return smooth([(-.8,-.5),(-.7,.6),(.12,.45),(.75,-.35)],6)
    if choice==7:return [(-.8,-.1),(-.55,.1),(-.2,-.1),(.2,.1),(.8,-.1)]
    return smooth([(-.6,.1),(-.4,-.42),(.14,-.47),(.64,.4),(.39,.7)],5)

def gen_shape(label,rng,flame_train,train=True):
    if label=='normal':return points_normal(rng)
    if label=='line':
        x0,y0=rng.uniform(-.7,-.5),rng.uniform(-.15,.15);x1,y1=rng.uniform(.56,.86),rng.uniform(-.18,.18)
        return [(x0,y0),(x0*.5+x1*.5+rng.uniform(-.055,.055),y0*.5+y1*.5+rng.uniform(-.048,.048)),(x1,y1)]
    if label=='circle':return points_circle(rng)
    if label=='triangle':return points_polygon(3,rng)
    if label=='square':return points_polygon(4,rng)
    if label=='water':return points_water(rng)
    if label=='lightning':return points_lightning(rng)
    if label=='star':return points_star(rng)
    if label=='shuriken':return points_shuriken(rng)
    if label=='starcircle':return points_starcircle(rng)
    if label=='flame':
        if rng.random()<.82:
            e=rng.choice(flame_train)
            return [(float(p['x']),float(p['y'])) for p in e['points']]
        return points_flame_synth(rng)
    raise KeyError(label)

def augment(path,rng,label,metadata=None):
    # Train-time spatial augmentation; preserve vertical semantics for flame/water/lightning.
    base=path[::-1] if rng.random()<(.45 if metadata and metadata.get('reverse') else .18) else path
    theta=rng.uniform(-.17,.17) if label not in ('circle','line') else rng.uniform(-1,1)
    cs,sn=math.cos(theta),math.sin(theta)
    sx=rng.uniform(.78,1.20)*(-1 if rng.random()<(.5 if metadata is None else .5 if metadata.get('mirrorX') else 0) else 1)
    sy=rng.uniform(.79,1.18)*(-1 if (metadata is None and label in ('circle','line') and rng.random()<.5) or (metadata and metadata.get('mirrorY') and rng.random()<.5) else 1)
    shear=rng.uniform(-.08,.08)
    shiftX,shiftY=rng.uniform(-.2,.2),rng.uniform(-.2,.2)
    # Smooth random warp: no independent high-frequency destruction of hand-drawn loops.
    p=len(base);warpX=[rng.gauss(0,.020) for _ in range(4)];warpY=[rng.gauss(0,.020) for _ in range(4)]
    out=[]
    for i,(x,y) in enumerate(base):
        u=(i/max(1,p-1))*3;k=min(2,int(u));f=u-k
        wx=warpX[k]*(1-f)+warpX[k+1]*f;wy=warpY[k]*(1-f)+warpY[k+1]*f
        x=x*sx+shear*y+wx;y=y*sy+wy
        out.append((x*cs-y*sn+shiftX+rng.gauss(0,.008),x*sn+y*cs+shiftY+rng.gauss(0,.008)))
    return out

def raster(path, rng=None):
    a=np.asarray(path,dtype=np.float32)
    lo=a.min(axis=0);hi=a.max(axis=0);s=23.5/max(1e-4,float(max(hi-lo)))
    a=(a-(lo+hi)/2)*s+16
    im=Image.new('L',(96,96),0);d=ImageDraw.Draw(im)
    pts=[(round(float(x*3)),round(float(y*3))) for x,y in a]
    pen=7 if rng is None else rng.choice([6,7,7,7,8])
    d.line(pts,fill=255,width=pen,joint='curve')
    for xy in [pts[0],pts[-1]]:d.ellipse((xy[0]-pen/2,xy[1]-pen/2,xy[0]+pen/2,xy[1]+pen/2),fill=255)
    return np.asarray(im.resize((32,32),Image.Resampling.BILINEAR),dtype=np.uint8)

class Model(nn.Module):
    def __init__(self):
        super().__init__();self.conv1=nn.Conv2d(1,8,3,padding=1);self.conv2=nn.Conv2d(8,16,3,padding=1);self.conv3=nn.Conv2d(16,20,3,padding=1);self.fc1=nn.Linear(320,32);self.fc2=nn.Linear(32,len(CATEGORIES))
    def forward(self,x):
        x=torch.nn.functional.max_pool2d(torch.relu(self.conv1(x)),2)
        x=torch.nn.functional.max_pool2d(torch.relu(self.conv2(x)),2)
        x=torch.nn.functional.max_pool2d(torch.relu(self.conv3(x)),2)
        return self.fc2(torch.relu(self.fc1(x.flatten(1))))
