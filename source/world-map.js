// World map v2 (프로토타입): 가장자리 해안에서 시작해 중앙으로 갈수록 어려워지는 바이옴 지도.
// 순수 데이터: DOM·world·renderer 를 모릅니다. 같은 시드 → 모든 브라우저에서 같은 격자(결정론).
// 결정론 규칙(맵 생성 전반 공통): 사칙연산·Math.sqrt·Math.floor·32비트 정수 연산만 사용(sin/cos/hypot/random 금지).
// 재사용: SeededRandom (seeded-random.js).
//
// 생성 단계: ① 장 → ② 바이옴 셀(보로노이) → ③ 거점 배치 → ④ 길(MST+루프, Dijkstra) → ⑤ 소품 → ⑥ 검증
// 오픈형 지도: 길찾기가 없으므로 지형이 걷는 길을 막는 곳은 바다(바깥 해안)와 솔리드 소품(작은 볼록 장애물)뿐입니다. 강·절벽 같은 긴 벽은 없습니다.
const WORLD_MAP=Object.freeze({
  size:4800,cell:24,
  zoneCount:5,
  zoneNames:Object.freeze(['해안','외곽','중부','심부','중심']),
  // 난이도 D(0=해안선, 1=중앙)가 이 값을 넘으면 다음 구역. 안쪽 구역일수록 좁음.
  zoneEdges:Object.freeze([0.16,0.36,0.58,0.78]),
  biomeCount:56,
  attempts:8,
  biomes:Object.freeze([
    {id:0,key:'sea',name:'바다',color:'#b9d6e8'},
    {id:1,key:'beach',name:'해안',color:'#f1e3b8'},
    {id:2,key:'forest',name:'숲',color:'#cfe3b0'},
    {id:3,key:'swamp',name:'늪',color:'#a9c9a0'},
    {id:4,key:'snow',name:'설원',color:'#eef3f6'},
    {id:5,key:'ruins',name:'폐허',color:'#d6c7b8'},
    {id:6,key:'ink',name:'먹물 황무지',color:'#9a97b5'}]),
  // 구역별 바이옴 후보(셀 중심의 구역 기준)
  zoneBiomes:Object.freeze([[1],[2,3],[3,4,2],[4,5],[5,6]]),
  // 몹 생성 규칙. 둥지(nest) = 고정 위치 + 고정 구성원 목록(시드로 결정). 활성 반경 안의 둥지만 실제 적으로 생성.
  mobs:Object.freeze({
    kinds:Object.freeze(['chaser','spitter','charger']),
    roster:Object.freeze([[70,30,0],[50,30,20],[35,35,30],[30,35,35],[25,35,40]]),   // 구역별 [chaser,spitter,charger] 가중치
    group:Object.freeze([[2,3],[2,4],[3,4],[3,5],[4,6]]),                              // 구역별 둥지 구성원 수 [최소,최대]
    nestPerMillionPx2:Object.freeze([3.0,3.4,3.8,4.2,4.6]),                            // 구역 걸을 수 있는 면적 100만 px²당 둥지 수
    hpScale:Object.freeze([1,1.3,1.7,2.2,3.0]),damageScale:Object.freeze([1,1.1,1.25,1.4,1.6]),
    elite:{hpScale:1.5,groupBonus:2},                                                  // 야영지·포털 수호 둥지
    bossMinions:4,leash:520,nestGap:260,safeRadius:820,roadClearance:72,
    activeRadius:900,despawnRadius:1300,respawnAwayPx:1100,respawnMs:25000}),
  site:Object.freeze({
    boss:{r:150,minGap:950},camp:{r:70,perZone:[0,2,2,2,1]},portal:{r:46,perZone:[0,1,1,1,1]},minGap:380}),
  prop:Object.freeze({  // 바이옴별 소품: 그리는 종류(region-map.js drawEnvironmentProp)·솔리드 여부·크기 범위·간격(px)·최대 수. 솔리드 간격은 플레이어(지름 32)가 지나갈 틈을 남깁니다.
    beach:{kind:'reed',solid:false,size:[16,26],gap:150,max:70},forest:{kind:'canopy',solid:true,size:[30,46],gap:112,max:230},
    swamp:{kind:'reed',solid:false,size:[20,34],gap:62,max:240},snow:{kind:'canopy',solid:true,size:[28,42],gap:118,max:150},
    ruins:{kind:'slab',solid:true,size:[24,40],gap:110,max:170},ink:{kind:'crystal',solid:true,size:[24,38],gap:120,max:90}}),
  // 솔리드 소품의 충돌 원 = 그림이 땅에 닿는 자리. SVG 좌표(180×200, 땅 기준점 (90,190))로 적고 그림 크기 r/50을 곱합니다.
  // dy: 기준점에서 위쪽으로 올린 거리, rad: 반지름. 나무는 줄기 굵기, 바위·결정은 바닥 폭입니다.
  solidFoot:Object.freeze({canopy:{dy:0,rad:5},slab:{dy:18,rad:36},crystal:{dy:22,rad:34}})
});
// 솔리드 소품 p의 충돌 원 {x,y,r}. 그리는 곳(region-map.js)과 배치(생성기)가 같은 값을 씁니다.
function solidFoot(p){const f=WORLD_MAP.solidFoot[p.kind],k=p.r/50;return{x:p.x,y:p.y-f.dy*k,r:f.rad*k};}

