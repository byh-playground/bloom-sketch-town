  // Ink meter and quest HUD only project accepted simulation state.
  let estimateSignature='',estimatedShot=null;
  function updateProgressionHud(){const quest=progressionQuest(),region=REGIONS[regionAt(player.x)];$('questTitle').textContent=quest.title;$('questText').textContent=quest.text;$('questProgress').max=quest.max;$('questProgress').value=quest.value;$('regionTitle').textContent=region.name;$('regionText').textContent=`적 ${Math.min(world.regionKills[regionAt(player.x)],region.goal)}/${region.goal}`;$('regionProgress').value=Math.min(world.regionKills[regionAt(player.x)],region.goal);$('regionProgress').max=region.goal;
    let cost=0;
    if(drawInput.points.length>=3&&drawInput.length>=16){const signature=drawInput.points.length+':'+drawInput.length+':'+selectedGlyph;if(signature!==estimateSignature){estimateSignature=signature;estimatedShot=makeShotData(drawInput.points);}cost=spellInkCost(player,estimatedShot);}else if(!drawInput.points.length){estimateSignature='';estimatedShot=null;}
    const shortage=cost>player.ink,fill=100*player.ink/player.maxInk,pending=100*Math.min(cost,player.ink)/player.maxInk;
    $('inkText').textContent=`${Math.floor(player.ink)} / ${player.maxInk}`;$('inkFill').style.width=fill+'%';$('inkReservation').style.left=Math.max(0,fill-pending)+'%';$('inkReservation').style.width=pending+'%';
    $('inkBar').setAttribute('aria-valuenow',String(Math.floor(player.ink)));$('inkBar').setAttribute('aria-valuemax',String(player.maxInk));$('inkMeter').dataset.state=shortage?'shortage':player.inkDelayMs>0?'waiting':player.ink<player.maxInk?'recovering':'ready';
    $('inkRecovery').textContent=shortage?`부족 · 약 ${inkWait(player,cost).toFixed(1)}초`:player.inkDelayMs>0?`${(player.inkDelayMs/1000).toFixed(1)}초 뒤 회복`:player.ink<player.maxInk?`초당 +${player.inkRegen} 회복`:'가득 참';
    $('inkEstimate').textContent=cost?`예상 소모 ${cost.toFixed(1)}${shortage?` · ${cost.toFixed(1)} 필요`:''}`:`공격에 사용 · 회복 ${player.inkRegen}/초`;
    $('drawMode').textContent='한 획 마법';
  }
