  // Game rules own progression. Card ranks are per-run state; nothing here is persisted.
  const CARD_DEFS=Object.freeze([
    {id:'inkMax',name:'잉크 그릇',step:15,unit:'최대 잉크',max:5},
    {id:'inkRegen',name:'잉크 샘',step:3,unit:'잉크/초',max:5},
    {id:'inkDiscount',name:'붓의 절약',step:5,unit:'비용 감소 %p',max:5},
    {id:'attack',name:'붓끝의 힘',step:6,unit:'공격력 %',max:5},
    {id:'hp',name:'종이 갑옷',step:12,unit:'최대 HP',max:5}
  ]);
  // Zones are the five difficulty rings of the world map (WORLD_MAP.zoneNames); mob mix and scaling live in WORLD_MAP.mobs.
  const REGIONS=Object.freeze(WORLD_MAP.zoneNames.map((name,i)=>Object.freeze({id:'zone'+i,name,hpScale:WORLD_MAP.mobs.hpScale[i],damageScale:WORLD_MAP.mobs.damageScale[i]})));
  const emptyCards=()=>Object.fromEntries(CARD_DEFS.map(s=>[s.id,0]));
  function validCards(c){return !!c&&CARD_DEFS.every(s=>Number.isSafeInteger(c[s.id])&&c[s.id]>=0&&c[s.id]<=s.max);}
  function derivedStats(cards){return {maxInk:100+15*cards.inkMax,inkRegen:30+3*cards.inkRegen,inkCostRate:1-.05*cards.inkDiscount,maxHp:CFG.player.hp+12*cards.hp,power:1+.06*cards.attack};}
  function applyCards(a){Object.assign(a,derivedStats(a.cards));a.hp=Math.min(a.hp,a.maxHp);a.ink=Math.min(a.ink,a.maxInk);}
  function addCard(a,id){const spec=CARD_DEFS.find(s=>s.id===id);if(!spec||a.cards[id]>=spec.max)return false;a.cards[id]++;applyCards(a);return true;}
  function spellInkCost(a,shot){return +Math.min(a.maxInk,summonSpecOf(shot.kind).inkCost(shot.areaPower)*a.inkCostRate).toFixed(3);}
  function inkWait(a,cost){return Math.max(0,a.inkDelayMs)/1000+Math.max(0,cost-a.ink)/a.inkRegen;}
  function spendInk(a,cost){if(a.ink+1e-6<cost){if(a===player)showResult(`잉크 ${cost.toFixed(1)} 필요 · 현재 ${a.ink.toFixed(1)} · 약 ${inkWait(a,cost).toFixed(1)}초 회복 대기`,2200);return false;}a.ink=Math.max(0,a.ink-cost);a.inkDelayMs=750;return true;}
  function recoverInk(a,dt){const delayed=Math.min(dt,a.inkDelayMs);a.inkDelayMs=Math.max(0,a.inkDelayMs-dt);a.ink=Math.min(a.maxInk,a.ink+a.inkRegen*(dt-delayed)/1000);}
  function regionAt(x,y){return mapLayout.zoneAt(x,y);}
  function progressionQuest(){
    const total=BOSS_PROFILES.length,done=world.bossesDefeated;
    if(done>=total)return {title:'새 페이지를 완성했어요',text:`보스 ${total}/${total} 격파`,value:total,max:total};
    const boss=activeBoss();
    if(boss)return {title:`보스 ${boss.bossId+1}/${total} · ${boss.name}`,text:bossSealed(boss.bossId)?`봉인됨(피해 −90%) · ${boss.bossId}번 보스를 먼저 쓰러뜨리세요`:BOSS_PROFILES[boss.bossId].ruleText(),value:done,max:total};
    const next=nextBossId();
    return {title:`보스 ${done}/${total} 격파 · 다음은 ${next+1}번 ${BOSS_PROFILES[next].name}`,text:'지도의 번호 표식으로 가세요 · 규칙은 만나면 알려줘요',value:done,max:total};
  }