// 정수 해시 기반 값 잡음. 시드·솔트마다 독립된 장.
class ValueNoise{
  constructor(seed){this.seed=seed>>>0;}
  hash(ix,iy){
    let h=Math.imul(ix,0x27D4EB2D)^Math.imul(iy,0x165667B1)^this.seed;
    h=Math.imul(h^(h>>>15),0x85EBCA6B);h=Math.imul(h^(h>>>13),0xC2B2AE35);
    return((h^(h>>>16))>>>0)/4294967296;
  }
  at(x,y){
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
    const a=this.hash(ix,iy),b=this.hash(ix+1,iy),c=this.hash(ix,iy+1),d=this.hash(ix+1,iy+1);
    return a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;
  }
  fbm(x,y,octaves=3){let sum=0,amp=1,freq=1,norm=0;for(let i=0;i<octaves;i++){sum+=amp*this.at(x*freq,y*freq);norm+=amp;amp*=.5;freq*=2;}return sum/norm;}
}

// 격자 하나에 대응하는 필드 묶음(읽기 전용 데이터).
class WorldGrid{
  constructor(size,cell){
    this.size=size;this.cell=cell;this.cols=Math.floor(size/cell);this.rows=this.cols;
    const n=this.cols*this.rows;
    this.land=new Uint8Array(n);   // 1=땅, 0=바다
    this.zone=new Uint8Array(n);   // 0..4 난이도 구역
    this.biome=new Uint8Array(n);  // WORLD_MAP.biomes id
    this.cellId=new Uint8Array(n); // 보로노이 셀 번호
    this.road=new Uint8Array(n);   // 1=길
    this.difficulty=new Float32Array(n);
  }
  index(i,j){return j*this.cols+i;}
  inside(i,j){return i>=0&&j>=0&&i<this.cols&&j<this.rows;}
  center(i,j){return{x:(i+.5)*this.cell,y:(j+.5)*this.cell};}
  cellOf(x,y){return{i:Math.min(this.cols-1,Math.max(0,Math.floor(x/this.cell))),j:Math.min(this.rows-1,Math.max(0,Math.floor(y/this.cell)))};}
  walkable(i,j){return this.inside(i,j)&&this.land[this.index(i,j)]===1;}
  // 반지름 r칸 안에 바다가 없는가
  clear(i,j,r){for(let dj=-r;dj<=r;dj++)for(let di=-r;di<=r;di++)if(!this.walkable(i+di,j+dj))return false;return true;}
}

class MinHeap{
  constructor(){this.a=[];}
  get size(){return this.a.length;}
  push(cost,node){const a=this.a;a.push([cost,node]);let i=a.length-1;while(i>0){const p=(i-1)>>1;if(a[p][0]<a[i][0]||(a[p][0]===a[i][0]&&a[p][1]<=a[i][1]))break;[a[p],a[i]]=[a[i],a[p]];i=p;}}
  pop(){const a=this.a,top=a[0],last=a.pop();if(a.length){a[0]=last;let i=0;for(;;){let l=2*i+1,r=l+1,m=i;const less=(x,y)=>a[x][0]<a[y][0]||(a[x][0]===a[y][0]&&a[x][1]<a[y][1]);if(l<a.length&&less(l,m))m=l;if(r<a.length&&less(r,m))m=r;if(m===i)break;[a[m],a[i]]=[a[i],a[m]];i=m;}}return top;}
}

