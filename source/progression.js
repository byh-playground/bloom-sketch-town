  // Game rules own progression. UI and persistence only project accepted simulation state.
  const STAT_DEFS=Object.freeze([
    {id:'inkMax',group:'ink',name:'잉크 그릇',step:15,unit:'최대 잉크',max:5},
    {id:'inkRegen',group:'ink',name:'잉크 샘',step:1,unit:'잉크/초',max:5},
    {id:'inkDiscount',group:'ink',name:'붓의 절약',step:5,unit:'비용 감소 %p',max:5},
    {id:'attack',group:'combat',name:'붓끝의 힘',step:6,unit:'공격력 %',max:5},
    {id:'hp',group:'combat',name:'종이 갑옷',step:12,unit:'최대 HP',max:5}
  ]);
  const REGIONS=Object.freeze([
    {id:'forest',name:'잉크 숲',min:0,max:1450,goal:5,color:'#e7eedc',spawns:[['chaser',930,590],['spitter',1120,910],['charger',1220,680],['chaser',1030,750],['spitter',1270,1000]]},
    {id:'marsh',name:'안개 습지',min:1450,max:2900,goal:5,color:'#dce9e6',spawns:[['spitter',1770,570],['chaser',1940,930],['charger',2260,710],['spitter',2450,1010],['chaser',2600,580]]},
    {id:'quarry',name:'종이 채석장',min:2900,max:4400,goal:3,color:'#e7e1d9',spawns:[['charger',3170,580],['spitter',3360,900],['charger',3590,670]]}
  ]);
  const GATES=Object.freeze([
    {id:'door',name:'봉인 종이벽 · 문',x:1450,y:735,width:128,passage:180,cost:25,region:0,next:1,instruction:'흐린 안내 위에 둘레원 한 바퀴와 오각별을 한 획으로 그리세요.'},
    {id:'bridge',name:'끊어진 길 · 다리',x:2900,y:735,width:130,passage:180,cost:40,region:1,next:2,instruction:'둘레원과 오각별 마법진을 완성하면 다리가 나타납니다.'}
  ]);
  const PROFILE_KEY='sketch-town-progression-0.15';
  const emptyInvestments=()=>Object.fromEntries(STAT_DEFS.map(s=>[s.id,0]));
  function validProfile(p){return !!p&&Number.isSafeInteger(p.level)&&p.level>=1&&p.level<=100&&Number.isFinite(p.xp)&&p.xp>=0&&p.xp<1e8&&p.investments&&STAT_DEFS.every(s=>Number.isSafeInteger(p.investments[s.id])&&p.investments[s.id]>=0&&p.investments[s.id]<=s.max)&&STAT_DEFS.reduce((n,s)=>n+p.investments[s.id],0)<=p.level;}
  function readProfile(){try{const p=JSON.parse(localStorage.getItem(PROFILE_KEY));if(validProfile(p))return p;}catch{}return {level:1,xp:0,investments:emptyInvestments()};}
  const savedProfile=readProfile();
  function xpThreshold(level){let n=65;for(let i=1;i<level;i++)n=Math.round(n*1.32+10);return n;}
  function profileOf(a){return {level:a.level,xp:a.xp,investments:{...a.investments}};}
  function derivedStats(investments){return {maxInk:100+15*investments.inkMax,inkRegen:8+investments.inkRegen,inkCostRate:1-.05*investments.inkDiscount,maxHp:CFG.player.hp+12*investments.hp,power:1+.06*investments.attack};}
  function applyInvestments(a){Object.assign(a,derivedStats(a.investments));a.hp=Math.min(a.hp,a.maxHp);a.ink=Math.min(a.ink,a.maxInk);}
  function availablePoints(a){return a.level-STAT_DEFS.reduce((n,s)=>n+a.investments[s.id],0);}
  function invest(a,id){const spec=STAT_DEFS.find(s=>s.id===id);if(!spec||a.investments[id]>=spec.max||availablePoints(a)<1)return false;a.investments[id]++;applyInvestments(a);return true;}
  function redistribute(a){a.investments=emptyInvestments();applyInvestments(a);}
  function restoreProfile(a,p){if(!validProfile(p))return false;a.level=p.level;a.xp=p.xp;a.xpNext=xpThreshold(p.level);a.investments={...p.investments};applyInvestments(a);return true;}
  let lastSavedProfile='';
  function persistProgression(){if(mp.connecting||mp.role==='join'&&!mp.profileReady)return;const text=JSON.stringify(profileOf(player));if(text===lastSavedProfile)return;try{localStorage.setItem(PROFILE_KEY,text);lastSavedProfile=text;}catch{}}
  function spellInkCost(a,shot){return +( (shot.kind==='normal'||shot.kind==='line'?4:12+8*clamp(shot.areaPower,0,1))*a.inkCostRate).toFixed(3);}
  function gateInkCost(a,gate){return +(gate.cost*a.inkCostRate).toFixed(3);}
  function inkWait(a,cost){return Math.max(0,a.inkDelayMs)/1000+Math.max(0,cost-a.ink)/a.inkRegen;}
  function spendInk(a,cost){if(a.ink+1e-6<cost){if(a===player)showResult(`잉크 ${cost.toFixed(1)} 필요 · 현재 ${a.ink.toFixed(1)} · 약 ${inkWait(a,cost).toFixed(1)}초 회복 대기`,2200);return false;}a.ink=Math.max(0,a.ink-cost);a.inkDelayMs=750;return true;}
  function recoverInk(a,dt){const delayed=Math.min(dt,a.inkDelayMs);a.inkDelayMs=Math.max(0,a.inkDelayMs-dt);a.ink=Math.min(a.maxInk,a.ink+a.inkRegen*(dt-delayed)/1000);}
  function regionAt(x){return x<REGIONS[0].max?0:x<REGIONS[1].max?1:2;}
  function regionCleared(i){return world.regionKills[i]>=REGIONS[i].goal;}
  function gateOf(id){return GATES.find(g=>g.id===id);}
  function nearbyGate(a){return GATES.find(g=>!world.gates[g.id].open&&hypot(a.x-g.x,a.y-g.y)<185);}
  function gateBlocked(x,y,r){return GATES.some(g=>Math.abs(x-g.x)<g.width/2+r&&(!world.gates[g.id].open||Math.abs(y-g.y)>g.passage/2-r));}
  function spawnRegion(index){for(const [kind,x,y]of REGIONS[index].spawns)spawnEnemy(kind,x,y);}
  // Pure geometric structure, not a CNN label or a loose bounding box.
  // Same quantized stroke is checked by solo/RTC command execution and checkpoint validation.
  function pointSegmentDistance(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);return hypot(p.x-a.x-dx*t,p.y-a.y-dy*t);}
  function simplifyGateStroke(raw){
    const points=raw.filter((p,i)=>!i||hypot(p.x-raw[i-1].x,p.y-raw[i-1].y)>.35);
    if(points.length<3)return points;
    const box=strokeBounds(points);let epsilon=Math.max(.35,Math.max(box.width,box.height)*.006);
    function reduce(path){if(path.length<3)return path;let distance=0,index=0;for(let i=1;i<path.length-1;i++){const d=pointSegmentDistance(path[i],path[0],path.at(-1));if(d>distance){distance=d;index=i;}}if(distance<=epsilon)return [path[0],path.at(-1)];return [...reduce(path.slice(0,index+1)).slice(0,-1),...reduce(path.slice(index))];}
    let result=reduce(points);while(result.length>72){epsilon*=1.5;result=reduce(points);}return result.map(p=>({x:+p.x.toFixed(2),y:+p.y.toFixed(2)}));
  }
  function circleStructure(points){
    if(points.length<9)return null;const b=strokeBounds(points),cx=(b.minX+b.maxX)/2,cy=(b.minY+b.maxY)/2,r=(b.width+b.height)/4;
    if(r<25||r>118||hypot(cx,cy)>70||b.width/b.height<.72||b.width/b.height>1.38||hypot(points[0].x-points.at(-1).x,points[0].y-points.at(-1).y)>r*.32)return null;
    let sweep=0,travel=0,error=0;for(let i=0;i<points.length;i++){const p=points[i];error+=Math.abs(hypot(p.x-cx,p.y-cy)-r)/r;if(i){const a=points[i-1],u=Math.atan2(a.y-cy,a.x-cx),v=Math.atan2(p.y-cy,p.x-cx);let delta=v-u;while(delta>Math.PI)delta-=Math.PI*2;while(delta<-Math.PI)delta+=Math.PI*2;sweep+=delta;travel+=Math.abs(delta);}}
    if(Math.abs(sweep)<5.5||Math.abs(sweep)>7.3||travel>Math.abs(sweep)*1.18||error/points.length>.14)return null;return {cx,cy,r};
  }
  function starStructure(points,circle){
    if(points.length<6)return false;const {cx,cy,r}=circle,box=strokeBounds(points),length=strokeLength(points),radius=Math.max(...points.map(p=>hypot(p.x-cx,p.y-cy)));
    if(radius<r*.65||radius>r*1.16||length<radius*6.2||length>radius*12.5||hypot(points[0].x-points.at(-1).x,points[0].y-points.at(-1).y)>radius*.4||hypot((box.minX+box.maxX)/2-cx,(box.minY+box.maxY)/2-cy)>r*.25)return false;
    const sampled=resample(points,length/48);
    for(let angle=0;angle<Math.PI*2;angle+=Math.PI/36){const tips=Array.from({length:5},(_,i)=>({x:cx+Math.cos(angle+i*Math.PI*2/5)*radius,y:cy+Math.sin(angle+i*Math.PI*2/5)*radius}));
      for(const outline of [false,true]){
        const vertices=outline?tips.flatMap((p,i)=>[p,{x:cx+Math.cos(angle+(i+.5)*Math.PI*2/5)*radius*.4,y:cy+Math.sin(angle+(i+.5)*Math.PI*2/5)*radius*.4}]):[tips[0],tips[2],tips[4],tips[1],tips[3]];
        const edges=vertices.map((p,i)=>[p,vertices[(i+1)%vertices.length]]),nearest=p=>Math.min(...edges.map(([a,b])=>pointSegmentDistance(p,a,b)));
        if(sampled.reduce((n,p)=>n+nearest(p),0)/sampled.length>radius*.095)continue;
        const covered=edges.every(([a,b])=>[.2,.4,.6,.8].filter(t=>{const p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};let d=Infinity;for(let i=1;i<points.length;i++)d=Math.min(d,pointSegmentDistance(p,points[i-1],points[i]));return d<radius*.15;}).length>=3);
        if(covered)return true;
      }
    }return false;
  }
  function magicCircleResult(points){
    if(!Array.isArray(points)||points.length<12||points.length>72||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>160||Math.abs(p.y)>170))return {ok:false,reason:'둘레원과 별을 한 획으로 충분히 그려 주세요.'};
    let ringFound=!!circleStructure(points);
    for(let split=5;split<points.length-5;split++)for(const reverse of [false,true]){const a=points.slice(0,split+1),b=points.slice(split);const ring=circleStructure(reverse?b:a);if(!ring)continue;ringFound=true;if(starStructure(reverse?a:b,ring))return {ok:true,reason:'별과 둘레원 완성',circle:ring};}
    return {ok:false,reason:ringFound?'둘레원 안의 다섯 꼭짓점 별을 모두 연결하세요.':'별을 둘러싸는 원을 한 바퀴 닫아 주세요.'};
  }
  function validGateStroke(gate,points){return magicCircleResult(points).ok;}

  function completeGate(a,id,points){const gate=gateOf(id);if(!gate||world.gates[id].open||!regionCleared(gate.region)||hypot(a.x-gate.x,a.y-gate.y)>=185||!validGateStroke(gate,points)||!spendInk(a,gateInkCost(a,gate)))return false;
    world.gates[id]={open:true,stroke:points.map(p=>({...p})),owner:actorId(a),openedAtMs:world.clockMs};spawnRegion(gate.next);announce(`${gate.name} 완성 · ${REGIONS[gate.next].name}으로!`,2200);return true;
  }
  function progressionQuest(){const gate=GATES.find(g=>!world.gates[g.id].open);if(gate){const region=REGIONS[gate.region],kills=world.regionKills[gate.region];return {title:regionCleared(gate.region)?gate.name+' 그리기':region.name+' 공략',text:regionCleared(gate.region)?`동쪽 표시 지점 · E / 그리기 · 잉크 ${gateInkCost(player,gate)}`:`적 ${Math.min(kills,region.goal)}/${region.goal} · 다음 ${gate.id==='door'?'문':'다리'} 열 준비`,value:Math.min(kills,region.goal),max:region.goal};}return {title:world.bossDefeated?'새 페이지를 완성했어요':'종이 채석장 공략',text:world.bossSpawned?'잉크 감시자를 쓰러뜨리세요':`적 ${world.regionKills[2]}/3 · 감시자에게 가는 길`,value:Math.min(world.regionKills[2],3),max:3};}
