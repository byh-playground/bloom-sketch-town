  // Bounko tech-view pattern: family tabs -> a compact tree -> stable detail -> explicit investment.
  let growthTab='ink',growthSelected='inkMax',environmentTarget=null,environmentFeedback='',growthSignature='',estimateSignature='',estimatedShot=null;
  function queueProgression(command){world.commands.push(command);wakeInputPreview();}
  function selectGrowth(tab,id){growthTab=tab;growthSelected=id;location.hash=`#/growth?tab=${tab}&item=${id}`;renderGrowth();}
  function growthNode(id,name,status,selected){const b=document.createElement('button');b.type='button';b.className='growth-node';b.dataset.node=id;b.setAttribute('aria-pressed',String(selected));b.innerHTML='<b></b><small></small><span class="growth-ranks" aria-hidden="true"></span>';const stat=STAT_DEFS.find(s=>s.id===id);if(stat){const fill=document.createElement('i');fill.style.width=(player.investments[id]/stat.max*100)+'%';b.querySelector('.growth-ranks').append(fill);}else b.querySelector('.growth-ranks').remove();b.querySelector('b').textContent=name;b.querySelector('small').textContent=status;b.onclick=()=>selectGrowth(growthTab,id);return b;}
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
      $('growthEffect').textContent=gate?`실제 잉크 비용 ${gateInkCost(player,gate)}`:current[2];$('investButton').hidden=true;
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
  function armEnvironment(){if(!drawingAllowed())return;const g=nearbyGate(player);if(!g){if(hypot(player.x-683,player.y-615)<110)goRoute('growth');else showResult('환경 그리기는 표시된 문·다리 지점 가까이에서 시작합니다.',1700);return;}if(!regionCleared(g.region)){showResult(`${REGIONS[g.region].name} 공략 ${world.regionKills[g.region]}/${REGIONS[g.region].goal} 완료 후 그릴 수 있어요.`,1900);return;}dropDraw();environmentTarget=g.id;environmentFeedback='';$('strokeStatus').textContent=g.instruction;showResult(`${g.name} · 잉크 ${gateInkCost(player,g)} · Esc로 취소`,1800);}
  $('cancelEnvironment').onclick=()=>dropDraw();
  $('environmentButton').onclick=()=>{focusGameplay();armEnvironment();};
  document.addEventListener('keydown',e=>{if(e.code==='Escape'&&environmentTarget)dropDraw();});
  function updateProgressionHud(){const quest=progressionQuest(),region=REGIONS[regionAt(player.x)];$('questTitle').textContent=quest.title;$('questText').textContent=quest.text;$('questProgress').max=quest.max;$('questProgress').value=quest.value;$('regionTitle').textContent=region.name;$('regionText').textContent=quest.text;$('regionProgress').value=quest.value;$('regionProgress').max=quest.max;
    if(environmentTarget&&world.gates[environmentTarget].open){environmentTarget=null;environmentFeedback='';}
    const g=environmentTarget?gateOf(environmentTarget):nearbyGate(player);$('environmentButton').textContent=g?`E · ${g.id==='door'?'문':'다리'} 마법진`:'E · 환경 마법진';$('environmentButton').setAttribute('aria-pressed',String(!!environmentTarget));
    let cost=environmentTarget?gateInkCost(player,g):0;
    if(!cost&&drawInput.points.length>=3&&drawInput.length>=16){const signature=drawInput.points.length+':'+drawInput.length+':'+selectedGlyph;if(signature!==estimateSignature){estimateSignature=signature;estimatedShot=makeShotData(drawInput.points);}cost=spellInkCost(player,estimatedShot);}else if(!drawInput.points.length){estimateSignature='';estimatedShot=null;}
    const shortage=cost>player.ink,fill=100*player.ink/player.maxInk,pending=100*Math.min(cost,player.ink)/player.maxInk;
    $('inkText').textContent=`${Math.floor(player.ink)} / ${player.maxInk}`;$('inkFill').style.width=fill+'%';$('inkReservation').style.left=Math.max(0,fill-pending)+'%';$('inkReservation').style.width=pending+'%';
    $('inkBar').setAttribute('aria-valuenow',String(Math.floor(player.ink)));$('inkBar').setAttribute('aria-valuemax',String(player.maxInk));$('inkMeter').dataset.state=shortage?'shortage':player.inkDelayMs>0?'waiting':player.ink<player.maxInk?'recovering':'ready';
    $('inkRecovery').textContent=shortage?`부족 · 약 ${inkWait(player,cost).toFixed(1)}초`:player.inkDelayMs>0?`${(player.inkDelayMs/1000).toFixed(1)}초 뒤 회복`:player.ink<player.maxInk?`초당 +${player.inkRegen} 회복`:'가득 참';
    $('inkEstimate').textContent=cost?`예상 소모 ${cost.toFixed(1)}${shortage?` · ${cost.toFixed(1)} 필요`:''}`:`공격과 환경 그림에 함께 사용 · 회복 ${player.inkRegen}/초`;
    $('drawMode').textContent=environmentTarget?'관문 마법진':'한 획 마법';
    if(environmentTarget)$('strokeStatus').textContent=environmentFeedback||'원 한 바퀴 → 다섯 꼭짓점 별 → 놓기';
    $('cancelEnvironment').hidden=!environmentTarget;
    persistProgression();renderGrowth();
  }
  function drawGateTerrain(){for(const g of GATES){const state=world.gates[g.id],progress=state.open?clamp((world.clockMs-state.openedAtMs)/650,0,1):0;
    if(g.id==='door'){for(let y=0;y<CFG.world.height;y+=130){const end=Math.min(y+130,CFG.world.height),low=g.y-g.passage/2,high=g.y+g.passage/2,parts=state.open?[[y,Math.min(end,low)],[Math.max(y,high),end]]:[[y,end]];for(const [a,b]of parts){if(b<=a)continue;const dx=((y/130)%3-1)*4,pts=[[g.x-g.width/2,a],[g.x+g.width/2,a],[g.x+g.width/2+dx,b],[g.x-g.width/2,b]];sketchPolygon(pts,'#ddcfae',.85);sketchOutline(pts,1.5,'#b2a38a',.38);if(b-a>45)P.line(g.x-37,a+30,g.x+40,a+35,1,'#b4a88d',.25);}}}
    else{P.box(g.x,730,g.width,1460,'#aac5c6',.68);P.line(g.x-g.width/2,0,g.x-g.width/2,1460,2,'#91aaa2',.45);P.line(g.x+g.width/2,0,g.x+g.width/2,1460,2,'#91aaa2',.45);for(let y=80;y<1460;y+=125)P.line(g.x-39,y,g.x+36,y+7,1.2,'#83aaa9',.35);}
    if(state.open){P.box(g.x,g.y,g.width+8,g.passage,g.id==='door'?'#f3e8cf':'#dfc79e',progress);
      if(g.id==='door'){P.line(g.x-55,g.y+85,g.x-55,g.y-84,4,'#8ca599',progress);P.line(g.x-55,g.y-84,g.x+55,g.y-84,4,'#8ca599',progress);P.line(g.x+55,g.y-84,g.x+55,g.y+85,4,'#8ca599',progress);}
      else for(let x=g.x-60;x<=g.x+60;x+=20){P.box(x,g.y,17,g.passage-12,'#ceba94',progress);P.line(x-8,g.y-84,x-8,g.y+84,1.4,'#9c9279',progress*.5);}
      drawStroke(state.stroke,g.x,g.y,0,1,'#688d87',.25+(1-progress)*.5,2.4,progress);
      if(progress<1)P.ring(g.x,g.y,65+progress*30,'#729f92',(1-progress)*.5,2,24);
    }else{P.ring(g.x,g.y,68,regionCleared(g.region)?'#81a89a':'#b0ab94',.47,2,24);const seal=glyphReferences.paths.starcircle.map(([x,y])=>({x:x*80,y:y*80}));drawStroke(seal,g.x,g.y,0,1,'#8da391',.35,1.5);}
  }}
  function drawGateLabels(){for(const g of GATES){if(!visible(g.x,g.y,220))continue;renderer.worldToScreenInto(g.x,g.y-116,anchorReuse);txtCtx.textAlign='center';txtCtx.font='800 12px system-ui';txtCtx.lineWidth=4;txtCtx.strokeStyle='#fffaf0';const text=world.gates[g.id].open?g.name+' · 완성':g.name+' · '+(regionCleared(g.region)?'별+원 마법진':REGIONS[g.region].name+' 공략 필요');txtCtx.strokeText(text,anchorReuse.x,anchorReuse.y);txtCtx.fillStyle='#4f6e63';txtCtx.fillText(text,anchorReuse.x,anchorReuse.y);}}
  function drawEnvironmentGuide(){if(!environmentTarget)return;const g=gateOf(environmentTarget),points=glyphReferences.paths.starcircle.map(([x,y])=>{const s={x:0,y:0};renderer.worldToScreenInto(g.x+x*80,g.y+y*80,s);return s;});drawCtx.save();drawCtx.globalAlpha=.33;drawCtx.lineWidth=2;drawCtx.strokeStyle='#447d74';drawCtx.setLineDash([5,4]);drawCtx.beginPath();points.forEach((p,i)=>i?drawCtx.lineTo(p.x,p.y):drawCtx.moveTo(p.x,p.y));drawCtx.stroke();drawCtx.setLineDash([]);drawCtx.beginPath();drawCtx.arc(points[0].x,points[0].y,6,0,Math.PI*2);drawCtx.stroke();drawCtx.restore();}
