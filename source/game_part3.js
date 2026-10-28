  // Rendering: authentic BLOOM GameKit Renderer2D WebGL geometry. No Canvas2D world fallback.
  // World x/y is authoritative; screen projection belongs to Renderer2D. Canvas2D is UI text and drawing only.
  let paintClockMs=0; // presentation-only clock, never copied into authoritative rollback state
  // Bounded color table: avoid allocating one fresh [r,g,b,a] array for *each* sketch segment.
  // An eight-bit alpha bucket is visually equivalent to CSS opacity precision and has fixed memory bounds.
  const paletteCache=new Map(),paletteStats={requests:0,hits:0,created:0};
  function tint(hex,alpha=1){if(!Number.isFinite(alpha))throw new TypeError('non-finite presentation opacity');
    paletteStats.requests++;
    let c=paletteCache.get(hex);
    if(!c){let s=hex.replace('#','');if(s.length===3)s=s.split('').map(x=>x+x).join('');
      c={r:parseInt(s.slice(0,2),16)/255,g:parseInt(s.slice(2,4),16)/255,b:parseInt(s.slice(4,6),16)/255,shades:new Array(256)};
      paletteCache.set(hex,c);
    }
    const key=Math.round(clamp(alpha,0,1)*255);let shade=c.shades[key];
    if(shade){paletteStats.hits++;return shade;}
    shade=[c.r,c.g,c.b,key/255];c.shades[key]=shade;paletteStats.created++;return shade;
  }
  // Pooled unit-circle lookup eliminates repeated trig for outlines while retaining GameKit WebGL batching.
  const ringUnits=new Map();
  function ringGeometry(n){let unit=ringUnits.get(n);if(unit)return unit;
    unit=new Float32Array((n+1)*2);for(let i=0;i<=n;i++){const a=i*2*Math.PI/n;unit[i*2]=Math.cos(a);unit[i*2+1]=Math.sin(a);}
    ringUnits.set(n,unit);return unit;
  }
  // Pixel-radius LOD saves GPU vertices on small decorative circles; large silhouettes stay smooth.
  function ellipseDetail(radius){const pixels=radius*camera.zoom;
    return pixels<5?10:pixels<11?14:pixels<24?18:pixels<58?20:24;
  }
  const P={
    dot(x,y,r,color,alpha=1){if(r>.2)renderer.ellipse(x,y,r,r,tint(color,alpha),ellipseDetail(r));},
    oval(x,y,rx,ry,color,alpha=1){if(rx>0&&ry>0)renderer.ellipse(x,y,rx,ry,tint(color,alpha),ellipseDetail(Math.max(rx,ry)));},
    box(x,y,w,h,color,alpha=1,angle=0){if(w>0&&h>0)renderer.rect(x,y,w,h,tint(color,alpha),angle);},
    line(x0,y0,x1,y1,width,color,alpha=1){const dx=x1-x0,dy=y1-y0;
      if(dx*dx+dy*dy>.01)renderer.line(x0,y0,x1,y1,width,tint(color,alpha));},
    tri(a,b,c,color,alpha=1){renderer.triangle(a.x,a.y,b.x,b.y,c.x,c.y,tint(color,alpha));},
    path(points,w,color,alpha=1,closed=false){for(let i=1;i<points.length;i++)this.line(points[i-1].x,points[i-1].y,points[i].x,points[i].y,w,color,alpha);if(closed&&points.length>2)this.line(points.at(-1).x,points.at(-1).y,points[0].x,points[0].y,w,color,alpha);},
    ring(x,y,r,color,alpha=1,w=2,segments=27){const unit=ringGeometry(segments),shade=tint(color,alpha);
      for(let i=0;i<segments;i++){const index=i*2,next=index+2;
        renderer.line(x+unit[index]*r,y+unit[index+1]*r,x+unit[next]*r,y+unit[next+1]*r,w,shade);
      }
    }
  };
  const vectorAssets=new Map();let vectorAssetDraws=0;
  function vectorRecord(id){let record=vectorAssets.get(id);if(record)return record;const compiled=BLOOM_VECTOR_ASSETS[id];if(!compiled)throw new Error('Missing compiled SVG asset: '+id);const asset=createVectorAsset(renderer.context.meshRenderer,compiled);const player=asset.createPlayer();record={asset,player,clip:player.currentClip,expression:player.currentExpression,staticPoseReady:false};vectorAssets.set(id,record);return record;}
  function vectorState(id,expression,clip,timeMs){const record=vectorRecord(id);if(record.clip!==clip){record.player.play(clip,timeMs);record.clip=clip;record.staticPoseReady=false;}if(record.expression!==expression){record.player.setExpression(expression);record.expression=expression;record.staticPoseReady=false;}if(clip!=='static'||!record.staticPoseReady){record.player.seek(timeMs);if(clip==='static')record.staticPoseReady=true;}return record.player;}
  function drawVector(id,expression,clip,timeMs,localMatrix,alpha=1){const player=vectorState(id,expression,clip,timeMs);renderer.drawVector(player,localMatrix,alpha);vectorAssetDraws++;return player;}
  function drawEnvironmentProp(kind,x,y,r,house=null){const expression=house?'house-'+house.type:kind;if(!['canopy','reed','slab','stump','bell','crane','crystal','house-home','house-shop','house-library'].includes(expression))return false;const sX=house?house.width/172:r/50,sY=house?house.height/135:sX,tx=x-90*sX,ty=house?y-105*sY:y-190*sY;drawVector('environment-'+expression,expression,'static',paintClockMs,[sX,0,0,sY,tx,ty]);return true;}
  const decalPlayers=new WeakMap();
  function drawEnvironmentDecal(d){let record=decalPlayers.get(d);if(!record){const asset=vectorRecord('environment-'+d.kind).asset,player=asset.createPlayer({clip:'sway',startedAtMs:0});player.setExpression(d.kind);record={player,expression:d.kind};decalPlayers.set(d,record);}const s=.18,offset=d.seed*150,anchorY=d.kind==='flower'?144:188;record.player.seek(paintClockMs+offset);renderer.drawVector(record.player,[s,0,0,s,d.x-90*s,d.y-anchorY*s]);vectorAssetDraws++;}
  function disposeVectorAssets(){for(const {asset} of vectorAssets.values())asset.dispose();vectorAssets.clear();}
  const WORLD_C=[.973,.955,.907,1],worldDraw=[];
  const txtCanvas=document.createElement('canvas');txtCanvas.id='worldText';txtCanvas.setAttribute('aria-hidden','true');txtCanvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';field.after(txtCanvas);
  const txtCtx=txtCanvas.getContext('2d');const textAnchor={x:0,y:0};let screenDpr=1,lastUiMs=0;
  function visible(x,y,r=80){const hx=vw/(camera.zoom*2)+r,hy=vh/(camera.zoom*2)+r;return Math.abs(x-camera.x)<hx&&Math.abs(y-camera.y)<hy;}
  function ground(){
    regionGround();
    drawWorldSites();
    for(const d of world.decals){if(!visible(d.x,d.y,35))continue;drawEnvironmentDecal(d);}
  }
  function drawHouse(h){const {x,y,w,h:height,type}=h;if(!visible(x,y,140))return;drawEnvironmentProp('house',x,y,0,{type:type==='house'?'home':type,width:w,height});}
  function drawTree(t){drawRegionProp(t);}
  const SKETCH={ink:'#384650',boilMs:135,hitFlashMs:175};
  function hashSketch(id,index,salt=0){let n=Math.imul(id+17117,374761393)^Math.imul(index+11,668265263)^Math.imul(salt+29,2246822519);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
  function playerMood(run){if(world.mode==='down'||player.hp<=0)return 'down';if(player.invulMs>350)return 'hurt';if(sceneViews.cast.some(c=>c.owner===player.actorId))return 'cast';if(player.hp/player.maxHp<.33)return 'low';if(player.dash.leftMs>0)return 'dash';if(run)return 'move';return 'idle';}
  function playerBody(){
    const x=player.x,y=player.y,running=player.dash.leftMs>0||hypot(player.moveX||0,player.moveY||0)>.01;
    player.castActive=sceneViews.cast.some(c=>c.owner===player.actorId)||(player.castPreviewMs||0)>0;
    const mood=playerMood(running),clip=player.dash.leftMs>0?'dash':mood==='down'?'down':mood==='cast'?'cast':running?'move':'idle';
    const vector=drawVector('player',mood,clip,paintClockMs,[1,0,0,1,x-50,y-36]);
    player.currentClip=vector.currentClip;player.currentExpression=vector.currentExpression;
    if(player.invulMs>0&&Math.floor(paintClockMs/93)%2===1&&mood!=='hurt')P.ring(x,y,22,'#80a59c',.65,2.2);
    if(player.dash.leftMs>0){const progress=clamp(player.dash.elapsedMs/Math.max(1,player.dash.durationMs),0,1);P.ring(x,y,16+Math.sin(Math.PI*progress)*6,'#7da69b',.21,1.65,22);const a=paintClockMs*.030;for(let k=0;k<3;k++){const q=a+k*Math.PI*2/3;P.line(x+Math.cos(q)*21,y+Math.sin(q)*21,x+Math.cos(q+.45)*24,y+Math.sin(q+.45)*24,1.8,'#759b92',.52);}}
    const casting=sceneViews.cast.some(c=>c.owner===player.actorId),anticipation=(player.castPreviewMs||0)>0;
    if(casting||anticipation){const socket=vector.getSocket('staffTip'),tx=x+socket.x-50,ty=y+socket.y-36,t=paintClockMs*.013;P.dot(tx+Math.cos(t*1.7)*2,ty+Math.sin(t*1.5)*2,2.4,'#f0d09a',.85);P.ring(x,y,22+3*Math.sin(t*1.1),'#c19a68',.45,1.8,18);}
  }
  function enemyBody(e){if(!visible(e.x,e.y,130))return;
    const {x,y,r,kind}=e,hit=e.hitMs>0,clip=e.windupMs>0?'attack':hypot(e.vx||0,e.vy||0)>5?'move':'idle',expression=hit?'hit':e.windupMs>0?'alert':'neutral';
    P.oval(x,y+r*.79,r*.83,r*.22,'#74726b',.13);
    if(e.stunMs>0)P.ring(x,y-7,r+7,'#d2a257',.53,1.8,16);
    if(e.bossId>=0){P.oval(x,y+r*.1,r*1.25,r*1.1,e.color,.16);P.ring(x,y,r+6,e.color,.55,2.4,30);}
    const config={chaser:{pivotX:60,pivotY:77,scale:r/36},spitter:{pivotX:60,pivotY:75,scale:r/48},charger:{pivotX:65,pivotY:77,scale:r/36},boss:{pivotX:80,pivotY:83,scale:r/44}}[kind];
    if(!config)throw new TypeError('No SVG enemy asset mapping for '+kind);const s=config.scale;
    drawVector('enemy-'+kind,expression,clip,paintClockMs+e.id*37,[s,0,0,s,x-config.pivotX*s,y-config.pivotY*s]);
    if(hit){const f=clamp(e.hitMs/SKETCH.hitFlashMs,0,1);for(let k=0;k<5;k++){const a=k*Math.PI*2/5+e.id*.31,len=(r*.66)+(1-f)*r*.28,px=x+Math.cos(a)*(r*.30),py=y+Math.sin(a)*(r*.30);P.line(px,py,px+Math.cos(a)*len,py+Math.sin(a)*len,1.8,'#fff8d9',f*.90);P.line(px+Math.sin(a)*2,py-Math.cos(a)*2,px+Math.cos(a)*len*.76+Math.sin(a)*2,py+Math.sin(a)*len*.76-Math.cos(a)*2,1.0,'#384650',f*.48);}}
    if(e.windupMs>0){const alpha=clamp(e.windupMs/700,.18,1);P.ring(x,y,e.r+19,'#bf6556',.78-alpha*.24,3,26);if(e.attackType==='charge'){const dx=player.x-x,dy=player.y-y,m=hypot(dx,dy)||1;P.line(x,y,x+dx/m*260,y+dy/m*260,4,'#c87961',.35);}}
    if(kind==='boss'&&bossSealed(e.bossId)){P.ring(x,y,e.r+12,'#7d5a9e',.75,3.2,30);P.ring(x,y,e.r+19,'#b394e0',.45,1.6,30);}
    if(e.hp<e.maxHp){const pct=clamp(e.hp/e.maxHp,0,1),bar=Math.max(28,e.r*1.9);P.box(x,y-e.r-18,bar,5,'#605660',.65);if(pct>0)P.box(x-bar*(1-pct)/2,y-e.r-18,bar*pct,4,kind==='boss'?'#a75e84':'#a87e79');}
  }
  function drawStroke(points,x,y,angle=0,size=1,color='#4e6269',alpha=1,width=2.6,progress=1){if(!points?.length)return;const cs=Math.cos(angle),sn=Math.sin(angle);let total=0;for(let i=1;i<points.length;i++)total+=hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y);const upto=total*clamp(progress,0,1);let walked=0;
    for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],d=hypot(b.x-a.x,b.y-a.y);if(walked>=upto)break;const t=clamp((upto-walked)/Math.max(.00001,d),0,1);const ax=x+(a.x*cs-a.y*sn)*size,ay=y+(a.x*sn+a.y*cs)*size,bx=x+((a.x+(b.x-a.x)*t)*cs-(a.y+(b.y-a.y)*t)*sn)*size,by=y+((a.x+(b.x-a.x)*t)*sn+(a.y+(b.y-a.y)*t)*cs)*size;
      P.line(ax,ay,bx,by,width+1.6,'#fff5dc',alpha*.70);P.line(ax,ay,bx,by,width,color,alpha);walked+=d;}
  }
  function drawCast(c){const x=c.shot.x,y=c.shot.y;if(!visible(x,y,100))return;const p=clamp(c.ageMs/c.durationMs,0,1),angle=0;P.ring(x,y,37+p*15,c.shot.color,(1-p)*.28,1.7,23);
    drawStroke(c.shot.shape,x,y,angle,1.35,c.shot.color,.95,2.6,p);
    const pts=c.shot.shape,n=pts.length-1; if(n>0){const fi=Math.min(n,Math.floor(n*p)),head=pts[fi];P.dot(x+head.x*1.35,y+head.y*1.35,4.8,'#fff1a1',.77);P.dot(x+head.x*1.35,y+head.y*1.35,2.6,c.shot.color,.95);}
  }
  // The summon IS the player's drawing: the body is the stroke as drawn (only scaled to the collider), and the face
  // is an animated preset chosen by the expression the player drew. Body and face move together.
  const INK='#3a4a50',INK_EDGE='#fff5dc';
  function inkLine(ax,ay,bx,by,w=2.2){P.line(ax,ay,bx,by,w+1,INK,.95);}
  function inkPath(points,w=2.2){for(let i=1;i<points.length;i++)inkLine(points[i-1][0],points[i-1][1],points[i][0],points[i][1],w);}
  function inkArc(cx,cy,rx,ry,a0,a1,w=2.2,n=9){const pts=[];for(let i=0;i<=n;i++){const a=a0+(a1-a0)*i/n;pts.push([cx+Math.cos(a)*rx,cy+Math.sin(a)*ry]);}inkPath(pts,w);}
  function inkDot(x,y,r){P.dot(x,y,r+.6,INK,.97);}
  // Body motion per expression: [hop Hz, hop px, sway rad, squash, tremble px]
  const BODY_MOTION={neutral:[1.4,1.2,.02,.03,0],joy:[3.1,5,.05,.09,0],anger:[2.2,1,.0,.04,1.1],sleepy:[.45,1.6,.07,.02,0],surprise:[1.6,3,.03,.06,0],sad:[.8,.8,.03,.02,0]};
  function summonPose(v,spec,t){
    const [hz,hop,sway,squash,tremble]=BODY_MOTION[v.face]||BODY_MOTION.neutral,ph=v.id*1.7,w=Math.sin(t*hz*Math.PI*2+ph);
    let ox=Math.sin(t*37+ph)*tremble,oy=spec.anchored?0:-Math.abs(w)*hop,sx=1+(spec.anchored?0:squash*w*.6),sy=1-(spec.anchored?0:squash*w*.6),rot=Math.sin(t*hz*Math.PI+ph)*sway;
    if(v.face==='sad'){sy*=.93;oy+=1.5;}
    if(v.face==='surprise'){const j=(t+ph)%2.4;if(j<.22){oy-=Math.sin(j/.22*Math.PI)*10;sy*=1.1;sx*=.94;}}
    const total=spec.strike.cooldownMs/temperamentOf(v).attackRate,since=total-v.cdMs;
    if(v.targetId&&since>=0&&since<190){const k=Math.sin(since/190*Math.PI);ox+=v.faceX*k*7;sx*=1+.12*k;sy*=1-.1*k;}
    return {ox,oy,sx,sy,rot};
  }
  // Fill the inside of a closed drawing with horizontal ink lines (open strokes such as a line or lightning stay unfilled).
  // Body geometry is derived once per drawn shape (cached by the shape array): the stroke is thinned to at most 16 points and a
  // closed outline is filled with a centroid fan. Per frame the summon then costs one quad per segment and one triangle per
  // fan wedge, with no overlapping alpha quads.
  const bodyMeshes=new WeakMap();
  function bodyMesh(shape){
    let mesh=bodyMeshes.get(shape);if(mesh)return mesh;
    const keep=Math.max(1,Math.ceil(shape.length/16)),pts=shape.filter((_,i)=>i%keep===0||i===shape.length-1);
    let extent=0;for(const p of pts)extent=Math.max(extent,Math.abs(p.x),Math.abs(p.y));
    const first=pts[0],last=pts.at(-1),closed=pts.length>=4&&hypot(first.x-last.x,first.y-last.y)<=extent*.45;
    let cx=0,cy=0;if(closed){for(const p of pts){cx+=p.x;cy+=p.y;}cx/=pts.length;cy/=pts.length;}
    mesh={pts,closed,cx,cy};bodyMeshes.set(shape,mesh);return mesh;
  }
  function fillClosedShape(mesh,x,y,rot,sx,sy,scale,color,alpha){
    if(!mesh.closed)return;
    const cs=Math.cos(rot),sn=Math.sin(rot),map=p=>{const px=p.x*scale*sx,py=p.y*scale*sy;return {x:x+px*cs-py*sn,y:y+px*sn+py*cs};},c=map({x:mesh.cx,y:mesh.cy}),pts=mesh.pts;
    let prev=map(pts[0]);
    for(let i=1;i<=pts.length;i++){const cur=map(pts[i%pts.length]);P.tri(c,prev,cur,color,alpha);prev=cur;}
  }
  function drawStrokeSquashed(mesh,x,y,rot,sx,sy,scale,color,alpha,width){
    const cs=Math.cos(rot),sn=Math.sin(rot),pts=mesh.pts,map=p=>{const px=p.x*scale*sx,py=p.y*scale*sy;return [x+px*cs-py*sn,y+px*sn+py*cs];};
    let a=map(pts[0]);for(let i=1;i<pts.length;i++){const b=map(pts[i]);P.line(a[0],a[1],b[0],b[1],width,color,alpha);a=b;}
    if(mesh.closed){const b=map(pts[0]);P.line(a[0],a[1],b[0],b[1],width,color,alpha);}
  }
  // The face is generated from the summon's personality look (TraitFace.marks); only blinking, quivering and accents move.
  function drawFace(shape,cx,cy,u,t,look,seed){
    const blink=(t+seed*.37)%3.4<.12,gx=look*.05*u,quiver=(shape.bold>=2?Math.sin(t*30+seed)*.02:0)*u;
    for(const m of TraitFace.marks(shape)){
      if(m.type==='line')inkLine(cx+m.x1*u+gx*.5,cy+m.y1*u+quiver,cx+m.x2*u+gx*.5,cy+m.y2*u+quiver,2.4);
      else if(m.type==='arc'){
        if(blink&&m.ry>.05)inkLine(cx+(m.cx-m.rx)*u+gx,cy+m.cy*u+.04*u,cx+(m.cx+m.rx)*u+gx,cy+m.cy*u+.04*u,2.2);
        else inkArc(cx+m.cx*u+(m.ry<.12?0:gx),cy+m.cy*u+quiver,m.rx*u,m.ry*u,m.a0,m.a1,2.2,12);
      }
      else if(m.type==='dot'){if(!blink)inkDot(cx+m.x*u+gx*2,cy+m.y*u,Math.max(1.6,m.r*u));}
      else if(m.type==='curve'){
        const pts=[];for(let i=0;i<=8;i++){const q=i/8,w1=(1-q)*(1-q),w2=2*q*(1-q),w3=q*q;pts.push([cx+(w1*m.x1+w2*m.cx+w3*m.x2)*u,cy+(w1*m.y1+w2*m.cy+w3*m.y2)*u+quiver]);}
        inkPath(pts,2.2);
      }
      else if(m.type==='accent'){
        if(m.name==='vein'){const pulse=.7+.3*Math.sin(t*9);inkLine(cx+.52*u,cy-.7*u,cx+.74*u,cy-.5*u,2*pulse);inkLine(cx+.74*u,cy-.7*u,cx+.52*u,cy-.5*u,2*pulse);}
        else if(m.name==='blush'){P.dot(cx-.66*u,cy+.12*u,.1*u,'#e59a8f',.4);P.dot(cx+.66*u,cy+.12*u,.1*u,'#e59a8f',.4);}
        else if(m.name==='zzz'){
          const zt=(t*.45+seed*.13)%1;
          for(let k=0;k<2;k++){const f=(zt+k*.5)%1,zx=cx+.7*u+f*.35*u,zy=cy-.5*u-f*.8*u,zs=(.08+.07*f)*u;P.line(zx-zs,zy-zs,zx+zs,zy-zs,2,INK,.85*(1-f));P.line(zx+zs,zy-zs,zx-zs,zy+zs,2,INK,.85*(1-f));P.line(zx-zs,zy+zs,zx+zs,zy+zs,2,INK,.85*(1-f));}
        }
      }
    }
  }
  function drawSummon(v){
    if(!visible(v.x,v.y,120))return;
    // Drawn larger than the collider so the body and its face stay readable; collision and targeting use v.r.
    const spec=summonSpecOf(v.kind),t=paintClockMs/1000,pose=summonPose(v,spec,t),x=v.x+pose.ox,y=v.y+pose.oy,vr=v.r*1.35;
    const mesh=bodyMesh(v.shape);let extent=1;for(const p of mesh.pts)extent=Math.max(extent,Math.abs(p.x),Math.abs(p.y));
    const scale=vr*1.15/extent;
    if(spec.anchored)P.ring(v.x,v.y,spec.strike.range,v.color,.10+.05*Math.sin(paintClockMs*.004),1.4,40);
    P.oval(v.x,v.y+vr*.8,vr*.95,vr*.26,'#74726b',.16);
    const rot=spec.anchored?paintClockMs*.0006:pose.rot;
    fillClosedShape(mesh,x,y,rot,pose.sx,pose.sy,scale,v.color,.22);
    drawStrokeSquashed(mesh,x,y,rot,pose.sx,pose.sy,scale,v.color,.97,spec.taunt?5:3);
    drawFace(personalityOf(v).look,x,y+vr*.04*pose.sy,vr*.62*Math.min(pose.sx,pose.sy+.05),t,v.faceX,v.id);
    if(v.hitMs>0){const f=clamp(v.hitMs/SKETCH.hitFlashMs,0,1);drawStrokeSquashed(mesh,x,y,rot,pose.sx*1.06,pose.sy*1.06,scale,'#fff8d9',f*.9,5);}
    if(selectedUnits.has(v.id)){P.ring(v.x,v.y,vr*1.3+Math.sin(paintClockMs*.008)*2,'#e0a64a',.95,3,30);}
    if((v.tier||1)>1)for(let k=0;k<v.tier;k++)P.dot(v.x+(k-(v.tier-1)/2)*8,v.y+vr+10,3.2,'#e0a64a',.95);
    if(v.hp<v.maxHp){const pct=clamp(v.hp/v.maxHp,0,1),bar=Math.max(26,vr*2);P.box(v.x,v.y-vr-14,bar,5,'#605660',.65);if(pct>0)P.box(v.x-bar*(1-pct)/2,v.y-vr-14,bar*pct,4,'#6f9a85');}
  }
  function drawHazard(h){if(!visible(h.x,h.y,90))return;
    const phase=Math.floor(paintClockMs/SKETCH.boilMs),r=h.r;
    P.dot(h.x,h.y,r*.83,h.color,.38);
    // Enemy ink shots have ragged drawn contours, rather than perfect polished discs.
    for(let k=0;k<9;k++){
      const a=k*Math.PI*2/9,b=(k+1)*Math.PI*2/9;
      const j=hashSketch(Math.round(h.vx*7+h.vy*3),k,phase)-.5;
      const u=r*(1+j*.14),v=r*(1+(hashSketch(Math.round(h.vx),k+1,phase)-.5)*.14);
      P.line(h.x+Math.cos(a)*u,h.y+Math.sin(a)*u,h.x+Math.cos(b)*v,h.y+Math.sin(b)*v,1.75,h.color,.88);
    }
    P.line(h.x-r*.43,h.y-r*.24,h.x-r*.12,h.y-r*.56,1.3,'#fff5e8',.87);
  }
  function drawField(f){if(!visible(f.x,f.y,f.r||100))return;const q=clamp(f.ageMs/f.lifeMs,0,1),fade=(1-q);
    if(f.kind==='ring'){P.ring(f.x,f.y,f.r*(.4+.6*q),f.color,fade*.8,3,34);P.dot(f.x,f.y,7,f.color,.13*fade);}
    else if(f.kind==='lob'){const lift=Math.max(0,f.z),shadow=Math.max(2.5,6-lift*.04);
      P.dot(f.x,f.y+2,shadow,'#4a3f36',.16);P.dot(f.x,f.y-lift,6.2,f.color,.95);P.dot(f.x-1.2,f.y-lift-1.4,2.6,'#fff8e4',.9);}
    else if(f.kind==='bolt'){const tail=26;P.line(f.x-f.dx*tail,f.y-f.dy*tail,f.x,f.y,5,f.color,.85);P.line(f.x-f.dx*tail*.5,f.y-f.dy*tail*.5,f.x,f.y,2.4,'#fff8d9',.95);P.dot(f.x,f.y,5.5,'#fff1a1',.9);}
    else if(f.kind==='arc'){const n=6;for(let i=1;i<=n;i++){const a=(i-1)/n,b=i/n;const x=f.x+(f.ex-f.x)*a,y=f.y+(f.ey-f.y)*a+(i%2?12:-10),ex=f.x+(f.ex-f.x)*b,ey=f.y+(f.ey-f.y)*b+(i%2?-10:12);P.line(x,y,ex,ey,3,f.color,fade);}}
    else if(f.kind==='impact'){
      const scale=.24+.83*(1-Math.pow(1-q,2));
      for(let k=0;k<12;k++){
        const a=(k+.13)*Math.PI/6+Math.sin(f.x*0.03+k)*.08;
        const r=f.r*scale,inner=Math.max(4,r-13*(1-q));
        P.line(f.x+Math.cos(a)*inner,f.y+Math.sin(a)*inner,f.x+Math.cos(a)*r,f.y+Math.sin(a)*r,1.8+2.6*fade,f.color,fade*.9);
      }
      P.ring(f.x,f.y,f.r*scale*.55,'#fff8d9',fade*.92,2.2,16);
    }
    else if(f.kind==='slash'){
      for(let k=0;k<3;k++){const a=k*Math.PI/3+q*.5;
        const r=f.r*(.3+.7*q);P.line(f.x+Math.cos(a)*r*.4,f.y+Math.sin(a)*r*.4,f.x+Math.cos(a)*r,f.y+Math.sin(a)*r,3.3,f.color,fade);}
    }
    else if(f.kind==='splash'){
      for(let k=0;k<9;k++){const a=k*2*Math.PI/9,r=f.r*(.24+.8*q);
        P.oval(f.x+Math.cos(a)*r,f.y+Math.sin(a)*r,3.5+3*fade,5+2*fade,f.color,fade*.65);}
      P.ring(f.x,f.y,f.r*(.2+.7*q),f.color,fade*.5,2.1,23);
    }
    else if(f.kind==='magiccircle'){
      const rot=f.ageMs*.0007,r=f.r*(.80+.05*Math.sin(f.ageMs*.009));
      P.ring(f.x,f.y,r,f.color,fade*.51,2.5,48);
      P.ring(f.x,f.y,r*.65,f.color,fade*.40,1.7,37);
      const v=[];for(let k=0;k<5;k++){const a=k*Math.PI*2/5-Math.PI/2+rot;v.push({x:f.x+Math.cos(a)*r*.72,y:f.y+Math.sin(a)*r*.72});}
      for(const k of [0,2,4,1,3]){const nx=[0,2,4,1,3].indexOf(k),next=[0,2,4,1,3,0][nx+1];P.line(v[k].x,v[k].y,v[next].x,v[next].y,1.9,f.color,fade*.75);}
      for(let k=0;k<8;k++){const a=k*Math.PI/4+rot*.5;P.dot(f.x+Math.cos(a)*r*.90,f.y+Math.sin(a)*r*.90,2.2,f.color,fade*.73);}
    }
    else if(f.kind==='star'){for(let j=0;j<5;j++){const a=j*Math.PI*2/5-Math.PI/2;P.line(f.x+Math.cos(a)*14,f.y+Math.sin(a)*14,f.x+Math.cos(a)*f.r*q,f.y+Math.sin(a)*f.r*q,3.5,f.color,fade*.85);}P.ring(f.x,f.y,f.r*q*.48,f.color,fade*.58,2.3,23);}
    else if(f.kind==='flame'){for(let k=0;k<5;k++){const a=k*2.4+paintClockMs*.003,r=f.r*(.4+.6*q);P.dot(f.x+Math.cos(a)*r*.8,f.y+Math.sin(a)*r*.8,5+k%3,f.color,fade*.65);}}
  }
  function drawParticle(p){if(!visible(p.x,p.y,30))return;const opacity=clamp(p.lifeMs/p.initialMs,0,1);
    if(p.kind==='erasedStroke'){
      // Small expelled graphite fragments make death feel like an erased drawing.
      const dx=Math.cos(p.angle)*p.segment*.5,dy=Math.sin(p.angle)*p.segment*.5;
      P.line(p.x-dx,p.y-dy,p.x+dx,p.y+dy,2.5,SKETCH.ink,opacity*.87);
      P.line(p.x-dx*.86,p.y-dy*.86+2,p.x+dx*.8,p.y+dy*.8+2,1.1,p.color,opacity*.50);
      return;
    }
    P.dot(p.x,p.y,Math.max(.5,p.r*opacity),p.color,opacity);}
  function drawPickup(p){if(!visible(p.x,p.y,30))return;const wig=Math.sin(paintClockMs*.004+p.x)*2;P.ring(p.x,p.y+wig,9,'#8ba893',.4,1.5,14);P.dot(p.x,p.y+wig,5,'#769985');P.dot(p.x-1.5,p.y-1.5+wig,2,'#fffae2',.9);}
  const anchorReuse={x:0,y:0};
  function renderText(){txtCtx.setTransform(screenDpr,0,0,screenDpr,0,0);txtCtx.clearRect(0,0,vw,vh);
    for(const f of sceneViews.floater){if(!f||!visible(f.x,f.y,40))continue;renderer.worldToScreenInto(f.x,f.y,anchorReuse);const a=clamp(f.lifeMs/250,0,1);txtCtx.globalAlpha=a;txtCtx.textAlign='center';const life=1-f.lifeMs/680,pop=1+.38*Math.exp(-life*12),px=anchorReuse.x,py=anchorReuse.y;
      txtCtx.translate(px,py);txtCtx.scale(pop,pop);txtCtx.translate(-px,-py);
      txtCtx.font='1000 17px system-ui,sans-serif';txtCtx.lineWidth=4.0;txtCtx.strokeStyle='#fff9ee';txtCtx.strokeText(f.text,anchorReuse.x,anchorReuse.y);txtCtx.fillStyle=f.color;txtCtx.fillText(f.text,anchorReuse.x,anchorReuse.y);txtCtx.setTransform(screenDpr,0,0,screenDpr,0,0);}
    if(visible(504,735,140)){renderer.worldToScreenInto(504,625,anchorReuse);txtCtx.textAlign='center';txtCtx.font='900 12px system-ui';txtCtx.lineWidth=3.4;txtCtx.strokeStyle='#fffaf0';txtCtx.strokeText('푸른 잉크 샘 · 회복',anchorReuse.x,anchorReuse.y);txtCtx.fillStyle='#568276';txtCtx.fillText('푸른 잉크 샘 · 회복',anchorReuse.x,anchorReuse.y);}
    for(const boss of world.enemies)if(boss.kind==='boss'&&!boss.dead&&visible(boss.x,boss.y,100)){renderer.worldToScreenInto(boss.x,boss.y-boss.r-56,anchorReuse);txtCtx.textAlign='center';txtCtx.font='900 13px system-ui';txtCtx.lineWidth=3.7;txtCtx.strokeStyle='#fffaf0';{const label=bossSealed(boss.bossId)?`${boss.name} · 봉인 −90%`:boss.name;txtCtx.strokeText(label,anchorReuse.x,anchorReuse.y);txtCtx.fillStyle=bossSealed(boss.bossId)?'#7d5a9e':'#8c647e';txtCtx.fillText(label,anchorReuse.x,anchorReuse.y);}}
    txtCtx.globalAlpha=1;drawMapLabels();
  }
  let lastCameraAt=0;
  function cameraPose(){const z=vw<590?.80:vw<900?.88:1.03;camera.zoom=z;const hw=vw/(2*z),hh=vh/(2*z),targetX=clamp(player.x,Math.min(hw,CFG.world.width/2),Math.max(hw,CFG.world.width-hw)),targetY=clamp(player.y,Math.min(hh,CFG.world.height/2),Math.max(hh,CFG.world.height-hh));
    const elapsed=lastCameraAt?clamp(paintFrameNow-lastCameraAt,0,64):16.667;
    lastCameraAt=paintFrameNow;
    // Exponential camera easing is frame-rate independent; the target is the same sampled hero model as body and shadow.
    const weight=1-Math.exp(-elapsed/74);
    camera.x=mix(Number.isFinite(camera.x)?camera.x:targetX,targetX,weight);
    camera.y=mix(Number.isFinite(camera.y)?camera.y:targetY,targetY,weight);
    renderer.setCamera({x:camera.x,y:camera.y,zoom:z,rotation:0});}
  function drawRollMarks(){
    for(const t of sceneViews.rollMark){if(!t||!visible(t.x,t.y,60))continue;const a=clamp(t.lifeMs/t.maxLifeMs,0,1),dx=t.dirX,dy=t.dirY;
      const sx=-dy,sy=dx,dist=(1-a)*13;
      // Sketched ring, tilting and breaking apart with motion.
      for(let k=0;k<3;k++){
        const size=7+k*2.6;
        P.line(t.x-dx*(size+dist)+sx*(k-1)*6,t.y-dy*(size+dist)+sy*(k-1)*6,
          t.x-dx*(size*.5+dist)+sx*(k-1)*7,t.y-dy*(size*.5+dist)+sy*(k-1)*7,1.3+k*.18,'#668c84',a*.42);
      }
      P.line(t.x-sx*7,t.y-sy*7,t.x+sx*9,t.y+sy*9,1.1,'#8b9d8e',a*.38);
    }
    if(sceneViews.rollTarget.length){const t=sceneViews.rollTarget[0];if(!t)return;const a=clamp(t.lifeMs/t.maxLifeMs,0,1);
      P.ring(t.x,t.y,8+(1-a)*7,'#6f9b88',a*.52,1.35,14);
      P.line(t.x-5,t.y,t.x+5,t.y,1.1,'#547c75',a*.48);
      P.line(t.x,t.y-5,t.x,t.y+5,1.1,'#547c75',a*.48);
    }
  }
  const worldDrawSlots=[];let worldDrawCount=0;
  function enqueueWorldDraw(type,ref,y){let node=worldDrawSlots[worldDrawCount];if(!node){node={type:null,ref:null,y:0};worldDrawSlots[worldDrawCount]=node;}
    node.type=type;node.ref=ref;node.y=y;worldDrawCount++;worldDraw.push(node);
  }
  function renderWorld(){cameraPose();if(!renderer.beginFrame(WORLD_C))return;ground();drawRollMarks();
    worldDraw.length=0;worldDrawCount=0;
    for(const h of world.houses)if(visible(h.x,h.y,160))enqueueWorldDraw('house',h,h.y+45);
    for(const t of world.trees)if(visible(t.x,t.y,100))enqueueWorldDraw('tree',t,t.y+t.r*.5);
    for(const view of sceneViews.enemy){if(view&&visible(view.x,view.y,120))enqueueWorldDraw('enemy',view,view.y+view.r*.5);}
    for(const view of sceneViews.summon){if(view&&visible(view.x,view.y,120))enqueueWorldDraw('summon',view,view.y+view.r*.5);}
    for(const view of sceneViews.hero){if(view)enqueueWorldDraw('hero',view,view.y+view.r*.5);}worldDraw.sort((a,b)=>a.y-b.y);
    for(const item of worldDraw){if(item.type==='house')drawHouse(item.ref);else if(item.type==='tree')drawTree(item.ref);else if(item.type==='enemy')enemyBody(item.ref);else if(item.type==='summon')drawSummon(item.ref);else withActor(item.ref,()=>playerBody());}
    for(const view of sceneViews.field)drawField(view);
    for(const view of sceneViews.cast)drawCast(view);
    for(const view of sceneViews.pickup)drawPickup(view);
    for(const view of sceneViews.hazard)drawHazard(view);
    for(const view of sceneViews.particle)drawParticle(view);
    if(mp.shared){const view=sceneViews.hero.find(v=>v.actorId===(mp.role==='join'?'a':'b'));if(view)P.ring(view.x,view.y,view.r+17,'#659cb0',.55,1.4,21);}
    if(player.hp<player.maxHp&&player.hp>0){const radius=player.r+14;P.ring(player.x,player.y,radius,'#ac766e',.25,1.1,18);}
    renderer.endFrame();renderText();
  }