class WorldMapGenerator{
  constructor(seed,attempt){
    this.seed=seed;this.attempt=attempt;
    this.rng=new SeededRandom((seed+Math.imul(attempt,0x9E3779B1))>>>0);
    this.grid=new WorldGrid(WORLD_MAP.size,WORLD_MAP.cell);
    const s=(seed+Math.imul(attempt,0x9E3779B1))>>>0;
    this.noise={warpX:new ValueNoise(s^0x1111),warpY:new ValueNoise(s^0x2222),coast:new ValueNoise(s^0x3333),diff:new ValueNoise(s^0x4444),
      road:new ValueNoise(s^0x6666)};
    this.points=[];this.sites=[];this.props=[];this.decals=[];this.roadEdges=[];this.nests=[];
  }

  build(){
    this.buildFields();this.buildBiomeCells();
    if(!this.placeSites())return null;
    if(!this.buildRoads())return null;
    this.buildProps();this.buildDecals();this.buildMobs();
    const report=this.validate();
    if(!report.ok)return null;
    return new WorldMapLayout(this,report);
  }

  // ① 해안·난이도 장
  buildFields(){
    const g=this.grid,half=g.size/2,R=half,n=this.noise;
    for(let j=0;j<g.rows;j++)for(let i=0;i<g.cols;i++){
      const {x,y}=g.center(i,j),k=g.index(i,j);
      const wx=x+(n.warpX.fbm(x/900,y/900)-.5)*760,wy=y+(n.warpY.fbm(x/900+7.3,y/900+3.1)-.5)*760;
      const dx=wx-half,dy=wy-half,d=Math.sqrt(dx*dx+dy*dy)/R;
      const coast=0.93+(n.coast.fbm(x/520,y/520)-.5)*0.10;
      g.land[k]=d<coast?1:0;
      let D=1-d/coast+(n.diff.fbm(x/700,y/700)-.5)*0.10;
      D=D<0?0:D>1?1:D;g.difficulty[k]=D;
      const e=WORLD_MAP.zoneEdges;g.zone[k]=D<e[0]?0:D<e[1]?1:D<e[2]?2:D<e[3]?3:4;
    }
  }

  // ② 보로노이 바이옴 셀: best-candidate 로 고르게 흩뿌린 점 + 중앙 점
  buildBiomeCells(){
    const g=this.grid,rng=this.rng,half=g.size/2,pts=this.points;
    pts.push({x:half,y:half});
    const landPoint=()=>{for(let t=0;t<60;t++){const x=rng.range(0,g.size),y=rng.range(0,g.size),c=g.cellOf(x,y);if(g.land[g.index(c.i,c.j)])return{x,y};}return{x:half,y:half};};
    while(pts.length<WORLD_MAP.biomeCount){
      let best=null,bestD=-1;
      for(let t=0;t<14;t++){const p=landPoint();let dm=1e18;for(const q of pts){const dx=p.x-q.x,dy=p.y-q.y,d=dx*dx+dy*dy;if(d<dm)dm=d;}if(dm>bestD){bestD=dm;best=p;}}
      pts.push(best);
    }
    // 셀 바이옴: 점이 속한 구역의 후보 중 해시로 선택
    for(let p=0;p<pts.length;p++){
      const c=g.cellOf(pts[p].x,pts[p].y),z=g.land[g.index(c.i,c.j)]?g.zone[g.index(c.i,c.j)]:0;
      const list=WORLD_MAP.zoneBiomes[z];pts[p].zone=z;pts[p].biome=p===0?6:list[Math.floor(rng.next()*list.length)];
    }
    // 격자마다 가장 가까운 점의 셀 번호와 바이옴
    for(let j=0;j<g.rows;j++)for(let i=0;i<g.cols;i++){
      const {x,y}=g.center(i,j),k=g.index(i,j);let d1=1e18,a=0;
      for(let p=0;p<pts.length;p++){const dx=x-pts[p].x,dy=y-pts[p].y,d=dx*dx+dy*dy;if(d<d1){d1=d;a=p;}}
      g.cellId[k]=a;g.biome[k]=g.land[k]?pts[a].biome:0;
    }
  }

