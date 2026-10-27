  // World population and drawing for the run's WorldMapLayout (see world-map.js).
  // Nothing in this file decides where terrain is: coast, rivers, cliffs, roads, props, sites and mob nests all come from mapLayout.
  let mapLayout=null;
  // The starting camp: three houses inland of the spawn (towards the map centre), placed only where their whole drawing stands on dry, wall-free ground.
  // `along`/`side` are offsets in the spawn-to-centre frame; a house that does not fit there is tried at the nearby offsets in CAMP_SHIFTS.
  const CAMP_HOUSES=Object.freeze([{along:230,side:-170,w:173,h:127,type:'house'},{along:300,side:150,w:167,h:119,type:'library'},{along:120,side:240,w:162,h:112,type:'shop'}]);
  const CAMP_SHIFTS=Object.freeze([[0,0],[40,0],[-40,0],[0,40],[0,-40],[80,0],[-80,0],[0,80],[0,-80],[60,60],[-60,60],[60,-60],[-60,-60]]);
  // What a house drawing blocks, as boxes in its SVG units (172 wide, origin (90,105) at the house position): the wall, then the roof in two steps
  // that stay inside the triangle, so nobody is stopped by empty sky beside the roof.
  const HOUSE_BOXES=Object.freeze([[20,89,160,160],[30,66,150,89],[56,34,124,66]]);
  function houseBoxes(h){
    const sx=h.w/172,sy=h.h/135;
    return HOUSE_BOXES.map(([x0,y0,x1,y1])=>({x:h.x+((x0+x1)/2-90)*sx,y:h.y+((y0+y1)/2-105)*sy,hw:(x1-x0)/2*sx,hh:(y1-y0)/2*sy,kind:'house'}));
  }
  // True when a box overlaps sea, a river or cliff cell, or a solid obstacle already placed.
  function boxBlocked(b){
    for(let y=b.y-b.hh;y<=b.y+b.hh+11;y+=12)for(let x=b.x-b.hw;x<=b.x+b.hw+11;x+=12)if(mapLayout.terrainBlocks(Math.min(x,b.x+b.hw),Math.min(y,b.y+b.hh),0))return true;
    return world.obstacles.some(o=>o.hw===undefined?circleHitsBox(o,b):Math.abs(o.x-b.x)<o.hw+b.hw&&Math.abs(o.y-b.y)<o.hh+b.hh);
  }
  function circleHitsBox(c,b){const dx=Math.max(Math.abs(c.x-b.x)-b.hw,0),dy=Math.max(Math.abs(c.y-b.y)-b.hh,0);return dx*dx+dy*dy<c.r*c.r;}
  function placeHouse(sp,ux,uy,h){
    for(const [da,ds] of CAMP_SHIFTS){
      const along=h.along+da,side=h.side+ds,x=Math.round(sp.x+ux*along-uy*side),y=Math.round(sp.y+uy*along+ux*side),placed={x,y,w:h.w,h:h.h,type:h.type},boxes=houseBoxes(placed);
      if(boxes.some(boxBlocked))continue;
      world.houses.push(placed);for(const b of boxes)addObstacle(b);return;
    }
  }
  function applyMapLayout(mapSeed){
    mapLayout=generateWorldMap(mapSeed);
    world.mapSeed=mapSeed;
    world.obstacles.length=0;world.grid.clear();world.houses.length=0;world.trees.length=0;world.decals.length=0;
    const sp=mapLayout.spawn,half=mapLayout.size/2,dx=half-sp.x,dy=half-sp.y,len=Math.sqrt(dx*dx+dy*dy)||1,ux=dx/len,uy=dy/len;
    for(const p of mapLayout.props){world.trees.push({x:p.x,y:p.y,r:p.r,kind:p.kind,variant:p.variant,solid:p.solid});if(p.solid)addObstacle({...solidFoot(p),kind:p.kind});}
    for(const h of CAMP_HOUSES)placeHouse(sp,ux,uy,h);
    for(const d of mapLayout.decals)world.decals.push({...d});
    $('mapSeed').textContent=String(mapSeed);
  }
  // The run's seed: ?seed=<0..4294967295> reproduces a map, otherwise a fresh random one.
  function initialMapSeed(){
    const raw=new URLSearchParams(location.search).get('seed');
    if(raw!==null&&/^\d{1,10}$/.test(raw)&&+raw<=0xFFFFFFFF)return +raw;
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }

  // Ground colours: biome tint, slightly inked towards the centre so the difficulty rings read on screen.
  const GROUND_INK=[0x5a,0x54,0x70];
  const hexRgb=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
  const rgbHex=c=>'#'+c.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
  const mixHex=(a,b,t)=>{const x=hexRgb(a);return rgbHex(x.map((v,i)=>v+(b[i]-v)*t));};
  const GROUND_PAPER=Object.freeze(['#bcd3df','#f1e6c8','#e0e9ca','#cadccc','#f1f4f3','#ded2c4','#b6b3cc']);
  const GROUND_TABLE=GROUND_PAPER.map(c=>Array.from({length:WORLD_MAP.zoneCount},(_,z)=>mixHex(c,GROUND_INK,.045*z)));
  const WALL_COLOR=Object.freeze({[WALL_RIVER]:'#9cc1d3',[WALL_CLIFF]:'#9a8a76'}),ROAD_COLOR='#dcc9a2',ROAD_EDGE='#bfa97f';
  function groundColor(g,k){
    if(!g.land[k])return GROUND_TABLE[0][0];
    if(g.road[k])return ROAD_COLOR;
    if(g.wall[k])return WALL_COLOR[g.wall[k]];
    return GROUND_TABLE[g.biome[k]][g.zone[k]];
  }
  // One filled box per run of same-coloured cells in each visible row (about two hundred boxes per frame).
  function regionGround(){
    const g=mapLayout.grid,cell=g.cell,hx=vw/(camera.zoom*2)+cell,hy=vh/(camera.zoom*2)+cell;
    const i0=Math.max(0,Math.floor((camera.x-hx)/cell)),i1=Math.min(g.cols-1,Math.floor((camera.x+hx)/cell)),j0=Math.max(0,Math.floor((camera.y-hy)/cell)),j1=Math.min(g.rows-1,Math.floor((camera.y+hy)/cell));
    P.box(camera.x,camera.y,hx*2+cell*2,hy*2+cell*2,GROUND_TABLE[0][0]);
    for(let j=j0;j<=j1;j++){
      let runStart=i0,runColor=groundColor(g,g.index(i0,j));
      for(let i=i0+1;i<=i1+1;i++){
        const color=i<=i1?groundColor(g,g.index(i,j)):null;
        if(color!==runColor){if(runColor!==GROUND_TABLE[0][0]){const w=(i-runStart)*cell+1;P.box(runStart*cell+w/2-.5,j*cell+cell/2,w,cell+1,runColor);}runStart=i;runColor=color;}
      }
    }
    // Pencil marks: ripples on rivers, hatching on cliffs, edge lines along roads.
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      const k=g.index(i,j),x=i*cell,y=j*cell;
      if(g.road[k]){if(!g.road[k-1]||!g.road[k+1]||!g.road[k-g.cols]||!g.road[k+g.cols])P.dot(x+cell/2,y+cell/2,2.2,ROAD_EDGE,.35);}
      else if(g.wall[k]===WALL_RIVER&&((i+j)&1)===0)P.line(x+4,y+cell/2,x+cell-4,y+cell/2+2,1.3,'#6f9fb8',.5);
      else if(g.wall[k]===WALL_CLIFF&&((i+j)&1)===0)P.line(x+3,y+cell-4,x+cell-3,y+4,1.5,'#6e604f',.55);
    }
    // Coast: a short surf line on every land cell that touches the sea.
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const k=g.index(i,j);if(g.land[k]&&(i>0&&!g.land[k-1]||i<g.cols-1&&!g.land[k+1]||j>0&&!g.land[k-g.cols]||j<g.rows-1&&!g.land[k+g.cols]))P.dot(i*cell+cell/2,j*cell+cell/2,cell*.5,'#ffffff',.22);}
  }
  // Camps, portals, the spawn camp and the boss rings. Boss rings go grey while the boss is sealed.
  function drawWorldSites(){
    for(const s of mapLayout.sites){
      if(!visible(s.x,s.y,s.r+60))continue;
      if(s.kind==='spawn'){P.oval(s.x,s.y,s.r,s.r*.82,'#f6efd9',.5);P.ring(s.x,s.y,s.r*.9,'#86a68e',.55,1.8,32);P.dot(s.x,s.y,14,'#fafbf3');P.ring(s.x,s.y,15,'#789b89',.75,2,24);P.dot(s.x,s.y,6,'#a5c9a3',.85);}
      else if(s.kind==='camp'){P.oval(s.x,s.y,s.r,s.r*.8,'#f0dcc0',.5);P.ring(s.x,s.y,s.r,'#c98a4a',.6,2,28);P.dot(s.x,s.y,7,'#e0a35e',.9);}
      else if(s.kind==='portal'){P.ring(s.x,s.y,s.r,'#8a5cc4',.8,2.6,28);P.ring(s.x,s.y,s.r*.55,'#b394e0',.8,2,24);P.dot(s.x,s.y,6,'#d9c8f3',.9);}
    }
    for(const site of mapLayout.bossSites){
      if(!visible(site.x,site.y,site.radius+60))continue;
      const i=site.bossId,down=world.bossState[i]===2,sealed=!down&&bossSealed(i),tint=sealed?'#9a949c':BOSS_PROFILES[i].color;
      P.oval(site.x,site.y,site.radius*.89,site.radius*.89,'#e6dde8',down?.14:.4);
      P.ring(site.x,site.y,site.radius,down?'#b4a7b4':tint,down?.2:.7,2,36);
      P.ring(site.x,site.y,site.radius*.7,'#b7a8b7',down?.1:.32,1.4,24);
      if(sealed)P.ring(site.x,site.y,site.radius*.45,'#7d5a9e',.75,3,18);
    }
  }
  function drawRegionProp(t){if(!['canopy','reed','slab','stump','bell','crane','crystal'].includes(t.kind))return false;const {x,y,r,kind}=t;if(!visible(x,y,r+70))return true;drawEnvironmentProp(kind,x,y,r);return true;}
  // Numbers on the boss rings, names on camps and portals: the order of the five bosses is readable from the ground.
  function drawMapLabels(){
    txtCtx.textAlign='center';
    for(const s of mapLayout.sites){
      if(!visible(s.x,s.y,s.r+90))continue;
      let text=null,font='600 11px system-ui',fill='#7c8478';
      if(s.kind==='spawn'){text='해안 야영지';fill='#5f8a6c';}
      else if(s.kind==='camp'){text='야영지 수호';fill='#a8691f';}
      else if(s.kind==='portal'){text='포털 수호';fill='#6d44a8';}
      if(!text)continue;
      renderer.worldToScreenInto(s.x,s.y-s.r-14,anchorReuse);txtCtx.font=font;txtCtx.lineWidth=3;txtCtx.strokeStyle='#f5f0e1';txtCtx.strokeText(text,anchorReuse.x,anchorReuse.y);txtCtx.fillStyle=fill;txtCtx.fillText(text,anchorReuse.x,anchorReuse.y);
    }
    for(const site of mapLayout.bossSites){
      if(!visible(site.x,site.y,site.radius+120))continue;
      const i=site.bossId,down=world.bossState[i]===2,sealed=!down&&bossSealed(i);
      renderer.worldToScreenInto(site.x,site.y-site.radius-16,anchorReuse);
      txtCtx.font='700 15px system-ui';txtCtx.lineWidth=4;txtCtx.strokeStyle='#f5f0e1';
      const label=`${i+1}번 ${BOSS_PROFILES[i].name}${down?' · 격파':sealed?' · 봉인':''}`;
      txtCtx.strokeText(label,anchorReuse.x,anchorReuse.y);txtCtx.fillStyle=down?'#a7a0a8':sealed?'#7d5a9e':BOSS_PROFILES[i].color;txtCtx.fillText(label,anchorReuse.x,anchorReuse.y);
    }
  }
