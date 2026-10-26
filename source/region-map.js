  // Fixed region composition, shared by collision, sketch rendering and the minimap.
  // Seeded small props decorate the authored route; they never invent new traversal rules.
  const REGION_TERRAIN=Object.freeze({
    ponds:[{x:1780,y:295,rx:225,ry:155},{x:2350,y:325,rx:240,ry:145},{x:2020,y:1170,rx:265,ry:165},{x:2630,y:1120,rx:155,ry:135}],
    ridges:[{x:3230,y:300,r:100},{x:3540,y:340,r:110},{x:3860,y:275,r:115},{x:3250,y:1175,r:90},{x:3600,y:1120,r:105},{x:4110,y:1180,r:100}],
    clearings:[{x:1070,y:735,rx:260,ry:210,color:'#f2efdc'},{x:1890,y:750,rx:210,ry:180,color:'#ecebdd'},{x:2510,y:735,rx:210,ry:180,color:'#e9e9d9'},{x:3380,y:735,rx:220,ry:210,color:'#f0e9db'}],
    route:[[490,735],[740,715],[930,650],[1100,735],[1320,735],[1450,735],[1620,760],[1890,750],[2190,650],[2510,735],[2760,735],[2900,735],[3170,810],[3380,735],[3680,690],[4010,708]],
    landmarks:[{x:1020,y:1100,r:44,kind:'stump',label:'빈 붓 그루터기',region:0},{x:2230,y:415,r:34,kind:'bell',label:'가라앉은 종탑',region:1},{x:3490,y:480,r:42,kind:'crane',label:'종이 절단장',region:2},{x:3920,y:1030,r:42,kind:'crystal',label:'잉크 광맥',region:2}]
  });
  const MAP_ROUTE_POINTS=REGION_TERRAIN.route.map(([x,y])=>({x,y}));
  function mapTerrainBlocked(x,y,r){return REGION_TERRAIN.ponds.some(p=>((x-p.x)/(p.rx+r))**2+((y-p.y)/(p.ry+r))**2<1)||REGION_TERRAIN.ridges.some(p=>hypot(x-p.x,y-p.y)<p.r+r);}
  function nearMapRoute(x,y,width=100){for(let i=1;i<REGION_TERRAIN.route.length;i++){const a=REGION_TERRAIN.route[i-1],b=REGION_TERRAIN.route[i],dx=b[0]-a[0],dy=b[1]-a[1],t=clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy),0,1);if(hypot(x-a[0]-t*dx,y-a[1]-t*dy)<width)return true;}return false;}
  function addMapProp(x,y,r,kind,region,solid=true){const prop={x,y,r,kind,region,variant:rand()};world.trees.push(prop);if(solid)addObstacle({x,y,r:r*.62,kind});}
  function populateRegionMap(){
    for(const [region,count]of [[0,95],[1,78],[2,72]])for(let i=0;i<count;i++){
      const spec=REGIONS[region],x=spec.min+90+rand()*(spec.max-spec.min-180),y=90+rand()*(CFG.world.height-180);
      if(hypot(x-485,y-740)<330||nearMapRoute(x,y,105)||REGION_TERRAIN.clearings.some(c=>hypot((x-c.x)/c.rx,(y-c.y)/c.ry)<1.1)||hypot(x-CFG.boss.x,y-CFG.boss.y)<290||mapTerrainBlocked(x,y,25)||spec.spawns.some(s=>hypot(x-s[1],y-s[2])<90))continue;
      addMapProp(x,y,region===0?30+rand()*22:region===1?20+rand()*18:24+rand()*24,region===0?'canopy':region===1?'reed':'slab',region,region!==1);
    }
    for(const landmark of REGION_TERRAIN.landmarks){world.trees.push({...landmark,variant:0});addObstacle({x:landmark.x,y:landmark.y,r:landmark.r*.65,kind:landmark.kind});}
    for(let i=0;i<150;i++){const region=i%3,spec=REGIONS[region],x=spec.min+70+rand()*(spec.max-spec.min-140),y=50+rand()*(CFG.world.height-100);if(mapTerrainBlocked(x,y,5))continue;world.decals.push({x,y,kind:region===0?'flower':'grass',seed:rand()*10});}
  }
  function sketchPolygon(points,color,alpha=1){const center={x:points.reduce((n,p)=>n+p[0],0)/points.length,y:points.reduce((n,p)=>n+p[1],0)/points.length};for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];P.tri(center,{x:a[0],y:a[1]},{x:b[0],y:b[1]},color,alpha);}}
  function sketchOutline(points,width,color,alpha=1){for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];P.line(a[0],a[1],b[0],b[1],width,color,alpha);}}
  function regionGround(){
    P.box(2200,730,4400,1460,'#f4efdf');
    sketchPolygon([[0,0],[1470,0],[1370,270],[1510,600],[1370,1000],[1460,1460],[0,1460]],'#e7ecd9');
    sketchPolygon([[1470,0],[2930,0],[2810,380],[2980,680],[2840,1130],[2900,1460],[1460,1460],[1370,1000],[1510,600],[1370,270]],'#e1e9e2');
    sketchPolygon([[2930,0],[4400,0],[4400,1460],[2900,1460],[2840,1130],[2980,680],[2810,380]],'#ebe4d8');
    for(const c of REGION_TERRAIN.clearings){P.oval(c.x,c.y,c.rx,c.ry,c.color,.9);P.oval(c.x+20,c.y+15,c.rx*.83,c.ry*.78,'#f7f0df',.34);}
    for(const p of REGION_TERRAIN.ponds){if(!visible(p.x,p.y,p.rx+40))continue;P.oval(p.x,p.y,p.rx+16,p.ry+16,'#b8c9bb',.48);P.oval(p.x,p.y,p.rx,p.ry,'#aac3c3',.56);for(let k=0;k<5;k++){const yy=p.y+(k-2)*p.ry*.29,len=p.rx*Math.sqrt(1-((yy-p.y)/p.ry)**2)*.7;P.line(p.x-len,yy,p.x+len*.65,yy+3,1.4,'#7faaa9',.29);}for(let k=0;k<9;k++){const a=k*Math.PI*2/9,x=p.x+Math.cos(a)*(p.rx+12),y=p.y+Math.sin(a)*(p.ry+8);P.line(x,y,x-7,y-19,1.1,'#879e91',.42);P.line(x,y,x+5,y-24,1.1,'#879e91',.42);}}
    for(const p of REGION_TERRAIN.ridges){if(!visible(p.x,p.y,p.r+50))continue;const points=[[p.x-p.r,p.y+20],[p.x-p.r*.8,p.y-p.r*.8],[p.x+p.r*.1,p.y-p.r],[p.x+p.r,p.y-p.r*.35],[p.x+p.r*.9,p.y+p.r*.65],[p.x-p.r*.55,p.y+p.r*.85]];sketchPolygon(points,'#c4bcad',.7);sketchOutline(points,2,'#a99f90',.48);for(let i=0;i<3;i++)P.line(p.x-p.r*.65,p.y+i*18,p.x+p.r*.7,p.y-15+i*18,1.3,'#a69b8d',.34);}
    for(let i=0;i<5;i++){const x=3300+i*150;P.line(x,950,x+85,935,2,'#aa9e89',.24);P.line(x+10,965,x+95,950,1,'#aa9e89',.2);}
    P.path(MAP_ROUTE_POINTS,78,'#cabc9d',.25);P.path(MAP_ROUTE_POINTS,60,'#f3e8d1',.82);P.path(MAP_ROUTE_POINTS,1.4,'#aa9c82',.32);
    // Pencil edge marks give the route direction without competing with combat outlines.
    for(let i=2;i<REGION_TERRAIN.route.length;i++){const a=REGION_TERRAIN.route[i];P.line(a[0]-8,a[1]-46,a[0]+9,a[1]-43,1,'#a99f87',.36);}
  }
  function drawRegionProp(t){if(!['canopy','reed','slab','stump','bell','crane','crystal'].includes(t.kind))return false;const {x,y,r,kind}=t;if(!visible(x,y,r+70))return true;drawEnvironmentProp(kind,x,y,r);return true;}
  function drawMapLabels(){for(const landmark of REGION_TERRAIN.landmarks){if(!visible(landmark.x,landmark.y,150))continue;renderer.worldToScreenInto(landmark.x,landmark.y-landmark.r-75,anchorReuse);txtCtx.textAlign='center';txtCtx.font='600 11px system-ui';txtCtx.lineWidth=3;txtCtx.strokeStyle='#f5f0e1';txtCtx.strokeText(landmark.label,anchorReuse.x,anchorReuse.y);txtCtx.fillStyle='#7c8478';txtCtx.fillText(landmark.label,anchorReuse.x,anchorReuse.y);}}
