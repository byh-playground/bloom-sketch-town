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
    {id:'door',name:'봉인 종이벽 · 문',x:1450,y:735,width:128,passage:180,cost:25,region:0,next:1,instruction:'벽의 표시를 따라 문 윤곽을 한 획으로 그리세요.'},
    {id:'bridge',name:'끊어진 길 · 다리',x:2900,y:735,width:130,passage:180,cost:40,region:1,next:2,instruction:'표시된 양 끝을 한 획으로 연결하세요.'}
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
  function validGateStroke(gate,points){
    if(!Array.isArray(points)||points.length<3||points.length>36||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>160||Math.abs(p.y)>170))return false;
    const box=strokeBounds(points),length=strokeLength(points);
    if(gate.id==='door')return box.minX<-20&&box.maxX>20&&box.minY<-30&&box.maxY>30&&box.width<180&&box.height<230&&length>(box.height*2+box.width)*.7;
    const a=points[0],b=points.at(-1),left={x:-65,y:0},right={x:65,y:0};
    return (hypot(a.x-left.x,a.y)<40&&hypot(b.x-right.x,b.y)<40||hypot(b.x-left.x,b.y)<40&&hypot(a.x-right.x,a.y)<40)&&length>=85&&length<480&&box.height<140;
  }
  function completeGate(a,id,points){const gate=gateOf(id);if(!gate||world.gates[id].open||!regionCleared(gate.region)||hypot(a.x-gate.x,a.y-gate.y)>=185||!validGateStroke(gate,points)||!spendInk(a,gateInkCost(a,gate)))return false;
    world.gates[id]={open:true,stroke:points.map(p=>({...p})),owner:actorId(a)};spawnRegion(gate.next);announce(`${gate.name} 완성 · ${REGIONS[gate.next].name}으로!`,2200);return true;
  }
  function progressionQuest(){const gate=GATES.find(g=>!world.gates[g.id].open);if(gate){const region=REGIONS[gate.region],kills=world.regionKills[gate.region];return {title:regionCleared(gate.region)?gate.name+' 그리기':region.name+' 공략',text:regionCleared(gate.region)?`동쪽 표시 지점 · E / 그리기 · 잉크 ${gateInkCost(player,gate)}`:`적 ${Math.min(kills,region.goal)}/${region.goal} · 다음 ${gate.id==='door'?'문':'다리'}를 열 준비`,value:Math.min(kills,region.goal),max:region.goal};}return {title:world.bossDefeated?'새 페이지를 완성했어요':'종이 채석장 공략',text:world.bossSpawned?'잉크 감시자를 쓰러뜨리세요':`적 ${world.regionKills[2]}/3 · 감시자에게 가는 길`,value:Math.min(world.regionKills[2],3),max:3};}
