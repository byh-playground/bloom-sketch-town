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
  const WORLD_C=[.973,.955,.907,1],worldDraw=[];
  const txtCanvas=document.createElement('canvas');txtCanvas.id='worldText';txtCanvas.setAttribute('aria-hidden','true');txtCanvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';field.after(txtCanvas);
  const txtCtx=txtCanvas.getContext('2d');const textAnchor={x:0,y:0};let screenDpr=1,lastUiMs=0;
  function visible(x,y,r=80){const hx=vw/(camera.zoom*2)+r,hy=vh/(camera.zoom*2)+r;return Math.abs(x-camera.x)<hx&&Math.abs(y-camera.y)<hy;}
  const ROAD=[[490,735],[740,715],[990,725],[1260,735],[1510,742],[1750,722],[1950,708]];
  const TREE_LOBES=[[-.4,-.29,.70],[.45,-.24,.77],[0,-.65,.83],[0,-.12,.94]];
  function ground(){
    P.box(CFG.world.width/2,CFG.world.height/2,CFG.world.width,CFG.world.height,'#f7f0df');
    P.oval(484,740,368,318,'#f2e5ca',.72);P.oval(1780,739,530,460,'#e8eddc',.69);P.oval(1950,709,330,300,'#e3e1df',.42);
    P.oval(CFG.boss.x,CFG.boss.y,CFG.boss.radius*.89,CFG.boss.radius*.89,'#e7deea',.42);
    P.ring(CFG.boss.x,CFG.boss.y,CFG.boss.radius,'#afa0b0',.49,2.1,56);
    P.ring(CFG.boss.x,CFG.boss.y,CFG.boss.radius*.70,'#a994ab',.18,2,44);
    // Inscribed rays inside ancient arena, pale enough to stay below enemies in the visual hierarchy.
    for(let k=0;k<10;k++){const a=k/10*Math.PI*2,ra=174,rb=224;P.line(CFG.boss.x+Math.cos(a)*ra,CFG.boss.y+Math.sin(a)*ra,CFG.boss.x+Math.cos(a)*rb,CFG.boss.y+Math.sin(a)*rb,3,'#c1a6c2',.27);}
    P.path(ROAD,65,'#e3d7bf',1);P.path(ROAD,55,'#f5e8cf',1);
    P.path(ROAD,2.4,'#b5a58a',.35);
    for(let x=0;x<=CFG.world.width;x+=105){if(!visible(x,camera.y,140))continue;for(let y=0;y<=CFG.world.height;y+=105){if(!visible(x,y,20))continue;P.line(x-3,y,x+3,y,.9,'#c3b8a5',.28);P.line(x,y-3,x,y+3,.9,'#c3b8a5',.28);}}
    P.line(10,11,CFG.world.width-10,11,2,'#64757a',.32);P.line(CFG.world.width-10,11,CFG.world.width-10,CFG.world.height-10,2,'#64757a',.32);
    P.line(CFG.world.width-10,CFG.world.height-10,10,CFG.world.height-10,2,'#64757a',.32);P.line(10,CFG.world.height-10,10,11,2,'#64757a',.32);
    // Village safety circle and the ink-upgrade workbench.
    P.oval(504,735,98,81,'#dceade',.65);P.ring(504,735,92,'#86a68e',.52,1.8,28);
    P.dot(503,730,16,'#fafbf3');P.ring(503,730,17,'#789b89',.73,2,24);P.dot(503,730,7,'#a5c9a3',.8);
    P.box(683,616,58,38,'#a8886b');P.box(683,605,63,17,'#fbebcc');P.line(653,595,713,594,2,'#6f665b');P.dot(683,592,4,'#bd8760');
    P.ring(683,615,74,'#ddbd87',.27,2.2,38);
    P.line(695,630,673,636,4,'#6d6261');
    for(const d of world.decals){if(!visible(d.x,d.y,35))continue;const sway=Math.sin(paintClockMs*.0013+d.seed)*1.6;
      if(d.kind==='flower'){P.dot(d.x,d.y+1,2,'#8aa783',.75);for(let a=0;a<4;a++){const an=a*Math.PI/2+d.seed;P.dot(d.x+Math.cos(an)*5,d.y+Math.sin(an)*5+sway,2.8,'#e9bb91',.46);}P.dot(d.x,d.y,1.8,'#ba995a');}
      else{P.line(d.x-4,d.y+3,d.x-1,d.y-3+sway,1.2,'#a4b09a',.5);P.line(d.x+2,d.y+4,d.x+4,d.y-2+sway,1.2,'#a4b09a',.43);}}
  }
  function drawHouse(h){const {x,y,w,h:height,type}=h;if(!visible(x,y,140))return;const col=type==='shop'?'#d2ba9f':type==='library'?'#a9c6c2':'#d4c4a8';
    P.oval(x,y+height*.59,w*.48,18,'#a89b8b',.18);P.box(x,y+20,w,height*.62,'#4c5557');P.box(x,y+16,w-5,height*.56,col);
    P.tri({x:x-w*.62,y:y-height*.09},{x:x,y:y-height*.75},{x:x+w*.62,y:y-height*.09},'#334148');
    P.tri({x:x-w*.58,y:y-height*.10},{x:x,y:y-height*.70},{x:x+w*.58,y:y-height*.10},type==='library'?'#718f8e':type==='shop'?'#aa7b71':'#bc8a6b');
    P.line(x-w*.54,y-height*.10,x,y-height*.66,3,'#fff6e5',.37);
    for(const dx of [-w*.29,w*.29]){P.box(x+dx,y+12,24,29,'#445b61');P.box(x+dx,y+12,19,24,'#f0e9be');P.line(x+dx-9,y+12,x+dx+9,y+12,2,'#80938f');}
    P.box(x,y+height*.33,31,43,'#5f7170');P.dot(x+9,y+height*.30,2.8,'#f8daa0');
    P.line(x-w*.49,y+height*.53,x+w*.49,y+height*.53,2,'#e8dac3');
  }
  function drawTree(t){if(!visible(t.x,t.y,85))return;const {x,y,r,kind,variant}=t;if(kind==='rock'){
      P.oval(x+2,y+9,r*.8,r*.36,'#8e8d81',.18);P.oval(x,y-r*.1,r*.83,r*.75,'#46585b');P.oval(x-1,y-r*.18,r*.75,r*.68,'#b7b6a7');
      P.line(x-r*.50,y-r*.28,x-.7*r,y-r*.48,2,'#e7ded0',.85);P.line(x-r*.2,y-r*.64,x+r*.33,y-r*.24,1.5,'#f5f1dc',.7);return;}
    P.oval(x,y+r*.75,r*.76,r*.22,'#8c9588',.25);P.box(x,y+r*.32,11,r*.8,'#6e7568');P.box(x,y+r*.29,7,r*.76,'#c4b79a');
    const g=variant>.52?'#799b88':'#94ad88',h=variant>.52?'#97b59a':'#b3c49a';
    for(const [ox,oy,sz] of TREE_LOBES){
      P.oval(x+ox*r,y+oy*r,r*sz*1.07,r*sz*.96,'#546d66',.83);P.oval(x+ox*r,y+oy*r-2,r*sz*.93,r*sz*.82,g,.93);}
    P.line(x-r*.27,y-r*.59,x-r*.08,y-r*.78,1.7,h,.77);
    P.dot(x+r*.43,y-r*.57,2.4,'#f4d9a3',.57);
  }
  // Procedural pencil grammar. Authoritative hitboxes remain untouched; this is GPU-only art.
  // Each creature keeps an ID-seeded silhouette; only subpixel contour offsets change at ~8 fps.
  const SKETCH={ink:'#384650',boilMs:135,hitFlashMs:175,contourWidth:2.55,echoWidth:1.15,hatchWidth:1.25};
  const creaturePalette={
    chaser:{paper:'#e7c4b7',coat:'#c99591',ink:'#554952',hatch:'#8d6c70'},
    spitter:{paper:'#d9d2dd',coat:'#aaa1be',ink:'#505060',hatch:'#78728b'},
    charger:{paper:'#e8cba8',coat:'#c49a78',ink:'#55515a',hatch:'#92715f'},
    boss:{paper:'#e4cce2',coat:'#a889b0',ink:'#4c405c',hatch:'#866e95'}
  };
  function hashSketch(id,index,salt=0){
    let n=Math.imul(id+17117,374761393)^Math.imul(index+11,668265263)^Math.imul(salt+29,2246822519);
    n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;
  }
  const sketchX=new Float32Array(38),sketchY=new Float32Array(38);
  const sketchContours=new WeakMap();let sketchContourBuilds=0,sketchContourHits=0;
  function pencilBlob(e,part,cx,cy,rx,ry,fill,ink,{count=16,contour=2.45,shimmer=1.1,alpha=1}={}){
    const phase=Math.floor(paintClockMs/SKETCH.boilMs)%3;
    let cache=sketchContours.get(e);if(!cache){cache=new Map();sketchContours.set(e,cache);}
    const key=part+':'+count+':'+rx+':'+ry+':'+shimmer;
    let phaseCache=cache.get(key);if(!phaseCache){phaseCache=[null,null,null];cache.set(key,phaseCache);}
    let vertices=phaseCache[phase];
    if(!vertices){sketchContourBuilds++;vertices=new Float32Array(count*2);
      const radVar=e.kind==='boss'?.062:.075;
      for(let i=0;i<count;i++){
        const a=i/count*Math.PI*2;
        const noise=(hashSketch(e.id,i,part)-.5)*radVar*2;
        const boil=(hashSketch(e.id,i,part+31+phase)-.5)*shimmer;
        vertices[i*2]=Math.cos(a)*rx*(1+noise)+Math.cos(a+1.2)*boil;
        vertices[i*2+1]=Math.sin(a)*ry*(1+noise)+Math.sin(a+1.2)*boil;
      }
      phaseCache[phase]=vertices;
    }else sketchContourHits++;
    for(let i=0;i<count;i++){sketchX[i]=cx+vertices[i*2];sketchY[i]=cy+vertices[i*2+1];}
    const col=tint(fill,alpha);
    for(let i=0;i<count;i++){const j=(i+1)%count;renderer.triangle(cx,cy,sketchX[i],sketchY[i],sketchX[j],sketchY[j],col);}
    for(let i=0;i<count;i++){const j=(i+1)%count;
      P.line(sketchX[i]+1.25,sketchY[i]-.85,sketchX[j]+1.25,sketchY[j]-.85,SKETCH.echoWidth,ink,.26);
      P.line(sketchX[i],sketchY[i],sketchX[j],sketchY[j],contour*(i%5===0?.78:1),ink,.94);
    }
    for(let i=0;i<3;i++){
      const a=(hashSketch(e.id,i,part+47)*Math.PI*2),xx=Math.cos(a)*rx*.92,yy=Math.sin(a)*ry*.93;
      P.line(cx+xx-3,cy+yy-1,cx+xx+Math.cos(a+.6)*7,cy+yy+Math.sin(a+.6)*7,.9,ink,.24);
    }
  }
  function pencilRim(id,part,cx,cy,rx,ry,ink,alpha=.74){
    let firstX=0,firstY=0,prevX=0,prevY=0;
    const count=17,phase=Math.floor(paintClockMs/SKETCH.boilMs)%3;
    for(let i=0;i<=count;i++){
      const index=i%count,a=index/count*Math.PI*2;
      const jig=(hashSketch(id,index,part)-.5)*.075;
      const boil=(hashSketch(id,index,part+71+phase)-.5)*.7;
      const xx=cx+Math.cos(a)*rx*(1+jig)+boil,yy=cy+Math.sin(a)*ry*(1+jig)-boil*.48;
      if(i===0){firstX=xx;firstY=yy;}else{
        const ex=i===count?firstX:xx,ey=i===count?firstY:yy;
        P.line(prevX,prevY,ex,ey,1.55,ink,alpha);
        if(i%3!==0)P.line(prevX+.85,prevY-.7,ex+.85,ey-.7,.7,ink,alpha*.32);
      }
      prevX=xx;prevY=yy;
    }
  }
  function pencilPath(e,part,cx,cy,r,pts,color='#4c5058',width=2.2,alpha=.96){
    if(!pts.length)return;const phase=Math.floor(paintClockMs/SKETCH.boilMs)%3;
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i],n=(hashSketch(e.id,i,part+phase*17)-.5)*.72;
      const ax=cx+a[0]*r,ay=cy+a[1]*r,bx=cx+b[0]*r,by=cy+b[1]*r;
      const mx=(ax+bx)*.5+n,my=(ay+by)*.5-n*.7;
      P.line(ax+.7,ay-.6,mx+1,my-.8,Math.max(.6,width*.55),color,alpha*.27);
      P.line(ax,ay,mx,my,width,color,alpha);
      P.line(mx,my,bx,by,width*(i%3===0?.78:1),color,alpha);
    }
  }
  function pencilHatching(e,cx,cy,r,color,strength=.38){
    // Short diagonal strokes stay inside the flank so faces and hit warnings remain legible.
    for(let j=0;j<5;j++){
      const y0=-.46+j*.22,x0=-.64+(j%2)*.055;
      const seed=(hashSketch(e.id,j,46)-.5)*.065;
      P.line(cx+(x0+seed)*r,cy+y0*r,cx+(x0+.20+seed)*r,cy+(y0-.115)*r,SKETCH.hatchWidth,color,strength);
    }
  }
  function pencilLegs(e,x,y,r,color,run=.8){
    const t=e.ageMs*.012+e.id,walk=Math.sin(t)*run;
    pencilPath(e,51,x,y,r,[[-.36,.36],[-.39-walk*.22,.79],[-.55-walk*.15,.91]],color,2.6);
    pencilPath(e,52,x,y,r,[[.34,.35],[.35+walk*.22,.8],[.51+walk*.15,.92]],color,2.6);
  }
  function pencilFace(e,x,y,r,ink,style){
    const blink=Math.sin(e.ageMs*.002+e.id*3.3)>.995;
    if(style==='spitter'){
      P.dot(x-r*.16,y-r*.16,r*.125,ink);P.dot(x+r*.23,y-r*.16,r*.09,ink);
      pencilPath(e,65,x,y,r,[[-.12,.21],[.07,.31],[.21,.14]],ink,1.7);
    }else if(style==='boss'){
      if(blink){P.line(x-r*.28,y-r*.16,x-r*.09,y-r*.16,2.5,ink);P.line(x+r*.09,y-r*.16,x+r*.28,y-r*.16,2.5,ink);}
      else{P.dot(x-r*.20,y-r*.17,r*.095,ink);P.dot(x+r*.20,y-r*.17,r*.095,ink);}
      pencilPath(e,66,x,y,r,[[-.2,.19],[-.02,.24],[.17,.16]],ink,2.2);
    }else{
      if(blink){P.line(x-r*.32,y-r*.22,x-r*.11,y-r*.20,1.8,ink);P.line(x+r*.12,y-r*.22,x+r*.33,y-r*.20,1.8,ink);}
      else{P.dot(x-r*.21,y-r*.22,r*.095,ink);P.dot(x+r*.23,y-r*.22,r*.095,ink);}
      pencilPath(e,67,x,y,r,[[-.14,.16],[.03,.22],[.18,.12]],ink,1.55);
    }
  }
  function playerMood(run){
    if(world.mode==='down'||player.hp<=0)return 'down';
    if(player.invulMs>350)return 'hurt';
    if(world.casts.some(c=>c.owner===player.actorId))return 'cast';
    if(player.hp/player.maxHp<.33)return 'low';
    if(player.dash.leftMs>0)return 'dash';
    if(run)return 'move';
    return 'idle';
  }
  function playerFace(x,y,r,mood,fx,fy,paint){
    const D=paint,ex=r*.38,ey=r*.10;
    if(mood==='down'){
      for(const xx of [x-ex,x+ex]){D.line(xx-1.4,y-ey-1.4,xx+1.4,y-ey+1.4,1.35,'#26343a');D.line(xx+1.4,y-ey-1.4,xx-1.4,y-ey+1.4,1.35,'#26343a');}
      D.line(x-3.5,y+r*.34,x+3.5,y+r*.38,1.1,'#8b6a61');return;
    }
    const blink=mood==='dash'||(Math.floor(paintClockMs/780)%7===0&&mood==='idle');
    if(blink){D.line(x-ex-1,y-ey,x-ex+1.8,y-ey+.6,1.2,'#26343a');D.line(x+ex-1,y-ey,x+ex+1.8,y-ey+.6,1.2,'#26343a');}
    else{D.dot(x-ex,y-ey,1.5,'#26343a');D.dot(x+ex,y-ey,1.5,'#26343a');}
    if(mood==='hurt'){
      D.line(x-ex-3,y-ey-4,x-ex+2,y-ey-6,1,'#42535a');D.line(x+ex-2,y-ey-6,x+ex+3,y-ey-4,1,'#42535a');
      D.line(x-3.5,y+r*.34,x+3.5,y+r*.26,1.4,'#9b6a61');
    }else if(mood==='low'){
      D.line(x-ex-2.5,y-ey-4,x-ex+1.5,y-ey-2.5,1,'#42535a');D.line(x+ex-1.5,y-ey-2.5,x+ex+2.5,y-ey-4,1,'#42535a');
      D.line(x-4,y+r*.33,x-1,y+r*.42,1.2,'#916863');D.line(x-1,y+r*.42,x+4,y+r*.33,1.2,'#916863');
    }else if(mood==='cast'){
      D.line(x-ex-2,y-ey-4,x-ex+1.5,y-ey-5.2,1,'#42535a');D.line(x+ex-1.5,y-ey-5.2,x+ex+2,y-ey-4,1,'#42535a');
      D.oval(x,y+r*.32,4.8,3.4,'#b26e59',.95);
    }else if(mood==='move'){
      D.line(x-ex-2.2,y-ey-3.3,x-ex+1.7,y-ey-4.5,1,'#42535a');D.line(x+ex-1.7,y-ey-4.5,x+ex+2.2,y-ey-3.3,1,'#42535a');
      D.line(x-3.2,y+r*.32,x+3.4,y+r*.38,1.1,'#8f6b61');
    }else if(mood==='dash'){D.line(x-3.6,y+r*.31,x+3.8,y+r*.17,1.1,'#8f6b61');}
    else{D.line(x-3.6,y+r*.28,x,y+r*.39,1.1,'#916f66');D.line(x,y+r*.39,x+3.8,y+r*.28,1.1,'#916f66');}
    if(Math.abs(fx)>.45)D.line(x+(fx>0?1.4:-1.4),y+r*.15,x+(fx>0?4.2:-4.2),y+r*.16,1,'#f0c487',.45);
  }
  function playerBody(){
    const x=player.x,y=player.y,running=player.dash.leftMs>0;
    player.castActive=world.casts.some(c=>c.owner===player.actorId)||(player.castPreviewMs||0)>0;
    const t=paintClockMs*.013,bob=Math.sin(t)*1.35,mood=playerMood(running),dash=player.dash;
    P.oval(x,y+16,17,5.5,'#62716c',.18);
    const rolling=dash.leftMs>0;
    if(rolling){
      const progress=clamp(dash.elapsedMs/Math.max(1,dash.durationMs),0,1);
      // Full forward-tumble rotation of the stickman, with scale recovery and displaced hat tip.
      const spin=(dash.dirX<0?-1:1)*progress*2*Math.PI,cs=Math.cos(spin),sn=Math.sin(spin);
      const cx=x,cy=y-6,radial=.99-Math.sin(Math.PI*progress)*.16;
      const projected=(xx,yy)=>{const dx=xx-cx,dy=yy-cy;return {x:cx+(dx*cs-dy*sn)*radial,y:cy+(dx*sn+dy*cs)*radial};};
      const D={
        line(ax,ay,bx,by,w,c,a=1){const p=projected(ax,ay),q=projected(bx,by);P.line(p.x,p.y,q.x,q.y,w,c,a);},
        dot(xx,yy,r,c,a=1){const p=projected(xx,yy);P.dot(p.x,p.y,r,c,a);},
        oval(xx,yy,rx,ry,c,a=1){const p=projected(xx,yy);P.oval(p.x,p.y,rx*radial,ry*radial,c,a);}
      };
      const leg=Math.sin(t+progress*8)*2.8,fx=dash.dirX,fy=dash.dirY;
      const trunk=y+3+bob;
      D.line(x,trunk-3,x,trunk+9,3.7,'#32464b');
      D.line(x,trunk+8,x-6-leg,y+20,3.4,'#33474b');D.line(x,trunk+8,x+6+leg,y+20,3.4,'#33474b');
      D.line(x-1,trunk-1,x-9,y+4,2.9,'#33474b');D.line(x+1,trunk-1,x+9,y+3,2.9,'#33474b');
      // Hat with rim and bent tip, both rotating with the character rather than just the head.
      const hx=x,hy=y-12+bob,tipBend=Math.sin(Math.PI*progress)*4;
      D.oval(hx,hy,11,11,'#2b393d');D.oval(hx,hy-.25,9.8,10,'#f5d7aa');
      D.line(hx-9,hy-8,hx+9,hy-8,4.7,'#36484b');
      D.line(hx-7,hy-9,hx+tipBend,hy-23,3.5,'#546b76');D.line(hx+7,hy-8,hx+tipBend,hy-23,3.5,'#546b76');
      D.dot(hx+tipBend+1.5,hy-24,2.2,'#dca16b');
      playerFace(hx,hy,10.5,'dash',fx,fy,D);
      P.ring(x,y,16+Math.sin(Math.PI*progress)*6,'#7da69b',.21,1.65,22);
      const a=paintClockMs*.030;for(let k=0;k<3;k++){
        const q=a+k*Math.PI*2/3;P.line(x+Math.cos(q)*21,y+Math.sin(q)*21,x+Math.cos(q+.45)*24,y+Math.sin(q+.45)*24,1.8,'#759b92',.52);
      }
      return;
    }
    if(player.invulMs>0&&Math.floor(paintClockMs/93)%2===1&&mood!=='hurt')P.ring(x,y,22,'#80a59c',.65,2.2);
    const anticipation=(player.castPreviewMs||0)>0,casting=world.casts.some(c=>c.owner===player.actorId);
    const leg=Math.sin(t)*(running?5.7:1.4),armSwing=Math.cos(t)*(running?4.6:1.5),castLift=casting||anticipation?7:0;
    const fx=player.faceX||1,fy=player.faceY||0;
    P.line(x,y-1+bob,x,y+11+bob,3.4,'#35464b');
    P.line(x,y+8+bob,x-6-leg*.45,y+20,3.2,'#35464b');P.line(x,y+8+bob,x+6+leg*.45,y+20,3.2,'#35464b');
    P.line(x-1,y+1+bob,x-8-armSwing*.7,y+5+bob-castLift,2.7,'#35464b');
    const handX=x+8+armSwing*.55+fx*2.2,handY=y+4+bob-castLift-fy*1.6;
    P.line(x+1,y+1+bob,handX,handY,2.7,'#35464b');
    const tipX=handX+fx*17,tipY=handY+fy*17;
    P.line(handX,handY,tipX,tipY,3.9,'#7f6754');P.dot(tipX,tipY,3.8,'#e6bb72');
    if(casting||anticipation){P.dot(tipX+Math.cos(t*1.7)*2,tipY+Math.sin(t*1.5)*2,2.4,'#f0d09a',.85);P.ring(x,y,22+3*Math.sin(t*1.1),'#c19a68',.45,1.8,18);}
    const hx=x,hy=y-13+bob,hr=10.9;
    P.oval(hx,hy+1,11.6,11.9,'#2b393d');P.oval(hx,hy,10.2,10.4,'#f5d7aa');
    const angle=Math.atan2(fy,fx||.0001),baseY=hy-7.2,tipHatX=hx+Math.cos(angle-.3)*5.7,tipHatY=hy-20.5+Math.sin(angle-.3)*3.2;
    P.line(hx-8.5,baseY,hx+8.2,baseY+1.5,4.6,'#36484b');
    P.line(hx-7.2,baseY-1.1,tipHatX,tipHatY,4.2,'#536b75');P.line(hx+7,baseY+.2,tipHatX,tipHatY,4.2,'#536b75');
    P.line(hx-7.8,baseY-1.4,hx+7.8,baseY+1.2,1.5,'#2f4146',.9);P.dot(tipHatX+4.4,tipHatY-4.1,2.2,'#dca16b');
    P.line(hx-5.6,hy+7.8,hx+4.8,hy+10.6,2,'#e7be86',.84);
    playerFace(hx,hy,hr,mood,fx,fy,P);
    pencilRim(147,81,hx,hy,11.5,11.8,'#3b5558',.58);
    pencilPath({id:147},82,hx,hy,1,[[-7.5,-9.5],[-5.5,-14.2],[1.0,-20.2],[8.2,-6.8]],'#32474b',1.45,.45);
    pencilPath({id:147},83,x,y,1,[[-1,-1],[0,11]],'#465b60',1.1,.42);
    if(mood==='low'){P.line(hx+8.5,hy-1,hx+11.8,hy+3,1.1,'#7ca7b4',.9);P.dot(hx+12.2,hy+4.8,1.6,'#7ca7b4',.86);}
  }
  function enemyBody(e){if(!visible(e.x,e.y,130))return;
    const {x,y,r,kind}=e,p=creaturePalette[kind],hit=e.hitMs>0;
    const bob=Math.sin(e.ageMs*(kind==='spitter'?.006:.010)+e.id)*Math.min(2.1,r*.075);
    const cy=y-3+bob,ink=p.ink,phase=Math.floor(paintClockMs/SKETCH.boilMs);
    P.oval(x,y+r*.79,r*.83,r*.22,'#74726b',.13);
    // Strong warnings are drawn after the sketch body and remain geometrically stable.
    if(e.stunMs>0){P.ring(x,y-7,r+7,'#d2a257',.53,1.8,16);}
    if(kind==='chaser'){
      pencilLegs(e,x,y,r,ink,1);
      // Folded paper ears distinguish a pursuing hunter from the armored charger.
      pencilPath(e,10,x,cy,r,[[-.57,-.44],[-.95,-1.08],[-.38,-.77],[-.16,-.63]],ink,3.3);
      pencilPath(e,11,x,cy,r,[[.56,-.45],[.94,-1.08],[.34,-.77],[.17,-.63]],ink,3.3);
      pencilPath(e,12,x,cy,r,[[-.56,-.56],[-.72,-.85],[-.40,-.68]],'#ae7776',1.5,.85);
      pencilBlob(e,1,x,cy,r*.91,r*.81,hit?'#fff8df':p.paper,ink,{count:17});
      pencilHatching(e,x,cy,r,p.hatch,.45);
      pencilPath(e,13,x,cy,r,[[-.40,.51],[.01,.61],[.45,.44]],ink,1.3,.45);
      pencilFace(e,x,cy,r,ink,'chaser');
    }else if(kind==='spitter'){
      // Ink flower silhouette: five irregular petal blobs with thin connecting scribbles.
      for(let k=0;k<5;k++){
        const a=k*Math.PI*2/5+e.ageMs*.00040,px=x+Math.cos(a)*r*.58,py=cy+Math.sin(a)*r*.57;
        pencilBlob(e,22+k,px,py,r*.42,r*.39,hit?'#fff8e8':p.coat,ink,{count:9,contour:1.6,shimmer:.56});
        P.line(x+Math.cos(a)*r*.27,cy+Math.sin(a)*r*.27,px,py,1.35,ink,.47);
      }
      pencilBlob(e,2,x,cy,r*.67,r*.67,hit?'#fff8df':p.paper,ink,{count:14,contour:2.5});
      pencilHatching(e,x+1,cy+1,r*.69,p.hatch,.5);
      pencilFace(e,x,cy,r,ink,'spitter');
      P.dot(x+r*.43,cy+r*.16,2,'#f7efe7',.79);
    }else if(kind==='charger'){
      const charge=e.chargeMs>0,lean=charge?e.chargeDX*3.5:0;
      pencilLegs(e,x,y,r,ink,charge?2.2:.7);
      pencilPath(e,30,x+lean,cy,r,[[-.62,-.40],[-1.24,-1.05],[-1.02,-.44],[-.55,-.27]],ink,3.6);
      pencilPath(e,31,x+lean,cy,r,[[.62,-.40],[1.24,-1.05],[1.02,-.44],[.55,-.27]],ink,3.6);
      pencilBlob(e,3,x+lean,cy,r*1.02,r*.84,hit?'#fff8df':p.paper,ink,{count:18,contour:3.0});
      pencilPath(e,32,x+lean,cy,r,[[-.67,.30],[-.20,.44],[.33,.43],[.75,.25]],ink,2.0,.73);
      pencilHatching(e,x+lean,cy,r,p.hatch,.57);
      pencilFace(e,x+lean,cy,r,ink,'charger');
      if(charge)for(let i=0;i<3;i++){
        P.line(x-e.chargeDX*(r+8+i*8),y-e.chargeDY*(r+8+i*8)+i*4,x-e.chargeDX*(r+14+i*8),y-e.chargeDY*(r+14+i*8)+i*4,1.8,ink,.37);
      }
    }else if(kind==='boss'){
      // Seven paper-ink tendrils, not glossy orb geometry. Variant phase is entity-seeded.
      for(let k=0;k<7;k++){
        const a=k*Math.PI*2/7+e.ageMs*.00028;
        const ox=Math.cos(a)*r*.78,oy=Math.sin(a)*r*.72;
        pencilPath(e,100+k,x,cy,r,[[Math.cos(a)*.42,Math.sin(a)*.42],[Math.cos(a)*.82,Math.sin(a)*.76]],ink,3.1,.78);
        pencilBlob(e,42+k,x+ox,cy+oy,r*.42,r*.34,hit?'#fff5ea':p.coat,ink,{count:11,contour:2.2,shimmer:1.3});
      }
      pencilBlob(e,4,x,cy-r*.10,r*.74,r*.65,hit?'#fff9e6':p.paper,ink,{count:22,contour:3.4,shimmer:1.8});
      pencilHatching(e,x,cy,r*.83,p.hatch,.60);
      // Uneven nib crown: repeated triangle outlines resemble hurried pencil construction.
      for(let k=-1;k<=1;k++){
        pencilPath(e,63+k,x,cy,r,[[k*.27-.16,-.48],[k*.27,-1.15+(k===0?-.07:.05)],[k*.27+.16,-.46]],ink,2.7);
      }
      pencilFace(e,x,cy,r,ink,'boss');
      // A broken outer circular guide is secondary decoration, not the danger telegraph.
      for(let k=0;k<9;k++){
        const a=k*Math.PI*2/9+phase*.008,bb=a+.40;
        P.line(x+Math.cos(a)*(r+19),cy+Math.sin(a)*(r+19),x+Math.cos(bb)*(r+19),cy+Math.sin(bb)*(r+19),1.25,ink,.29);
      }
    }
    // Brief ink scratches on impact visually belong to the body and never alter collision.
    if(hit){
      const f=clamp(e.hitMs/SKETCH.hitFlashMs,0,1);
      for(let k=0;k<5;k++){
        const a=k*Math.PI*2/5+e.id*.31,len=(r*.66)+(1-f)*r*.28;
        const px=x+Math.cos(a)*(r*.30),py=cy+Math.sin(a)*(r*.30);
        P.line(px,py,px+Math.cos(a)*len,py+Math.sin(a)*len,1.8,'#fff8d9',f*.90);
        P.line(px+Math.sin(a)*2,py-Math.cos(a)*2,px+Math.cos(a)*len*.76+Math.sin(a)*2,py+Math.sin(a)*len*.76-Math.cos(a)*2,1.0,ink,f*.48);
      }
    }
    if(e.windupMs>0){const alpha=clamp(e.windupMs/700,.18,1);P.ring(x,y,e.r+19,'#bf6556',.78-alpha*.24,3,26);
      if(e.attackType==='charge'){const dx=player.x-x,dy=player.y-y,m=hypot(dx,dy)||1;P.line(x,y,x+dx/m*260,y+dy/m*260,4,'#c87961',.35);}}
    if(e.hp<e.maxHp){const pct=clamp(e.hp/e.maxHp,0,1),bar=Math.max(28,e.r*1.9);P.box(x,y-e.r-18,bar,5,'#605660',.65);if(pct>0)P.box(x-bar*(1-pct)/2,y-e.r-18,bar*pct,4,kind==='boss'?'#a75e84':'#a87e79');}
  }
  function drawStroke(points,x,y,angle=0,size=1,color='#4e6269',alpha=1,width=2.6,progress=1){if(!points?.length)return;const cs=Math.cos(angle),sn=Math.sin(angle);let total=0;for(let i=1;i<points.length;i++)total+=hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y);const upto=total*clamp(progress,0,1);let walked=0;
    for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],d=hypot(b.x-a.x,b.y-a.y);if(walked>=upto)break;const t=clamp((upto-walked)/Math.max(.00001,d),0,1);const ax=x+(a.x*cs-a.y*sn)*size,ay=y+(a.x*sn+a.y*cs)*size,bx=x+((a.x+(b.x-a.x)*t)*cs-(a.y+(b.y-a.y)*t)*sn)*size,by=y+((a.x+(b.x-a.x)*t)*sn+(a.y+(b.y-a.y)*t)*cs)*size;
      P.line(ax,ay,bx,by,width+1.6,'#fff5dc',alpha*.70);P.line(ax,ay,bx,by,width,color,alpha);walked+=d;}
  }
  function drawCast(c){if(!visible(c.x,c.y,100))return;const p=clamp(c.ageMs/c.durationMs,0,1),angle=0;P.ring(c.x,c.y,37+p*15,c.shot.color,(1-p)*.28,1.7,23);
    drawStroke(c.shot.shape,c.x,c.y-42,angle,1.35,c.shot.color,.95,2.6,p);
    const pts=c.shot.shape,n=pts.length-1; if(n>0){const fi=Math.min(n,Math.floor(n*p)),head=pts[fi];P.dot(c.x+head.x*1.35,c.y-42+head.y*1.35,4.8,'#fff1a1',.77);P.dot(c.x+head.x*1.35,c.y-42+head.y*1.35,2.6,c.shot.color,.95);}
  }
  function drawProjectile(p){
    if(!visible(p.x,p.y,80))return;
    for(let i=0;i<p.trail.length-1;i++){
      const a=p.trail[i],b=p.trail[i+1];
      P.line(a.x,a.y,b.x,b.y,(i+1)/p.trail.length*3.0,p.color,.09+(i/p.trail.length)*.34);
    }
    P.oval(p.x,p.y+5,p.r*.86,4.1,'#8f978f',.17);
    if(p.kind!=='normal'&&p.kind!=='line'){
      const wobble=paintClockMs*.009+p.id,pulse=1+.08*Math.sin(wobble);
      P.ring(p.x,p.y,(p.r+8)*pulse,p.color,.22,1.45,12);
      for(let k=0;k<3;k++){const a=wobble*.67+k*Math.PI*2/3;
        P.line(p.x+Math.cos(a)*p.r*.83,p.y+Math.sin(a)*p.r*.83,p.x+Math.cos(a+.19)*(p.r+7),p.y+Math.sin(a+.19)*(p.r+7),1.6,p.color,.55);}
      const remaining=p.bouncesLeft,mark=Math.min(6,remaining);for(let k=0;k<mark;k++){
        const a=-Math.PI*.70+k*.30;P.dot(p.x+Math.cos(a)*(p.r+13),p.y+Math.sin(a)*(p.r+13),1.5,p.color,.88);
      }
    }
    P.dot(p.x,p.y,p.r*.66,p.color,.13);drawStroke(p.shape,p.x,p.y,p.angle+paintClockMs*.0018*(p.kind==='normal'||p.kind==='line'?0:1),1.25,p.color,.97,3.0,1);
    P.dot(p.x,p.y,3.2,'#fff8d0',.83);
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
    for(const source of world.floaters){const f=presentationObject(source,'floater');if(!f||!visible(f.x,f.y,40))continue;renderer.worldToScreenInto(f.x,f.y,anchorReuse);const a=clamp(f.lifeMs/250,0,1);txtCtx.globalAlpha=a;txtCtx.textAlign='center';const life=1-f.lifeMs/680,pop=1+.38*Math.exp(-life*12),px=anchorReuse.x,py=anchorReuse.y;
      txtCtx.translate(px,py);txtCtx.scale(pop,pop);txtCtx.translate(-px,-py);
      txtCtx.font='1000 17px system-ui,sans-serif';txtCtx.lineWidth=4.0;txtCtx.strokeStyle='#fff9ee';txtCtx.strokeText(f.text,anchorReuse.x,anchorReuse.y);txtCtx.fillStyle=f.color;txtCtx.fillText(f.text,anchorReuse.x,anchorReuse.y);txtCtx.setTransform(screenDpr,0,0,screenDpr,0,0);}
    txtCtx.globalAlpha=1;txtCtx.textAlign='left';if(visible(683,616,150)){renderer.worldToScreenInto(683,561,anchorReuse);txtCtx.textAlign='center';txtCtx.font='900 12px system-ui';txtCtx.lineWidth=3.4;txtCtx.strokeStyle='#fff8ee';txtCtx.strokeText('✎ 연필 공방 · E',anchorReuse.x,anchorReuse.y);txtCtx.fillStyle='#5e635c';txtCtx.fillText('✎ 연필 공방 · E',anchorReuse.x,anchorReuse.y);}
    if(visible(504,735,140)){renderer.worldToScreenInto(504,625,anchorReuse);txtCtx.textAlign='center';txtCtx.font='900 12px system-ui';txtCtx.lineWidth=3.4;txtCtx.strokeStyle='#fffaf0';txtCtx.strokeText('푸른 잉크 샘 · 회복',anchorReuse.x,anchorReuse.y);txtCtx.fillStyle='#568276';txtCtx.fillText('푸른 잉크 샘 · 회복',anchorReuse.x,anchorReuse.y);}
    if(world.bossSpawned&&!world.bossDefeated&&visible(CFG.boss.x,CFG.boss.y,100)){renderer.worldToScreenInto(CFG.boss.x,CFG.boss.y-112,anchorReuse);txtCtx.textAlign='center';txtCtx.font='900 13px system-ui';txtCtx.lineWidth=3.7;txtCtx.strokeStyle='#fffaf0';txtCtx.strokeText('잉크 감시자',anchorReuse.x,anchorReuse.y);txtCtx.fillStyle='#8c647e';txtCtx.fillText('잉크 감시자',anchorReuse.x,anchorReuse.y);}
    txtCtx.globalAlpha=1;
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
    for(const source of world.rollMarks){const t=presentationObject(source,'rollMark');if(!t||!visible(t.x,t.y,60))continue;const a=clamp(t.lifeMs/t.maxLifeMs,0,1),dx=t.dirX,dy=t.dirY;
      const sx=-dy,sy=dx,dist=(1-a)*13;
      // Sketched ring, tilting and breaking apart with motion.
      for(let k=0;k<3;k++){
        const size=7+k*2.6;
        P.line(t.x-dx*(size+dist)+sx*(k-1)*6,t.y-dy*(size+dist)+sy*(k-1)*6,
          t.x-dx*(size*.5+dist)+sx*(k-1)*7,t.y-dy*(size*.5+dist)+sy*(k-1)*7,1.3+k*.18,'#668c84',a*.42);
      }
      P.line(t.x-sx*7,t.y-sy*7,t.x+sx*9,t.y+sy*9,1.1,'#8b9d8e',a*.38);
    }
    if(world.rollTarget){const t=presentationObject(world.rollTarget,'rollTarget');if(!t)return;const a=clamp(t.lifeMs/t.maxLifeMs,0,1);
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
    for(const e of world.enemies){if(e.dead)continue;const view=presentationObject(e,'enemy');if(view&&visible(view.x,view.y,120))enqueueWorldDraw('enemy',view,view.y+view.r*.5);}
    for(const actor of actors()){const view=presentationObject(actor,'hero');if(view)enqueueWorldDraw('hero',view,view.y+view.r*.5);}worldDraw.sort((a,b)=>a.y-b.y);
    for(const item of worldDraw){if(item.type==='house')drawHouse(item.ref);else if(item.type==='tree')drawTree(item.ref);else if(item.type==='enemy')enemyBody(item.ref);else withActor(item.ref,()=>playerBody());}
    for(const f of world.fields){const view=presentationObject(f,'field');if(view)drawField(view);}
    for(const c of world.casts){const view=presentationObject(c,'cast');if(view)drawCast(view);}
    for(const p of world.pickups){const view=presentationObject(p,'pickup');if(view)drawPickup(view);}
    for(const p of world.projectiles){const view=presentationObject(p,'shot');if(view)drawProjectile(view);}
    for(const p of world.hazards){const view=presentationObject(p,'hazard');if(view)drawHazard(view);}
    for(const p of world.particles){const view=presentationObject(p,'particle');if(view)drawParticle(view);}
    if(mp.shared){const other=mp.role==='join'?hostPlayer:guestPlayer,view=presentationObject(other,'hero');if(view)P.ring(view.x,view.y,view.r+17,'#659cb0',.55,1.4,21);}
    if(player.hp<player.maxHp&&player.hp>0){const radius=player.r+14;P.ring(player.x,player.y,radius,'#ac766e',.25,1.1,18);}
    renderer.endFrame();renderText();
  }

