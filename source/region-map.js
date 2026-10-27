  // World population and drawing for the run's MapLayout (see map-generator.js).
  // Nothing in this file decides where terrain is: ponds, ridges, props, spawns and the boss arena all come from mapLayout.
  let mapLayout=null;
  function applyMapLayout(mapSeed){
    mapLayout=generateMapLayout(mapSeed);
    world.mapSeed=mapSeed;
    world.obstacles.length=0;world.grid.clear();world.houses.length=0;world.trees.length=0;world.decals.length=0;
    for(const h of VILLAGE.houses)world.houses.push({...h});
    for(const o of mapLayout.solids)addObstacle({...o});
    for(const t of mapLayout.props)world.trees.push({...t});
    for(const l of mapLayout.landmarks)world.trees.push({...l,variant:0});
    for(const d of mapLayout.decals)world.decals.push({...d});
    $('mapSeed').textContent=String(mapSeed);
  }
  // The run's seed: ?seed=<0..4294967295> reproduces a map, otherwise a fresh random one.
  function initialMapSeed(){
    const raw=new URLSearchParams(location.search).get('seed');
    if(raw!==null&&/^\d{1,10}$/.test(raw)&&+raw<=0xFFFFFFFF)return +raw;
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  function sketchPolygon(points,color,alpha=1){const center={x:points.reduce((n,p)=>n+p[0],0)/points.length,y:points.reduce((n,p)=>n+p[1],0)/points.length};for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];P.tri(center,{x:a[0],y:a[1]},{x:b[0],y:b[1]},color,alpha);}}
  function sketchOutline(points,width,color,alpha=1){for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];P.line(a[0],a[1],b[0],b[1],width,color,alpha);}}
  function regionGround(){
    const [e1,e2]=mapLayout.edges,height=CFG.world.height,width=CFG.world.width;
    P.box(width/2,height/2,width,height,'#f4efdf');
    sketchPolygon([[0,0],...e1,[0,height]],'#e7ecd9');
    sketchPolygon([...e1,...e2.slice().reverse()],'#e1e9e2');
    sketchPolygon([...e2,[width,height],[width,0]],'#ebe4d8');
    for(const c of mapLayout.clearings){P.oval(c.x,c.y,c.rx,c.ry,c.color,.9);P.oval(c.x+20,c.y+15,c.rx*.83,c.ry*.78,'#f7f0df',.34);}
    for(const p of mapLayout.ponds){if(!visible(p.x,p.y,p.rx+40))continue;P.oval(p.x,p.y,p.rx+16,p.ry+16,'#b8c9bb',.48);P.oval(p.x,p.y,p.rx,p.ry,'#aac3c3',.56);for(let k=0;k<5;k++){const yy=p.y+(k-2)*p.ry*.29,len=p.rx*Math.sqrt(1-((yy-p.y)/p.ry)**2)*.7;P.line(p.x-len,yy,p.x+len*.65,yy+3,1.4,'#7faaa9',.29);}for(let k=0;k<9;k++){const a=k*Math.PI*2/9,x=p.x+Math.cos(a)*(p.rx+12),y=p.y+Math.sin(a)*(p.ry+8);P.line(x,y,x-7,y-19,1.1,'#879e91',.42);P.line(x,y,x+5,y-24,1.1,'#879e91',.42);}}
    for(const p of mapLayout.ridges){if(!visible(p.x,p.y,p.r+50))continue;const points=[[p.x-p.r,p.y+20],[p.x-p.r*.8,p.y-p.r*.8],[p.x+p.r*.1,p.y-p.r],[p.x+p.r,p.y-p.r*.35],[p.x+p.r*.9,p.y+p.r*.65],[p.x-p.r*.55,p.y+p.r*.85]];sketchPolygon(points,'#c4bcad',.7);sketchOutline(points,2,'#a99f90',.48);for(let i=0;i<3;i++)P.line(p.x-p.r*.65,p.y+i*18,p.x+p.r*.7,p.y-15+i*18,1.3,'#a69b8d',.34);}
    const route=mapLayout.routePoints;
    P.path(route,78,'#cabc9d',.25);P.path(route,60,'#f3e8d1',.82);P.path(route,1.4,'#aa9c82',.32);
    // Pencil edge marks give the route direction without competing with combat outlines.
    for(let i=2;i<route.length;i++){const a=route[i];P.line(a.x-8,a.y-46,a.x+9,a.y-43,1,'#a99f87',.36);}
  }
  function drawRegionProp(t){if(!['canopy','reed','slab','stump','bell','crane','crystal'].includes(t.kind))return false;const {x,y,r,kind}=t;if(!visible(x,y,r+70))return true;drawEnvironmentProp(kind,x,y,r);return true;}
  function drawMapLabels(){for(const landmark of mapLayout.landmarks){if(!visible(landmark.x,landmark.y,150))continue;renderer.worldToScreenInto(landmark.x,landmark.y-landmark.r-75,anchorReuse);txtCtx.textAlign='center';txtCtx.font='600 11px system-ui';txtCtx.lineWidth=3;txtCtx.strokeStyle='#f5f0e1';txtCtx.strokeText(landmark.label,anchorReuse.x,anchorReuse.y);txtCtx.fillStyle='#7c8478';txtCtx.fillText(landmark.label,anchorReuse.x,anchorReuse.y);}}