  // ③ 거점: 스폰(해안) · 구역별 보스 · 야영지 · 포털
  placeSites(){
    const g=this.grid,rng=this.rng,half=g.size/2,S=WORLD_MAP.site;
    const candidates=zone=>{const out=[];for(let j=3;j<g.rows-3;j++)for(let i=3;i<g.cols-3;i++){const k=g.index(i,j);if(g.zone[k]===zone&&g.land[k]&&g.clear(i,j,3))out.push({i,j});}return out;};
    const far=(p,minGap)=>this.sites.every(s=>{const q=g.center(p.i,p.j),dx=q.x-s.x,dy=q.y-s.y;return dx*dx+dy*dy>=minGap*minGap;});
    const farFrom=(p,kind,minGap)=>this.sites.filter(s=>s.kind===kind).every(s=>{const q=g.center(p.i,p.j),dx=q.x-s.x,dy=q.y-s.y;return dx*dx+dy*dy>=minGap*minGap;});
    const pick=(zone,kind,r,gap)=>{
      const list=candidates(zone).filter(p=>far(p,gap)&&(kind!=='boss'||farFrom(p,'boss',S.boss.minGap)));
      if(!list.length)return false;
      let best=null,bestD=-1;
      for(let t=0;t<24;t++){const p=list[Math.floor(rng.next()*list.length)],q=g.center(p.i,p.j);let dm=1e18;for(const s of this.sites){const dx=q.x-s.x,dy=q.y-s.y,d=dx*dx+dy*dy;if(d<dm)dm=d;}if(dm>bestD){bestD=dm;best=p;}}
      const q=g.center(best.i,best.j);this.sites.push({kind,x:Math.floor(q.x),y:Math.floor(q.y),zone,r});return true;
    };
    // 스폰: 해안 구역에서 난이도가 가장 낮은(바다에 가까운) 쪽 후보 중 하나
    const shore=candidates(0).filter(p=>g.difficulty[g.index(p.i,p.j)]<0.07);
    if(!shore.length)return false;
    const sp=shore[Math.floor(rng.next()*shore.length)],spc=g.center(sp.i,sp.j);
    this.sites.push({kind:'spawn',x:Math.floor(spc.x),y:Math.floor(spc.y),zone:0,r:120});
    // 중앙 보스는 정중앙
    this.sites.push({kind:'boss',x:half,y:half,zone:4,r:S.boss.r,final:true});
    for(let z=0;z<4;z++){
      if(z===0){const list=candidates(0).filter(p=>{const q=g.center(p.i,p.j),dx=q.x-spc.x,dy=q.y-spc.y;return dx*dx+dy*dy>800*800&&dx*dx+dy*dy<1600*1600&&g.difficulty[g.index(p.i,p.j)]>0.06;});
        if(!list.length)return false;const p=list[Math.floor(rng.next()*list.length)],q=g.center(p.i,p.j);this.sites.push({kind:'boss',x:Math.floor(q.x),y:Math.floor(q.y),zone:0,r:S.boss.r});continue;}
      if(!pick(z,'boss',S.boss.r,500))return false;
    }
    for(let z=0;z<WORLD_MAP.zoneCount;z++){
      for(let n=0;n<S.camp.perZone[z];n++)if(!pick(z,'camp',S.camp.r,S.minGap))return false;
      for(let n=0;n<S.portal.perZone[z];n++)if(!pick(z,'portal',S.portal.r,S.minGap))return false;
    }
    return true;
  }

