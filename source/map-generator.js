  // Seeded procedural map for one run.
  // Pure data: no DOM, no world, no renderer. Collision, drawing, minimap and enemy placement all read the one
  // MapLayout this file returns, so none of them can disagree about where terrain is.
  // Determinism: every browser must derive the same layout from the same seed. Only + - * / Math.sqrt and 32-bit
  // integer operations are used here (no Math.hypot/sin/cos/random), and every stored coordinate is an integer.
  const REGION_BANDS=Object.freeze([[0,1450],[1450,2900],[2900,4400]]);
  const VILLAGE=Object.freeze({x:485,y:740,safeRadius:330,houses:Object.freeze([
    {x:275,y:540,w:173,h:127,type:'house'},{x:575,y:462,w:167,h:119,type:'library'},{x:360,y:960,w:162,h:112,type:'shop'}])});
  const BOSS_ARENA_RADIUS=255;
const BOSS_SITE_RADIUS=150;// ring drawn at the centre of each clearing that hosts a boss
  const MAP_ATTEMPTS=8;
  // Per-region generation parameters. Ranges are inclusive [min,max].
  const MAP_REGION_PLAN=Object.freeze([
    {clearings:1,clearingMinX:1050,clearingColors:['#f2efdc'],ponds:[0,1],pondRx:[100,150],pondRy:[85,120],ridges:[0,0],ridgeR:[90,120],
      props:{count:95,kind:'canopy',size:[30,52],solid:true},decal:'flower'},
    {clearings:2,clearingMinX:0,clearingColors:['#ecebdd','#e9e9d9'],ponds:[3,4],pondRx:[150,250],pondRy:[130,165],ridges:[0,0],ridgeR:[90,120],
      props:{count:78,kind:'reed',size:[20,38],solid:false},decal:'grass'},
    {clearings:1,clearingMinX:0,clearingColors:['#f0e9db'],ponds:[0,0],pondRx:[100,150],pondRy:[85,120],ridges:[5,7],ridgeR:[90,120],
      props:{count:72,kind:'slab',size:[24,48],solid:true},decal:'grass'}
  ]);
  const MAP_LANDMARKS=Object.freeze([
    {region:0,kind:'stump',label:'빈 붓 그루터기',r:44},{region:1,kind:'bell',label:'가라앉은 종탑',r:34},
    {region:2,kind:'crane',label:'종이 절단장',r:42},{region:2,kind:'crystal',label:'잉크 광맥',r:42}]);

  const mapDist=(ax,ay,bx,by)=>{const dx=ax-bx,dy=ay-by;return Math.sqrt(dx*dx+dy*dy);};
  const mapDeriveSeed=(seed,attempt)=>(seed+Math.imul(attempt,0x9E3779B1))>>>0;

  // mulberry32 stream. One instance per generation attempt.
  class SeededRandom{
    constructor(seed){this.state=seed>>>0;}
    next(){
      this.state=(this.state+0x6D2B79F5)>>>0;let t=this.state;
      t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);
      return((t^(t>>>14))>>>0)/4294967296;
    }
    range(min,max){return min+(max-min)*this.next();}
    int(min,max){return Math.floor(this.range(min,max+1));}
    pick(list){return list[Math.floor(this.next()*list.length)];}
    shuffled(list){const out=list.slice();for(let i=out.length-1;i>0;i--){const j=Math.floor(this.next()*(i+1)),t=out[i];out[i]=out[j];out[j]=t;}return out;}
  }

  // Terrain shapes. A Disc is an Ellipse with equal radii, so one blocking rule serves ponds and ridges.
  class Ellipse{
    constructor(x,y,rx,ry){this.x=x;this.y=y;this.rx=rx;this.ry=ry;}
    // True when a circle of radius r centred at (x,y) overlaps this shape.
    blocks(x,y,r){const a=(x-this.x)/(this.rx+r),b=(y-this.y)/(this.ry+r);return a*a+b*b<1;}
    // 0 at the centre, 1 on the rim.
    radial(x,y){const a=(x-this.x)/this.rx,b=(y-this.y)/this.ry;return Math.sqrt(a*a+b*b);}
  }
  class Disc extends Ellipse{constructor(x,y,r){super(x,y,r,r);this.r=r;}}
  class Clearing extends Ellipse{constructor(x,y,rx,ry,region,color){super(x,y,rx,ry);this.region=region;this.color=color;}}

  // The guaranteed corridor from the village to the boss arena.
  class MapRoute{
    constructor(points){this.points=points;this.samples=MapRoute.sample(points,30);}
    static sample(points,spacing){
      const out=[points[0]];
      for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],n=Math.max(1,Math.ceil(mapDist(a.x,a.y,b.x,b.y)/spacing));
        for(let k=1;k<=n;k++)out.push({x:a.x+(b.x-a.x)*k/n,y:a.y+(b.y-a.y)*k/n});}
      return out;
    }
    distance(x,y){
      let best=Infinity;
      for(let i=1;i<this.points.length;i++){const a=this.points[i-1],b=this.points[i],dx=b.x-a.x,dy=b.y-a.y,
        t=Math.min(1,Math.max(0,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1))),d=mapDist(x,y,a.x+t*dx,a.y+t*dy);if(d<best)best=d;}
      return best;
    }
    near(x,y,width){return this.distance(x,y)<width;}
    // True when a shape grown by `margin` still keeps off every sampled route point.
    clearOf(shape,margin){return this.samples.every(p=>!shape.blocks(p.x,p.y,margin));}
  }

  // Mixin: anything that can list numbers can also be fingerprinted (FNV-1a over the numbers rounded to 0.01).
  const withFnvHash=Base=>class extends Base{
    hash(){let h=0x811C9DC5;for(const n of this.hashNumbers()){const v=Math.round(n*100)|0;for(let s=0;s<32;s+=8){h^=(v>>>s)&255;h=Math.imul(h,0x01000193);}}return h>>>0;}
  };

  class MapLayout extends withFnvHash(Object){
    constructor(parts){
      super();Object.assign(this,parts);
      // Spatial index for solidBlocks: flood-fill verification asks ~20k questions per attempt.
      this.solidCell=160;this.solidReach=Math.max(...this.solids.map(o=>o.r));this.solidGrid=new Map();
      for(const o of this.solids)for(let i=Math.floor((o.x-o.r)/this.solidCell);i<=Math.floor((o.x+o.r)/this.solidCell);i++)for(let j=Math.floor((o.y-o.r)/this.solidCell);j<=Math.floor((o.y+o.r)/this.solidCell);j++){
        const key=i*1000+j;if(!this.solidGrid.has(key))this.solidGrid.set(key,[]);this.solidGrid.get(key).push(o);}
    }
    get routePoints(){return this.route.points;}
    clearingsOf(region){return this.clearings.filter(c=>c.region===region);}
    terrainBlocks(x,y,r){
      for(const p of this.ponds)if(p.blocks(x,y,r))return true;
      for(const p of this.ridges)if(p.blocks(x,y,r))return true;
      return false;
    }
    solidBlocks(x,y,r){
      const reach=r+this.solidReach,c=this.solidCell;
      for(let i=Math.floor((x-reach)/c);i<=Math.floor((x+reach)/c);i++)for(let j=Math.floor((y-reach)/c);j<=Math.floor((y+reach)/c);j++){
        const list=this.solidGrid.get(i*1000+j);if(list)for(const o of list)if(mapDist(o.x,o.y,x,y)<o.r+r)return true;}
      return false;
    }
    blocks(x,y,r){return x<r||y<r||x>CFG.world.width-r||y>CFG.world.height-r||this.terrainBlocks(x,y,r)||this.solidBlocks(x,y,r);}
    * hashNumbers(){
      yield this.seed;yield this.attempt;yield this.boss.x;yield this.boss.y;
      for(const s of this.bossSites){yield s.x;yield s.y;yield s.radius;}
      for(const p of this.route.points){yield p.x;yield p.y;}
      for(const e of [...this.ponds,...this.ridges,...this.clearings]){yield e.x;yield e.y;yield e.rx;yield e.ry;}
      for(const l of this.landmarks){yield l.x;yield l.y;yield l.r;}
      for(const s of this.spawns){yield s.region;yield s.x;yield s.y;}
      for(const t of this.props){yield t.x;yield t.y;yield t.r;yield t.variant*1000;yield t.solid?1:0;}
      for(const d of this.decals){yield d.x;yield d.y;yield d.seed*100;}
      for(const edge of this.edges)for(const p of edge){yield p[0];yield p[1];}
    }
  }

  class MapGenerator{
    constructor(seed,attempt,regions){this.seed=seed;this.attempt=attempt;this.regions=regions;this.rng=new SeededRandom(mapDeriveSeed(seed,attempt));}

    // Returns a verified MapLayout, or null when this attempt cannot satisfy a placement rule.
    build(){
      const route=this.buildRoute(),last=route.points.at(-1),boss={x:last.x,y:last.y,radius:BOSS_ARENA_RADIUS};
      this.parts={seed:this.seed,attempt:this.attempt,route,boss,ponds:[],ridges:[],clearings:[],landmarks:[],spawns:[],props:[],decals:[],edges:[],solids:[]};
      for(const house of VILLAGE.houses)this.parts.solids.push({x:house.x,y:house.y+16,r:house.w*.46,kind:'house'});
      if(!this.placeClearings())return null;
      if(!this.placeLakesAndRidges())return null;
      if(!this.placeLandmarks())return null;
      if(!this.placeSpawns())return null;
      this.placeProps();
      this.placeDecals();
      this.placeEdges();
      // Boss order is route order: the four clearings (west to east), then the arena at the end of the route.
      this.parts.bossSites=[...this.parts.clearings.map(c=>({x:c.x,y:c.y,radius:BOSS_SITE_RADIUS})),{x:this.parts.boss.x,y:this.parts.boss.y,radius:BOSS_ARENA_RADIUS}];
      const layout=new MapLayout(this.parts);
      return MapGenerator.reachable(layout)?layout:null;
    }

    buildRoute(){
      const rng=this.rng,points=[{x:490,y:735}];let x=490,y=735;
      while(x<3550){
        x+=rng.int(230,320);
        // Gentle random walk pulled toward the middle so slopes stay below 0.27.
        let dy=rng.int(-60,60)-Math.round((y-735)*.12);dy=Math.max(-60,Math.min(60,dy));
        y=Math.max(470,Math.min(1000,y+dy));points.push({x,y});
      }
      points.push({x:4010,y:Math.max(470,Math.min(1000,y+rng.int(-40,40)))});
      return new MapRoute(points);
    }

    // Shape stays off the route, village, boss arena, clearings and every earlier terrain shape.
    keepClear(shape,margin){
      const p=this.parts,reach=Math.max(shape.rx,shape.ry);
      if(!p.route.clearOf(shape,margin))return false;
      if(shape.blocks(VILLAGE.x,VILLAGE.y,VILLAGE.safeRadius))return false;
      if(shape.blocks(p.boss.x,p.boss.y,BOSS_ARENA_RADIUS+60))return false;
      for(const c of p.clearings)if(shape.blocks(c.x,c.y,Math.max(c.rx,c.ry)*.9))return false;
      for(const other of [...p.ponds,...p.ridges])if(other.blocks(shape.x,shape.y,reach+30))return false;
      return true;
    }

    placeClearings(){
      const rng=this.rng,p=this.parts;
      for(const [region,plan]of MAP_REGION_PLAN.entries()){
        const [min,max]=REGION_BANDS[region],chosen=[];
        const candidates=rng.shuffled(p.route.samples.filter(q=>q.x>=Math.max(min+250,plan.clearingMinX)&&q.x<=max-250&&mapDist(q.x,q.y,p.boss.x,p.boss.y)>BOSS_ARENA_RADIUS+300));
        for(const q of candidates){
          if(chosen.length>=plan.clearings)break;
          if(chosen.every(c=>Math.abs(c.x-q.x)>=450))chosen.push(q);
        }
        if(chosen.length<plan.clearings)return false;
        for(const [i,q]of chosen.sort((a,b)=>a.x-b.x).entries())p.clearings.push(new Clearing(Math.round(q.x)+rng.int(-25,25),Math.round(q.y)+rng.int(-25,25),rng.int(200,260),rng.int(170,220),region,plan.clearingColors[i%plan.clearingColors.length]));
      }
      return true;
    }

    placeLakesAndRidges(){
      const rng=this.rng,p=this.parts;
      for(const [region,plan]of MAP_REGION_PLAN.entries()){
        const [min,max]=REGION_BANDS[region];
        for(let k=rng.int(plan.ponds[0],plan.ponds[1]);k>0;k--){
          let placed=false;
          for(let tries=0;tries<80&&!placed;tries++){
            const rx=rng.int(plan.pondRx[0],plan.pondRx[1]),ry=rng.int(plan.pondRy[0],plan.pondRy[1]);
            const pond=new Ellipse(rng.int(min+rx,max-rx),rng.int(ry+30,CFG.world.height-ry-30),rx,ry);
            if(this.keepClear(pond,90)){p.ponds.push(pond);placed=true;}
          }
          if(!placed)return false;
        }
        for(let k=rng.int(plan.ridges[0],plan.ridges[1]);k>0;k--){
          let placed=false;
          for(let tries=0;tries<80&&!placed;tries++){
            const r=rng.int(plan.ridgeR[0],plan.ridgeR[1]),ridge=new Disc(rng.int(min+r,max-r),rng.int(r+30,CFG.world.height-r-30),r);
            if(this.keepClear(ridge,90)){p.ridges.push(ridge);placed=true;}
          }
          if(!placed)return false;
        }
      }
      return true;
    }

    terrainBlocks(x,y,r){const p=this.parts;return p.ponds.some(e=>e.blocks(x,y,r))||p.ridges.some(e=>e.blocks(x,y,r));}

    inAnyClearing(x,y,scale){return this.parts.clearings.some(c=>c.radial(x,y)<scale);}

    placeLandmarks(){
      const rng=this.rng,p=this.parts;
      for(const spec of MAP_LANDMARKS){
        const [min,max]=REGION_BANDS[spec.region];let placed=false;
        for(let tries=0;tries<120&&!placed;tries++){
          const x=rng.int(min+120,max-120),y=rng.int(100,CFG.world.height-100);
          if(p.route.distance(x,y)<150||this.terrainBlocks(x,y,spec.r+30)||this.inAnyClearing(x,y,1.1))continue;
          if(mapDist(x,y,p.boss.x,p.boss.y)<BOSS_ARENA_RADIUS+spec.r+60||mapDist(x,y,VILLAGE.x,VILLAGE.y)<VILLAGE.safeRadius+spec.r)continue;
          if(p.landmarks.some(l=>mapDist(x,y,l.x,l.y)<150))continue;
          const landmark={x,y,r:spec.r,kind:spec.kind,label:spec.label,region:spec.region};
          p.landmarks.push(landmark);p.solids.push({x,y,r:spec.r*.65,kind:spec.kind});placed=true;
        }
        if(!placed)return false;
      }
      return true;
    }

    placeSpawns(){
      const rng=this.rng,p=this.parts;
      for(const [region,spec]of this.regions.entries()){
        const clearings=p.clearings.filter(c=>c.region===region);
        for(const [k,kind]of spec.spawnKinds.entries()){
          const clearing=clearings[k%clearings.length];let placed=false;
          for(let tries=0;tries<80&&!placed;tries++){
            const x=Math.round(clearing.x+rng.range(-.75,.75)*clearing.rx),y=Math.round(clearing.y+rng.range(-.75,.75)*clearing.ry);
            if(clearing.radial(x,y)>=.7||mapDist(x,y,VILLAGE.x,VILLAGE.y)<VILLAGE.safeRadius+120||this.terrainBlocks(x,y,32)||p.spawns.some(s=>mapDist(x,y,s.x,s.y)<90))continue;
            if(p.landmarks.some(l=>mapDist(x,y,l.x,l.y)<l.r+60))continue;
            p.spawns.push({region,kind,x,y});placed=true;
          }
          if(!placed)return false;
        }
      }
      return true;
    }

    placeProps(){
      const rng=this.rng,p=this.parts;
      for(const [region,plan]of MAP_REGION_PLAN.entries()){
        const [min,max]=REGION_BANDS[region];
        for(let i=0;i<plan.props.count;i++){
          const x=Math.round(rng.range(min+90,max-90)),y=Math.round(rng.range(90,CFG.world.height-90)),size=Math.round(rng.range(plan.props.size[0],plan.props.size[1])),variant=Math.round(rng.next()*1000)/1000;
          if(mapDist(x,y,VILLAGE.x,VILLAGE.y)<VILLAGE.safeRadius||p.route.near(x,y,105)||this.inAnyClearing(x,y,1.1)||mapDist(x,y,p.boss.x,p.boss.y)<BOSS_ARENA_RADIUS+35||this.terrainBlocks(x,y,25))continue;
          if(p.spawns.some(s=>mapDist(x,y,s.x,s.y)<90)||p.landmarks.some(l=>mapDist(x,y,l.x,l.y)<l.r+40))continue;
          const prop={x,y,r:size,kind:plan.props.kind,region,variant,solid:plan.props.solid};
          p.props.push(prop);if(prop.solid)p.solids.push({x,y,r:size*.62,kind:prop.kind});
        }
      }
    }

    placeDecals(){
      const rng=this.rng,p=this.parts;
      for(let i=0;i<150;i++){
        const region=i%3,[min,max]=REGION_BANDS[region],x=Math.round(rng.range(min+70,max-70)),y=Math.round(rng.range(50,CFG.world.height-50)),seed=Math.round(rng.range(0,10)*100)/100;
        if(this.terrainBlocks(x,y,5))continue;
        p.decals.push({x,y,kind:MAP_REGION_PLAN[region].decal,seed});
      }
    }

    // Jagged region borders for drawing only; gameplay uses the straight REGION_BANDS.
    placeEdges(){
      const rng=this.rng,p=this.parts;
      for(const band of [1,2]){const base=REGION_BANDS[band][0];p.edges.push([0,300,650,1050,CFG.world.height].map(y=>[y===0||y===CFG.world.height?base:base+rng.int(-70,70),y]));}
    }

    // Flood fill at 40px cells with the player's radius: the village must reach every spawn, clearing and the boss.
    static reachable(layout){
      const step=40,cols=Math.floor(CFG.world.width/step),rows=Math.floor(CFG.world.height/step),r=CFG.player.radius+2;
      const state=new Uint8Array(cols*rows);// 0 unknown, 1 free, 2 blocked
      const free=(i,j)=>{if(i<0||j<0||i>=cols||j>=rows)return false;const k=j*cols+i;if(!state[k])state[k]=layout.blocks((i+.5)*step,(j+.5)*step,r)?2:1;return state[k]===1;};
      const seen=new Uint8Array(cols*rows),queue=new Int32Array(cols*rows),start=[Math.floor(480/step),Math.floor(735/step)];
      if(!free(start[0],start[1]))return false;
      let head=0,tail=0;queue[tail++]=start[1]*cols+start[0];seen[queue[0]]=1;
      while(head<tail){
        const k=queue[head++],i=k%cols,j=(k-i)/cols;
        for(const [di,dj]of [[1,0],[-1,0],[0,1],[0,-1]]){
          const ni=i+di,nj=j+dj;if(!free(ni,nj)||seen[nj*cols+ni])continue;
          if(layout.blocks((i+di/2+.5)*step,(j+dj/2+.5)*step,r))continue;
          seen[nj*cols+ni]=1;queue[tail++]=nj*cols+ni;
        }
      }
      const reached=(x,y)=>{for(let j=Math.max(0,Math.floor(y/step)-2);j<=Math.min(rows-1,Math.floor(y/step)+2);j++)for(let i=Math.max(0,Math.floor(x/step)-2);i<=Math.min(cols-1,Math.floor(x/step)+2);i++)if(seen[j*cols+i]&&mapDist((i+.5)*step,(j+.5)*step,x,y)<=70)return true;return false;};
      return reached(layout.boss.x,layout.boss.y)&&layout.spawns.every(s=>reached(s.x,s.y))&&layout.clearings.every(c=>reached(c.x,c.y));
    }
  }

  function generateMapLayout(seed,regions=REGIONS){
    if(!Number.isSafeInteger(seed)||seed<0||seed>0xFFFFFFFF)throw new RangeError('맵 시드는 0 이상 4294967295 이하의 정수여야 합니다');
    for(let attempt=0;attempt<MAP_ATTEMPTS;attempt++){const layout=new MapGenerator(seed,attempt,regions).build();if(layout)return layout;}
    throw new Error(`맵 생성 실패: 시드 ${seed}`);
  }
