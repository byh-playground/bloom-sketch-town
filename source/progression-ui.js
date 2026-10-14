  // Bounko tech-view pattern: family tabs -> a compact tree -> stable detail -> explicit investment.
  let growthTab='ink',growthSelected='inkMax',environmentTarget=null,growthSignature='',estimateSignature='',estimatedShot=null;
  function queueProgression(command){world.commands.push(command);wakeInputPreview();}
  function selectGrowth(tab,id){growthTab=tab;growthSelected=id;location.hash=`#/growth?tab=${tab}&item=${id}`;renderGrowth();}
  function growthNode(id,name,status,selected){const b=document.createElement('button');b.type='button';b.className='growth-node';b.dataset.node=id;b.setAttribute('aria-pressed',String(selected));b.innerHTML='<b></b><small></small>';b.querySelector('b').textContent=name;b.querySelector('small').textContent=status;b.onclick=()=>selectGrowth(growthTab,id);return b;}
  function renderGrowth(){if(ui?.modal!=='growth')return;
    const signature=JSON.stringify([growthTab,growthSelected,player.level,player.investments,world.regionKills,world.gates.door.open,world.gates.bridge.open]);if(signature===growthSignature)return;growthSignature=signature;
    $('growthPoints').textContent=`LV ${player.level} · 남은 포인트 ${availablePoints(player)}`;
    for(const b of $('growthTabs').children)b.setAttribute('aria-selected',String(b.dataset.tab===growthTab));
    const tree=$('growthTree');tree.replaceChildren();
    if(growthTab==='explore'){
      const items=[['forest','잉크 숲',regionCleared(0)?'공략 완료':`${world.regionKills[0]}/5`],['door','문 그리기',world.gates.door.open?'완료':regionCleared(0)?'그리기 가능':'숲 공략 필요'],['marsh','안개 습지',regionCleared(1)?'공략 완료':world.gates.door.open?`${world.regionKills[1]}/5`:'문 필요'],['bridge','다리 그리기',world.gates.bridge.open?'완료':regionCleared(1)?'그리기 가능':'습지 공략 필요'],['quarry','종이 채석장',world.gates.bridge.open?'탐험 가능':'다리 필요']];
      for(const [i,item]of items.entries()){if(i){const link=document.createElement('span');link.className='growth-link';link.textContent='↓';tree.append(link);}tree.append(growthNode(...item,item[0]===growthSelected));}
      const current=items.find(x=>x[0]===growthSelected)||items[0],gate=gateOf(current[0]);
      $('growthDetailTitle').textContent=current[1];$('growthDetailText').textContent=gate?`${gate.instruction} 선행 조건: ${REGIONS[gate.region].name} 공략 ${world.regionKills[gate.region]}/${REGIONS[gate.region].goal}. 표시 지점에서 E / 그리기를 선택합니다.`:current[0]==='forest'?'지역 안에서 자유롭게 걷고 적 5마리를 물리치면 동쪽 종이벽에 문을 그릴 수 있습니다.':current[0]==='marsh'?'숲 공략과 문 완성이 선행 조건입니다. 습지 적 5마리를 물리치고 동쪽 끊어진 길에 다리를 그립니다.':'습지 공략과 다리 완성이 선행 조건입니다. 채석장의 적을 물리치면 잉크 감시자가 나타납니다.';
      $('growthEffect').textContent=gate?`실제 잉크 비용 ${gateInkCost(player,gate)} · 통로 폭 ${gate.passage}`:current[2];$('investButton').hidden=true;
    }else{
      const list=STAT_DEFS.filter(s=>s.group===growthTab);for(const s of list)tree.append(growthNode(s.id,s.name,`${player.investments[s.id]} / ${s.max}${player.investments[s.id]===s.max?' · 완료':availablePoints(player)>0?' · 투자 가능':' · 포인트 필요'}`,s.id===growthSelected));
      const spec=list.find(s=>s.id===growthSelected)||list[0],rank=player.investments[spec.id];$('growthDetailTitle').textContent=spec.name;$('growthDetailText').textContent=`포인트 1개로 ${spec.unit} +${spec.step}. 최대 ${spec.max}회. 선택만으로 투자하지 않습니다.`;
      const values={inkMax:player.maxInk,inkRegen:player.inkRegen,inkDiscount:(1-player.inkCostRate)*100,attack:(player.power-1)*100,hp:player.maxHp};
      $('growthEffect').textContent=`현재 ${spec.unit} ${values[spec.id].toFixed(0)} → 다음 ${(values[spec.id]+(rank<spec.max?spec.step:0)).toFixed(0)} · ${rank}/${spec.max}`;$('investButton').hidden=false;$('investButton').disabled=availablePoints(player)<1||rank>=spec.max;$('investButton').textContent=rank>=spec.max?'투자 완료':'1포인트 투자';
    }
    $('redistributeButton').disabled=STAT_DEFS.every(s=>player.investments[s.id]===0);
  }
  for(const b of $('growthTabs').children)b.onclick=()=>selectGrowth(b.dataset.tab,b.dataset.tab==='explore'?'forest':STAT_DEFS.find(s=>s.group===b.dataset.tab).id);
  $('growthButton').onclick=()=>goRoute('growth');$('investButton').onclick=()=>queueProgression({type:'invest',id:growthSelected});$('redistributeButton').onclick=()=>queueProgression({type:'redistribute'});
  function armEnvironment(){if(!drawingAllowed())return;const g=nearbyGate(player);if(!g){if(hypot(player.x-683,player.y-615)<110)goRoute('growth');else showResult('환경 그리기는 표시된 문·다리 지점 가까이에서 시작합니다.',1700);return;}if(!regionCleared(g.region)){showResult(`${REGIONS[g.region].name} 공략 ${world.regionKills[g.region]}/${REGIONS[g.region].goal} 완료 후 그릴 수 있어요.`,1900);return;}dropDraw();environmentTarget=g.id;$('strokeStatus').textContent=g.instruction;showResult(`${g.name} · 잉크 ${gateInkCost(player,g)} · Esc로 취소`,1800);}
  $('environmentButton').onclick=()=>{focusGameplay();armEnvironment();};
  document.addEventListener('keydown',e=>{if(e.code==='Escape'&&environmentTarget)dropDraw();});
  function updateProgressionHud(){const quest=progressionQuest();$('questTitle').textContent=quest.title;$('questText').textContent=quest.text;$('questProgress').max=quest.max;$('questProgress').value=quest.value;$('regionText').textContent=quest.title+' · '+quest.text;
    $('inkText').textContent=`잉크 ${Math.floor(player.ink)} / ${player.maxInk}`;
    const g=environmentTarget?gateOf(environmentTarget):nearbyGate(player);$('environmentButton').textContent=g?`${g.id==='door'?'문':'다리'} 그리기`:'환경 그리기';$('environmentButton').setAttribute('aria-pressed',String(!!environmentTarget));
    let cost=environmentTarget?gateInkCost(player,g):0;
    if(!cost&&drawInput.points.length>=3&&drawInput.length>=16){const signature=drawInput.points.length+':'+drawInput.length+':'+selectedGlyph;if(signature!==estimateSignature){estimateSignature=signature;estimatedShot=makeShotData(drawInput.points);}cost=spellInkCost(player,estimatedShot);}else if(!drawInput.points.length){estimateSignature='';estimatedShot=null;}
    $('inkEstimate').textContent=cost?`예상 잉크 ${cost.toFixed(1)}${player.ink<cost?` · ${cost.toFixed(1)} 필요 / 약 ${inkWait(player,cost).toFixed(1)}초 대기`:''}`:`회복 ${player.inkRegen}/초 · 소비 뒤 0.75초 대기`;
    persistProgression();renderGrowth();
  }
  function drawGateTerrain(){for(const g of GATES){
    const state=world.gates[g.id],barrierColor=g.id==='door'?'#d7c2a6':'#abc7ce';
    P.box(g.x,CFG.world.height/2,g.width,CFG.world.height,barrierColor,.78);
    if(state.open)P.box(g.x,g.y,g.width+8,g.passage,g.id==='door'?'#f5e8cf':'#d6bd91',1);
    else{P.box(g.x,g.y,g.width-12,g.passage,g.id==='door'?'#faf0d9':'#6b969f',.92);P.ring(g.x,g.y,44,regionCleared(g.region)?'#467c68':'#9a8774',.8,3,20);}
    P.line(g.x-g.width/2,0,g.x-g.width/2,CFG.world.height,2,'#677877',.5);P.line(g.x+g.width/2,0,g.x+g.width/2,CFG.world.height,2,'#677877',.5);
    if(state.open){for(let i=1;i<state.stroke.length;i++){const a=state.stroke[i-1],b=state.stroke[i];P.line(g.x+a.x,g.y+a.y,g.x+b.x,g.y+b.y,4,'#365e61',.95);}}
  }}
  function drawGateLabels(){for(const g of GATES){if(!visible(g.x,g.y,220))continue;renderer.worldToScreenInto(g.x,g.y-115,anchorReuse);txtCtx.textAlign='center';txtCtx.font='900 12px system-ui';txtCtx.lineWidth=4;txtCtx.strokeStyle='#fffaf0';const text=world.gates[g.id].open?g.name+' · 완성':g.name+' · '+(regionCleared(g.region)?'E / 그리기':REGIONS[g.region].name+' 공략 필요');txtCtx.strokeText(text,anchorReuse.x,anchorReuse.y);txtCtx.fillStyle='#345c60';txtCtx.fillText(text,anchorReuse.x,anchorReuse.y);}}
  function drawEnvironmentGuide(){if(!environmentTarget)return;const g=gateOf(environmentTarget),raw=g.id==='door'?[[-40,60],[-40,-55],[0,-70],[40,-55],[40,60]]:[[-65,0],[65,0]],points=raw.map(([x,y])=>{const s={x:0,y:0};renderer.worldToScreenInto(g.x+x,g.y+y,s);return s;});drawCtx.save();drawCtx.setLineDash([5,5]);drawCtx.lineWidth=3;drawCtx.strokeStyle='#538b81';drawCtx.beginPath();points.forEach((p,i)=>i?drawCtx.lineTo(p.x,p.y):drawCtx.moveTo(p.x,p.y));drawCtx.stroke();drawCtx.setLineDash([]);for(const p of [points[0],points.at(-1)]){drawCtx.beginPath();drawCtx.arc(p.x,p.y,7,0,Math.PI*2);drawCtx.stroke();}drawCtx.restore();}
