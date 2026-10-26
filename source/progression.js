  // Game rules own progression. Card ranks are per-run state; nothing here is persisted.
  const CARD_DEFS=Object.freeze([
    {id:'inkMax',name:'잉크 그릇',step:15,unit:'최대 잉크',max:5},
    {id:'inkRegen',name:'잉크 샘',step:1,unit:'잉크/초',max:5},
    {id:'inkDiscount',name:'붓의 절약',step:5,unit:'비용 감소 %p',max:5},
    {id:'attack',name:'붓끝의 힘',step:6,unit:'공격력 %',max:5},
    {id:'hp',name:'종이 갑옷',step:12,unit:'최대 HP',max:5}
  ]);
  const REGIONS=Object.freeze([
    {id:'forest',name:'잉크 숲',min:0,max:1450,goal:5,color:'#e7eedc',spawns:[['chaser',930,590],['spitter',1120,910],['charger',1220,680],['chaser',1030,750],['spitter',1270,1000]]},
    {id:'marsh',name:'안개 습지',min:1450,max:2900,goal:5,color:'#dce9e6',spawns:[['spitter',1770,570],['chaser',1940,930],['charger',2260,710],['spitter',2450,1010],['chaser',2600,580]]},
    {id:'quarry',name:'종이 채석장',min:2900,max:4400,goal:3,color:'#e7e1d9',spawns:[['charger',3170,580],['spitter',3360,900],['charger',3590,670]]}
  ]);
  const emptyCards=()=>Object.fromEntries(CARD_DEFS.map(s=>[s.id,0]));
  function validCards(c){return !!c&&CARD_DEFS.every(s=>Number.isSafeInteger(c[s.id])&&c[s.id]>=0&&c[s.id]<=s.max);}
  function derivedStats(cards){return {maxInk:100+15*cards.inkMax,inkRegen:8+cards.inkRegen,inkCostRate:1-.05*cards.inkDiscount,maxHp:CFG.player.hp+12*cards.hp,power:1+.06*cards.attack};}
  function applyCards(a){Object.assign(a,derivedStats(a.cards));a.hp=Math.min(a.hp,a.maxHp);a.ink=Math.min(a.ink,a.maxInk);}
  function addCard(a,id){const spec=CARD_DEFS.find(s=>s.id===id);if(!spec||a.cards[id]>=spec.max)return false;a.cards[id]++;applyCards(a);return true;}
  function spellInkCost(a,shot){return +( (shot.kind==='normal'||shot.kind==='line'?4:12+8*clamp(shot.areaPower,0,1))*a.inkCostRate).toFixed(3);}
  function inkWait(a,cost){return Math.max(0,a.inkDelayMs)/1000+Math.max(0,cost-a.ink)/a.inkRegen;}
  function spendInk(a,cost){if(a.ink+1e-6<cost){if(a===player)showResult(`잉크 ${cost.toFixed(1)} 필요 · 현재 ${a.ink.toFixed(1)} · 약 ${inkWait(a,cost).toFixed(1)}초 회복 대기`,2200);return false;}a.ink=Math.max(0,a.ink-cost);a.inkDelayMs=750;return true;}
  function recoverInk(a,dt){const delayed=Math.min(dt,a.inkDelayMs);a.inkDelayMs=Math.max(0,a.inkDelayMs-dt);a.ink=Math.min(a.maxInk,a.ink+a.inkRegen*(dt-delayed)/1000);}
  function regionAt(x){return x<REGIONS[0].max?0:x<REGIONS[1].max?1:2;}
  function regionCleared(i){return world.regionKills[i]>=REGIONS[i].goal;}
  function allRegionsCleared(){return REGIONS.every((_,i)=>regionCleared(i));}
  function spawnRegion(index){for(const [kind,x,y]of REGIONS[index].spawns)spawnEnemy(kind,x,y);}
  function progressionQuest(){
    if(world.bossDefeated)return {title:'새 페이지를 완성했어요',text:'잉크 감시자를 쓰러뜨렸어요',value:1,max:1};
    if(world.bossSpawned)return {title:'잉크 감시자',text:'잉크 감시자를 쓰러뜨리세요',value:0,max:1};
    const goal=REGIONS.reduce((n,r)=>n+r.goal,0),kills=REGIONS.reduce((n,r,i)=>n+Math.min(world.regionKills[i],r.goal),0);
    return {title:'잉크 몬스터 소탕',text:`적 ${kills}/${goal} · 모두 물리치면 감시자가 나타나요`,value:kills,max:goal};
  }