  // ④ 길: 거점 MST + 짧은 루프, 격자 위 Dijkstra
  buildRoads(){
    const g=this.grid,nodes=this.sites,n=nodes.length;
    const d2=(a,b)=>{const dx=nodes[a].x-nodes[b].x,dy=nodes[a].y-nodes[b].y;return dx*dx+dy*dy;};
    const inTree=new Array(n).fill(false);inTree[0]=true;const edges=[];
    for(let step=1;step<n;step++){let bi=-1,bj=-1,bd=1e18;for(let i=0;i<n;i++)if(inTree[i])for(let j=0;j<n;j++)if(!inTree[j]){const d=d2(i,j);if(d<bd){bd=d;bi=i;bj=j;}}inTree[bj]=true;edges.push([bi,bj]);}
    const has=(a,b)=>edges.some(e=>(e[0]===a&&e[1]===b)||(e[0]===b&&e[1]===a));
    for(let a=0;a<n;a++){let bj=-1,bd=1e18;for(let b=0;b<n;b++)if(b!==a&&!has(a,b)){const d=d2(a,b);if(d<bd){bd=d;bj=b;}}
      if(bj>=0&&bd<1000*1000&&this.rng.next()<0.5)edges.push([a,bj]);}
    this.roadEdges=edges;
    for(const [a,b] of edges){const path=this.route(nodes[a],nodes[b]);if(!path)return false;for(const k of path)this.stampRoad(k);}
    return true;
  }
  cost(k){
    const g=this.grid;if(!g.land[k])return-1;
    let m=10+Math.floor(this.noise.road.at((k%g.cols)*g.cell/220,Math.floor(k/g.cols)*g.cell/220)*8);
    if(g.road[k])m=4;
    return m;
  }
  route(a,b){
    const g=this.grid,cols=g.cols,n=cols*g.rows,dist=new Int32Array(n).fill(0x3fffffff),prev=new Int32Array(n).fill(-1);
    const s=g.cellOf(a.x,a.y),t=g.cellOf(b.x,b.y),sk=g.index(s.i,s.j),tk=g.index(t.i,t.j),heap=new MinHeap();
    dist[sk]=0;heap.push(0,sk);
    while(heap.size){
      const [c,k]=heap.pop();if(c>dist[k])continue;if(k===tk)break;
      const ci=k%cols,cj=Math.floor(k/cols);
      for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){
        if(!di&&!dj)continue;const ni=ci+di,nj=cj+dj;if(!g.inside(ni,nj))continue;
        const nk=g.index(ni,nj),m=this.cost(nk);if(m<0)continue;
        const nc=c+Math.floor((di&&dj?14:10)*m/10);
        if(nc<dist[nk]){dist[nk]=nc;prev[nk]=k;heap.push(nc,nk);}
      }
    }
    if(prev[tk]<0&&sk!==tk)return null;
    const out=[];for(let k=tk;k!==-1;k=prev[k])out.push(k);return out;
  }
  // 길 폭: 3x3
  stampRoad(k){
    const g=this.grid,ci=k%g.cols,cj=Math.floor(k/g.cols);
    for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){if(!g.inside(ci+di,cj+dj))continue;const q=g.index(ci+di,cj+dj);if(!g.land[q])continue;g.road[q]=1;}
  }

  // ⑤ 소품: 바이옴별 다트 던지기
  buildProps(){
    const g=this.grid,rng=this.rng,cfg=WORLD_MAP.prop,placed={};
    const tooCloseToSite=(x,y)=>this.sites.some(s=>{const dx=x-s.x,dy=y-s.y,rr=s.r+(s.kind==='boss'?120:50);return dx*dx+dy*dy<rr*rr;});
    for(let t=0;t<9000;t++){
      const x=Math.floor(rng.range(30,g.size-30)),y=Math.floor(rng.range(30,g.size-30)),c=g.cellOf(x,y),k=g.index(c.i,c.j);
      if(!g.land[k]||g.road[k]||tooCloseToSite(x,y))continue;
      const biome=WORLD_MAP.biomes[g.biome[k]],spec=cfg[biome.key];if(!spec)continue;
      const list=placed[biome.key]||(placed[biome.key]=[]);if(list.length>=spec.max)continue;
      if(list.some(p=>{const dx=x-p.x,dy=y-p.y;return dx*dx+dy*dy<spec.gap*spec.gap;}))continue;
      const prop={x,y,kind:spec.kind,solid:spec.solid,r:Math.floor(rng.range(spec.size[0],spec.size[1])),variant:Math.floor(rng.next()*1000)/1000};list.push(prop);this.props.push(prop);
    }
  }


  // ⑤-1 바닥 장식(충돌 없음): 숲·해안은 꽃, 그 외는 풀
  buildDecals(){
    const g=this.grid,rng=this.rng,kinds={1:'flower',2:'flower'};
    for(let t=0;t<700&&this.decals.length<260;t++){
      const x=Math.floor(rng.range(30,g.size-30)),y=Math.floor(rng.range(30,g.size-30)),c=g.cellOf(x,y),k=g.index(c.i,c.j);
      if(!g.land[k]||g.road[k]||g.biome[k]===6)continue;
      this.decals.push({x,y,kind:kinds[g.biome[k]]||'grass',seed:Math.floor(rng.next()*1000)/1000});
    }
  }

  // ⑤-2 몹 둥지: 야영지·포털 수호(정예), 보스 부하, 구역 밀도에 따른 야생 둥지
  buildMobs(){
    const g=this.grid,rng=this.rng,M=WORLD_MAP.mobs,cellArea=g.cell*g.cell;
    const members=(zone,count)=>{const w=M.roster[zone],total=w[0]+w[1]+w[2],out=[];for(let n=0;n<count;n++){let r=rng.next()*total,k=0;while(k<2&&r>=w[k]){r-=w[k];k++;}out.push(M.kinds[k]);}return out;};
    const spawn=this.sites[0];
    // 보스·수호 둥지
    for(const site of this.sites){
      if(site.kind==='boss'){this.nests.push({kind:'boss',x:site.x,y:site.y,zone:site.zone,bossId:site.final?4:site.zone,members:members(site.zone,M.bossMinions),leash:site.r+150,respawn:false,hpScale:M.hpScale[site.zone]});}
      else if(site.kind==='camp'||site.kind==='portal'){
        const base=rng.int(M.group[site.zone][0],M.group[site.zone][1])+M.elite.groupBonus;
        this.nests.push({kind:site.kind==='camp'?'campGuard':'portalGuard',x:site.x,y:site.y,zone:site.zone,members:members(site.zone,base),leash:M.leash,respawn:true,hpScale:M.hpScale[site.zone]*M.elite.hpScale});}
    }
    // 야생 둥지: 구역별 목표 수 = 땅 면적 × 밀도
    const area=[0,0,0,0,0];
    for(let k=0;k<g.land.length;k++)if(g.land[k])area[g.zone[k]]+=cellArea;
    const target=area.map((a,z)=>Math.round(a/1e6*M.nestPerMillionPx2[z]));
    const have=[0,0,0,0,0];
    const nearRoad=(c,r)=>{for(let dj=-r;dj<=r;dj++)for(let di=-r;di<=r;di++)if(g.inside(c.i+di,c.j+dj)&&g.road[g.index(c.i+di,c.j+dj)])return true;return false;};
    const roadCells=Math.ceil(M.roadClearance/g.cell);
    for(let t=0;t<30000;t++){
      const x=Math.floor(rng.range(40,g.size-40)),y=Math.floor(rng.range(40,g.size-40)),c=g.cellOf(x,y),k=g.index(c.i,c.j);
      if(!g.land[k]||!g.clear(c.i,c.j,1))continue;
      const z=g.zone[k];if(have[z]>=target[z])continue;
      let dx=x-spawn.x,dy=y-spawn.y;if(dx*dx+dy*dy<M.safeRadius*M.safeRadius)continue;
      if(this.sites.some(s=>{dx=x-s.x;dy=y-s.y;const rr=s.r+(s.kind==='boss'?260:110);return dx*dx+dy*dy<rr*rr;}))continue;
      if(nearRoad(c,roadCells))continue;
      if(this.props.some(p=>{dx=x-p.x;dy=y-p.y;const rr=(p.solid?solidFoot(p).r:0)+40;return dx*dx+dy*dy<rr*rr;}))continue;
      if(this.nests.some(n=>{dx=x-n.x;dy=y-n.y;return dx*dx+dy*dy<M.nestGap*M.nestGap;}))continue;
      this.nests.push({kind:'wild',x,y,zone:z,members:members(z,rng.int(M.group[z][0],M.group[z][1])),leash:M.leash,respawn:true,hpScale:M.hpScale[z]});have[z]++;
    }
  }

  // ⑥ 검증: 모든 거점이 스폰에서 걸어서 닿는가, 닿지 못하는 땅 비율
  validate(){
    const g=this.grid,cols=g.cols,seen=new Uint8Array(cols*g.rows),sp=this.sites[0],s=g.cellOf(sp.x,sp.y),stack=[g.index(s.i,s.j)];
    seen[stack[0]]=1;let reached=0;
    while(stack.length){const k=stack.pop();reached++;const ci=k%cols,cj=Math.floor(k/cols);
      for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){if(!di&&!dj)continue;const ni=ci+di,nj=cj+dj;if(!g.walkable(ni,nj))continue;const nk=g.index(ni,nj);if(seen[nk])continue;seen[nk]=1;stack.push(nk);}}
    let landCells=0,walkCells=0;for(let k=0;k<seen.length;k++){if(g.land[k]){landCells++;walkCells++;}}
    const reachable=this.sites.every(site=>{const c=g.cellOf(site.x,site.y);return seen[g.index(c.i,c.j)]===1;});
    const bosses=this.sites.filter(q=>q.kind==='boss').sort((a,b)=>a.zone-b.zone);
    const monotone=bosses.every((b,i)=>i===0||b.zone>bosses[i-1].zone);
    const mobsByZone=[0,0,0,0,0];for(const n of this.nests)mobsByZone[n.zone]+=n.members.length;
    return{ok:reachable&&monotone,mobsByZone,nests:this.nests.length,reachable,monotone,reachedRatio:reached/walkCells,landCells,sites:this.sites.length,props:this.props.length,roadEdges:this.roadEdges.length};
  }
}

