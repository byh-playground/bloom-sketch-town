#!/usr/bin/env python3
"""Extract the user-provided one-stroke lightning drawing centerline; no OCR, no invented training strokes."""
from pathlib import Path
import json,cv2,numpy as np
from PIL import Image
from skimage.morphology import skeletonize
from collections import deque
ROOT=Path(__file__).resolve().parent
img=np.array(Image.open(ROOT/'lightning_user_reference.png').convert('L'))
mask=cv2.morphologyEx((img<160).astype('uint8'),cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
sk=skeletonize(mask).astype(bool)
y,x=np.where(sk);pixels=set(zip(x.tolist(),y.tolist()))
a=min(pixels,key=lambda p:p[1]);b=max(pixels,key=lambda p:p[1]);q=deque([a]);parent={a:None}
while q:
    p=q.popleft()
    for dx in (-1,0,1):
        for dy in (-1,0,1):
            if dx==dy==0:continue
            c=(p[0]+dx,p[1]+dy)
            if c in pixels and c not in parent: parent[c]=p;q.append(c)
if b not in parent:raise RuntimeError('skeleton path is disconnected')
path=[];p=b
while p is not None:path.append(p);p=parent[p]
path.reverse()
arr=np.array(path,dtype='float32');curve=cv2.approxPolyDP(arr.reshape((-1,1,2)),4.2,False).reshape((-1,2))
bounds=np.array([arr[:,0].min(),arr[:,1].min(),arr[:,0].max(),arr[:,1].max()]);mid=np.array([(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2]);scale=2/max(bounds[2]-bounds[0],bounds[3]-bounds[1]);
values={'source':'user-provided drawing image','image':'lightning_user_reference.png','vertices_px':curve.tolist(),'raw_pixel_trace':arr.astype(int).tolist(),'normalized_points':((arr-mid)*scale).round(6).tolist(),'normalized_vertices':((curve-mid)*scale).round(6).tolist()}
(ROOT/'lightning_user_trace.json').write_text(json.dumps(values,separators=(',',':')),encoding='utf-8')
print('Extracted user lightning from actual image:',len(path),'points, major vertices:',curve.tolist())