// 외부에 내주는 읽기 전용 결과(충돌·그리기·미니맵·적 배치가 모두 이 하나를 읽는다)
class WorldMapLayout{
  constructor(gen,report){
    this.seed=gen.seed;this.size=WORLD_MAP.size;this.grid=gen.grid;this.sites=gen.sites;this.props=gen.props;this.decals=gen.decals;this.report=report;this.points=gen.points;this.nests=gen.nests;
    this.spawn=gen.sites[0];this.bosses=gen.sites.filter(s=>s.kind==='boss').sort((a,b)=>a.zone-b.zone);
    // 소비자(충돌·그리기·미니맵·보스 소환)가 읽는 보스 자리: 번호 = bossId = 구역 순서
    this.bossSites=this.bosses.map((b,i)=>({x:b.x,y:b.y,radius:b.r,zone:b.zone,bossId:i}));
  }
  blockedAt(x,y){const g=this.grid,c=g.cellOf(x,y);return g.land[g.index(c.i,c.j)]!==1;}
  // 반지름 r 원이 바다 칸에 닿는가: 원이 걸치는 칸마다 칸(사각형)과 원의 거리를 잽니다.
  terrainBlocks(x,y,r){
    if(x<0||y<0||x>=this.size||y>=this.size)return true;
    const g=this.grid,cell=g.cell,i0=Math.floor((x-r)/cell),i1=Math.floor((x+r)/cell),j0=Math.floor((y-r)/cell),j1=Math.floor((y+r)/cell),rr=r*r;
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      if(!g.inside(i,j))return true;
      const k=g.index(i,j);
      if(g.land[k]===1)continue;
      const nx=x<i*cell?i*cell:x>(i+1)*cell?(i+1)*cell:x,ny=y<j*cell?j*cell:y>(j+1)*cell?(j+1)*cell:y,dx=x-nx,dy=y-ny;
      if(dx*dx+dy*dy<=rr)return true;
    }
    return false;
  }
  // 같은 시드 → 같은 값(결정론 검사용 FNV-1a)
  hash(){
    let h=0x811C9DC5;const mix=v=>{h=Math.imul(h^(v&0xFF),0x01000193);h=Math.imul(h^((v>>>8)&0xFF),0x01000193);h=Math.imul(h^((v>>>16)&0xFF),0x01000193);h=Math.imul(h^((v>>>24)&0xFF),0x01000193);};
    const g=this.grid;for(const arr of [g.land,g.zone,g.biome,g.road])for(let i=0;i<arr.length;i++)mix(arr[i]);
    for(const s of this.sites){mix(s.x);mix(s.y);mix(s.zone);}
    for(const p of this.props){mix(p.x);mix(p.y);mix(p.r);}
    for(const n of this.nests){mix(n.x);mix(n.y);mix(n.members.length);}
    return(h>>>0).toString(16).padStart(8,'0');
  }
  zoneAt(x,y){const c=this.grid.cellOf(x,y);return this.grid.zone[this.grid.index(c.i,c.j)];}
  biomeAt(x,y){const c=this.grid.cellOf(x,y);return WORLD_MAP.biomes[this.grid.biome[this.grid.index(c.i,c.j)]];}
}

function generateWorldMap(seed){
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xFFFFFFFF)throw new RangeError('맵 시드는 0 이상 4294967295 이하의 정수여야 합니다');
  for(let attempt=0;attempt<WORLD_MAP.attempts;attempt++){const layout=new WorldMapGenerator(seed,attempt).build();if(layout){layout.attempt=attempt;return layout;}}
  throw new Error(`월드 맵 생성 실패: 시드 ${seed}`);
}
