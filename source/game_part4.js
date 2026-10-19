  // Device collection: BLOOM GameKit createDOMInput + ActionState, one writer for commands.
  const ui={modal:null,returnFocus:null};
  const drawInput={pointer:null,points:[],length:0,finished:null,previewUntilMs:0,aim:0,center:null,origin:null,environmentTarget:null,environmentPoints:[]};
  const sampleFromPointer=o=>({x:clamp(o.x,0,vw),y:clamp(o.y,0,vh)});
  function appendDrawPoint(p){const prev=drawInput.points.at(-1);if(prev){const d=hypot(p.x-prev.x,p.y-prev.y);if(d<1.25)return;drawInput.length+=d;}if(drawInput.points.length<1200)drawInput.points.push(p);}
  function setSlowUi(on){on=on&&!mp.connected;$('slowFx').classList.toggle('visible',on);$('slowIndicator').classList.toggle('visible',on);}
  function focusGameplay(){if(!ui.modal&&document.activeElement!==field)field.focus({preventScroll:true});}
  function drawingAllowed(){return !ui.modal&&world.mode==='playing'&&player.hp>0&&!(player.koMs>0);}
  function displayedDrawingActor(){return renderViewCache.get(player)||player;}
  function updateDrawingAim(){
    if(!drawInput.points.length)return;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of drawInput.points){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
    const actor=displayedDrawingActor(),origin={x:0,y:0};renderer.worldToScreenInto(actor.x,actor.y,origin);
    const center={x:(minX+maxX)/2,y:(minY+maxY)/2},dx=center.x-origin.x,dy=center.y-origin.y;
    if(hypot(dx,dy)>=24)drawInput.aim=Math.atan2(dy,dx);
    drawInput.center=center;drawInput.origin=origin;
  }
  function dropDraw(keepEnvironment=false){if(!keepEnvironment){environmentTarget=null;environmentFeedback='';}drawInput.environmentPoints=[];drawInput.environmentTarget=null;drawInput.pointer=null;drawInput.points.length=0;drawInput.length=0;drawInput.finished=null;drawInput.previewUntilMs=0;drawInput.center=null;drawInput.origin=null;gesture.drawId=null;setSlowUi(false);$('strokeStatus').textContent='전장에 한 획 · 놓는 순간 방향 확정';}
  function finishDraw(){
    if(!drawingAllowed()){dropDraw();return;}
    updateDrawingAim();const points=drawInput.points.slice(),length=drawInput.length,aim=drawInput.aim,environment=drawInput.environmentTarget,envPoints=drawInput.environmentPoints.slice();dropDraw();focusGameplay();
    if(points.length<3||length<16){showResult('조금 더 길게 한 획을 그려 주세요',1100);return;}
    if(environment){const g=gateOf(environment),sampled=simplifyGateStroke(envPoints),result=magicCircleResult(sampled);environmentTarget=environment;if(!result.ok){environmentFeedback=result.reason;showResult(result.reason+' · 잉크 소비 없음',2400);return;}environmentFeedback='별과 둘레원 확인 · 완성 명령 처리 중';queueProgression({type:'gate',id:environment,points:sampled});drawInput.finished=points;drawInput.previewUntilMs=performance.now()+350;return;}
    gesture.lastCombatStroke=points.map(p=>({...p}));drawInput.finished=points;drawInput.previewUntilMs=performance.now()+220;
    try{const shot=normalizeCommand({type:'cast',shot:{...makeShotData(points),aim}}).shot;world.commands.push({type:'cast',shot});wakeInputPreview();$('lastSpell').textContent=`${shot.name} · 피해 ${Math.round(shot.baseDamage*player.power)}`;$('strokeStatus').textContent='방향 확정 · 마법 준비 중';
      if(shot.kind==='normal')showResult('일반 낙서 · 그린 방향으로 발사',950);
    }catch(error){console.error(error);showResult('마법 분석 실패 · 다시 그려 보세요',950);}}
  function collectCombatDrawing(e){
    if(e.type==='down'&&drawInput.pointer===null&&drawingAllowed()){
      focusGameplay();dropDraw(true);drawInput.pointer=e.pointerId;drawInput.environmentTarget=environmentTarget;gesture.drawId=e.pointerId;gesture.startMs=world.clockMs;
      const actor=displayedDrawingActor();drawInput.aim=Math.atan2(actor.faceY,actor.faceX);setSlowUi(true);appendEnvironmentPoint(e);appendDrawPoint(sampleFromPointer(e));updateDrawingAim();environmentFeedback='';$('strokeStatus').textContent=environmentTarget?'둘레원 한 바퀴 → 다섯 꼭짓점 별':'이동으로 조준 · 놓으면 발사';
    }else if(drawInput.pointer===e.pointerId){
      if(!drawingAllowed()||e.type==='cancel'){dropDraw();return;}
      if(e.type==='move'||e.type==='up'){appendEnvironmentPoint(e);appendDrawPoint(sampleFromPointer(e));updateDrawingAim();if(e.type==='up')finishDraw();}
    }
  }
  function appendEnvironmentPoint(e){const target=drawInput.pointer!==null?drawInput.environmentTarget:environmentTarget;if(!target)return;const g=gateOf(target),p={x:0,y:0};renderer.screenToWorldInto(e.x,e.y,p);drawInput.environmentPoints.push({x:+(p.x-g.x).toFixed(2),y:+(p.y-g.y).toFixed(2)});}
  const keyboardBindings={KeyW:'up',ArrowUp:'up',KeyA:'left',ArrowLeft:'left',KeyS:'down',ArrowDown:'down',KeyD:'right',ArrowRight:'right',Space:'dash'};
  // A single captured battlefield pointer owns ink. UI/stick pointers never enter this target.
  const fieldInput=createDOMInput({target:field,state:actions,keys:keyboardBindings,pointerButtons:{0:'paint'},touchAction:'none',onPointer:collectCombatDrawing,onRelease:dropDraw});
  // Registered after the GameKit device listener, so the edge already belongs to ActionState.
  for(const type of ['keydown','keyup'])document.addEventListener(type,e=>{if(!e.repeat&&keyboardBindings[e.code]&&!ui.modal)wakeInputPreview();});
  // Environment mode is a local input choice, available before the next 30TPS boundary.
  // Only its completed gate command is authoritative and consumes ink.
  document.addEventListener('keydown',e=>{if(e.code==='KeyE'&&!e.repeat&&!ui.modal&&!e.target.closest('input,textarea,select,button')){e.preventDefault();armEnvironment();}});
  const movementStick={pointer:null,x:0,y:0};
  function resetMovementStick(){movementStick.pointer=null;movementStick.x=movementStick.y=0;$('moveKnob').style.transform='translate(0px,0px)';}
  const stickInput=createDOMInput({target:$('moveStick'),state:actions,pointerButtons:{0:'moveStick'},excludeTarget:false,touchAction:'none',onPointer(e){
    if(ui.modal)return;
    if(e.type==='down'&&movementStick.pointer===null){movementStick.pointer=e.pointerId;focusGameplay();}
    if(e.pointerId!==movementStick.pointer)return;
    if(e.type==='up'||e.type==='cancel')resetMovementStick();
    else{const size=$('moveStick').getBoundingClientRect().width,dx=e.x-size/2,dy=e.y-size/2,length=hypot(dx,dy),radius=size*.34;
      movementStick.x=length>size*.12?dx/length:0;movementStick.y=length>size*.12?dy/length:0;
      const scale=Math.min(1,radius/Math.max(1,length));$('moveKnob').style.transform=`translate(${dx*scale}px,${dy*scale}px)`;}
    wakeInputPreview();
  },onRelease(){resetMovementStick();wakeInputPreview();}});
  const rollButtonInput=createDOMInput({target:$('rollButton'),state:actions,pointerButtons:{0:'dash'},excludeTarget:false,touchAction:'none',onPointer(e){if(e.type==='down'){focusGameplay();wakeInputPreview();}}});
  $('rollButton').addEventListener('click',e=>{if(e.detail===0){actions.pulse('dash');wakeInputPreview();}});
  $('soundButton').addEventListener('click',async()=>{audioOn=!audioOn;sound.setMuted(!audioOn);$('soundButton').setAttribute('aria-pressed',String(audioOn));$('soundButton').textContent=audioOn?'♪ 켬':'♪ 끔';if(audioOn){await sound.unlock();sfx('select');}});
  function showResult(message,durationMs=1250){if(resimulatingGame)return;const c=$('resultChip');c.textContent=message;c.classList.add('show');ui.resultUntil=performance.now()+durationMs;}
  function changeModal(name){const open=name==='training'||name==='help'||name==='multi'||name==='growth';ui.modal=open?name:null;for(const id of ['trainingModal','helpModal','multiplayerModal','growthModal'])$(id).classList.toggle('open',open&&id===(name==='training'?'trainingModal':name==='help'?'helpModal':name==='growth'?'growthModal':'multiplayerModal'));
    if(open){fieldInput.releaseAll('modal');stickInput.releaseAll('modal');rollButtonInput.releaseAll('modal');dropDraw();if(name==='training'){updateTrainingView();drawTrainingPad();}}
    else{drawInput.pointer=null;focusGameplay();}
    if(name==='growth')renderGrowth();
    $('trainingButton').setAttribute('aria-expanded',String(name==='training'));$('helpButton').setAttribute('aria-expanded',String(name==='help'));
  }
  function applyRoute(){const route=location.hash.split('?')[0];if(route==='#/growth'){const params=new URLSearchParams(location.hash.split('?')[1]||'');const tab=params.get('tab'),item=params.get('item');if(['ink','combat','explore'].includes(tab))growthTab=tab;if(item&&(STAT_DEFS.some(s=>s.id===item&&s.group===growthTab)||growthTab==='explore'&&['forest','door','marsh','bridge','quarry'].includes(item)))growthSelected=item;else growthSelected=growthTab==='explore'?'forest':STAT_DEFS.find(s=>s.group===growthTab).id;}changeModal(route==='#/training'?'training':route==='#/help'?'help':route==='#/multi'?'multi':route==='#/growth'?'growth':null);if(loop)loop.resetTiming();}
  function goRoute(name){const url=name?`#/${name}`:'#/play';if(location.hash===url){applyRoute();return;}location.hash=url;}
  $('multiplayerButton').addEventListener('click',()=>goRoute('multi'));
  $('trainingButton').addEventListener('click',()=>goRoute('training'));
  $('helpButton').addEventListener('click',()=>goRoute('help'));
  for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>goRoute('play'));
  document.querySelectorAll('.modal').forEach(node=>node.addEventListener('pointerdown',e=>{if(e.target===node)goRoute('play');}));
  document.addEventListener('keydown',e=>{if(e.code==='Escape'&&ui.modal){e.preventDefault();goRoute('play');}});
  window.addEventListener('hashchange',applyRoute);

  function strokePad(canvas,context,w,h,ratio,points,guide){context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,w,h);context.save();context.lineJoin='round';context.lineCap='round';if(guide&&guide.length>1){context.setLineDash([4,6]);context.lineWidth=2.3;context.strokeStyle='#d4b78e';context.globalAlpha=points?.length?.18:.48;context.beginPath();guide.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.stroke();context.setLineDash([]);}
    context.lineWidth=1;context.strokeStyle='#eadcc8';context.beginPath();context.moveTo(w*.5,h*.17);context.lineTo(w*.5,h*.83);context.moveTo(w*.17,h*.5);context.lineTo(w*.83,h*.5);context.stroke();
    if(points?.length>1){context.lineWidth=4.4;context.strokeStyle='#34484e';context.beginPath();points.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.stroke();context.lineWidth=1.4;context.strokeStyle='#fff7dd';context.stroke();const end=points.at(-1);context.beginPath();context.arc(end.x,end.y,4.2,0,Math.PI*2);context.fillStyle='#d9a057';context.fill();}context.restore();}
  function renderDrawPad(){
    if(drawInput.pointer!==null&&!drawingAllowed())dropDraw();
    if(drawInput.pointer!==null)updateDrawingAim();
    const points=drawInput.pointer!==null?drawInput.points:drawInput.previewUntilMs>performance.now()?drawInput.finished:null;
    drawCtx.setTransform(drawDpr,0,0,drawDpr,0,0);drawCtx.clearRect(0,0,vw,vh);drawEnvironmentGuide();if(!points?.length)return;
    drawCtx.save();drawCtx.lineCap='round';drawCtx.lineJoin='round';
    if(drawInput.pointer!==null&&drawInput.origin&&!(drawInput.pointer!==null?drawInput.environmentTarget:environmentTarget)){
      const o=drawInput.origin,c=drawInput.center,a=drawInput.aim,tip={x:o.x+Math.cos(a)*88,y:o.y+Math.sin(a)*88};
      drawCtx.strokeStyle='#315f68';drawCtx.lineWidth=2;drawCtx.setLineDash([5,5]);drawCtx.beginPath();drawCtx.moveTo(o.x,o.y);drawCtx.lineTo(c.x,c.y);drawCtx.stroke();drawCtx.setLineDash([]);
      drawCtx.beginPath();drawCtx.moveTo(o.x,o.y);drawCtx.lineTo(tip.x,tip.y);drawCtx.moveTo(tip.x-12*Math.cos(a-.5),tip.y-12*Math.sin(a-.5));drawCtx.lineTo(tip.x,tip.y);drawCtx.lineTo(tip.x-12*Math.cos(a+.5),tip.y-12*Math.sin(a+.5));drawCtx.stroke();
      drawCtx.beginPath();drawCtx.arc(c.x,c.y,6,0,Math.PI*2);drawCtx.stroke();
    }
    drawCtx.beginPath();points.forEach((p,i)=>i?drawCtx.lineTo(p.x,p.y):drawCtx.moveTo(p.x,p.y));drawCtx.lineWidth=6;drawCtx.strokeStyle='#fff7dd';drawCtx.stroke();drawCtx.lineWidth=3.5;drawCtx.strokeStyle='#34484e';drawCtx.stroke();drawCtx.restore();
  }
  function updateTrainingView(){const g=$('datasetGallery');const n=dataset.entries.length;g.innerHTML=n?dataset.entries.slice(-45).map((entry,i)=>{const points=normalizeStroke(entry.points,64),d=points.map((p,j)=>(j?'L':'M')+(42+p.x*24).toFixed(1)+' '+(39+p.y*24).toFixed(1)).join(' ');return `<div class="sample-thumb"><svg viewBox="0 0 84 78"><path d="${d}"/></svg><b>${shapeNames[entry.label]}</b></div>`;}).join(''):'<div style="grid-column:1/-1;color:#7b877e;font-size:12px;padding:10px">아직 수집한 그림이 없어요. 한 획씩 그려 주세요.</div>';
    $('trainingCount').textContent=`원본 ${n}개 · 증강은 별도 학습 과정에서만 · 라벨 ${new Set(dataset.entries.map(e=>e.label)).size}종`;
    $('deleteLast').disabled=n===0;$('clearSamples').disabled=n===0;$('exportSheet').disabled=n===0;
    previewDataset();}
  const dataset={entries:[],nextId:1};
  const storageKey='sketch-town-training-v2';
  function storeDataset(){try{localStorage.setItem(storageKey,JSON.stringify({version:2,entries:dataset.entries,nextId:dataset.nextId}));return true;}catch{return false;}}
  function loadDataset(){try{const data=JSON.parse(localStorage.getItem(storageKey)||'null');if(data?.version===2&&Array.isArray(data.entries)){
    dataset.entries=data.entries.filter(e=>glyphKinds.includes(e.label)&&Array.isArray(e.points)&&e.points.length>=3).slice(-500);
    dataset.nextId=Math.max(1,...dataset.entries.map(e=>e.id+1));}}catch{}}
  function trainingFlags(){const vertical=$('keepVertical').checked;return {mirrorX:$('allowMirrorX').checked,mirrorY:!vertical&&$('allowMirrorY').checked,rotate180:!vertical&&$('allowRotate180').checked,reverse:$('allowReverse').checked,vertical};}
  function refreshFlagInputs(){const locked=$('keepVertical').checked;for(const id of ['allowMirrorY','allowRotate180'])$(id).disabled=locked;}
  $('keepVertical').addEventListener('change',refreshFlagInputs);refreshFlagInputs();
  function addSample(raw,source='training'){
    if(raw.length<3)return;
    const label=$('trainingLabel').value,flags=trainingFlags();
    if(!glyphKinds.includes(label)||dataset.entries.length>=500){showResult('원본은 최대 500획까지 모을 수 있습니다',1400);return;}
    // Original normalized stroke ONLY. No flipping/jitter/rotation or derived image is exported.
    dataset.entries.push({id:dataset.nextId++,label,flags,points:normalizeStroke(raw,64),origin:source});
    storeDataset();$('trainingLast').textContent=`✓ ${shapeNames[label]} 원본 추가 · 허용 규칙 저장 · 현재 ${dataset.entries.length}획`;
    updateTrainingView();sfx('select');
  }
  const train={pointer:null,points:[],length:0};
  function appendTrainPoint(p){const prev=train.points.at(-1);if(prev){const len=hypot(p.x-prev.x,p.y-prev.y);if(len<1.2)return;train.length+=len;}if(train.points.length<1200)train.points.push(p);}
  function releaseTrain(){train.pointer=null;train.points.length=0;train.length=0;$('trainingHint').style.display='grid';}
  const trainingInput=createDOMInput({target:trainingPad,state:actions,pointerButtons:{0:'trainingDraw'},touchAction:'none',onPointer(e){if(ui.modal!=='training')return;
    if(e.type==='down'&&train.pointer===null){train.pointer=e.pointerId;train.points=[];train.length=0;appendTrainPoint({x:clamp(e.x,0,tw),y:clamp(e.y,0,th)});$('trainingHint').style.display='none';}
    else if(train.pointer===e.pointerId&&(e.type==='move'||e.type==='up')){appendTrainPoint({x:clamp(e.x,0,tw),y:clamp(e.y,0,th)});if(e.type==='up'){const path=train.points.slice(),distance=train.length;releaseTrain();if(distance<15||path.length<3){$('trainingLast').textContent='조금 더 긴 그림을 그려 주세요.';return;}addSample(path);}}
    else if(train.pointer===e.pointerId&&e.type==='cancel')releaseTrain();},onRelease:releaseTrain});
  function drawTrainingPad(){if(ui.modal!=='training')return;strokePad(trainingPad,trainingCtx,tw,th,trainingDpr,train.pointer!==null?train.points:null,null);}
  $('importCombat').addEventListener('click',()=>{if(!gesture.lastCombatStroke){$('trainingLast').textContent='먼저 게임에서 마법을 한 획 그려 주세요.';return;}addSample(gesture.lastCombatStroke,'combat');});
  $('deleteLast').addEventListener('click',()=>{dataset.entries.pop();storeDataset();updateTrainingView();});
  $('clearSamples').addEventListener('click',()=>{if(!dataset.entries.length)return;if(!confirm('모든 학습 샘플을 비울까요? 내보내지 않은 획은 복구할 수 없습니다.'))return;dataset.entries.length=0;storeDataset();updateTrainingView();});
  // Data images are grouped by class and stored with a canonical metadata payload.
  function drawSheetTile(ctx,points,x,y,size){ctx.fillStyle='#fff';ctx.fillRect(x,y,size,size);ctx.strokeStyle='#e7e1da';ctx.lineWidth=1;ctx.strokeRect(x+.5,y+.5,size-1,size-1);ctx.strokeStyle='#152127';ctx.lineWidth=2.4;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();points.forEach((p,i)=>{const px=x+size/2+p.x*size*.32,py=y+size/2+p.y*size*.32;i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.stroke();}
  function makeSheet(){const classes=glyphKinds,by=new Map(classes.map(label=>[label,[]]));for(const entry of dataset.entries)by.get(entry.label).push(entry);const columns=12,tile=64,gap=5,pad=18,groupHead=27,sectionSpace=13,header=61;
    const groups=classes.map(label=>({label,items:by.get(label)})).filter(g=>g.items.length);
    const width=pad*2+columns*tile+(columns-1)*gap;let height=header+pad;for(const group of groups)height+=groupHead+Math.ceil(group.items.length/columns)*(tile+gap)+sectionSpace;
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.min(31000,height);if(height>31000)throw new Error('이미지 최대 높이를 초과했습니다.');const ctx=canvas.getContext('2d');ctx.fillStyle='#faf8f4';ctx.fillRect(0,0,width,height);
    ctx.fillStyle='#25333d';ctx.font='900 23px system-ui';ctx.fillText('SKETCH TOWN · TRAINING SHEET',pad,30);ctx.fillStyle='#64747a';ctx.font='700 12px system-ui';ctx.fillText(`${dataset.entries.length} ORIGINAL strokes · NO augmentation · metadata embedded in PNG`,pad,49);
    let y=header;for(const group of groups){ctx.fillStyle='#45545b';ctx.font='900 16px system-ui';ctx.fillText(`${shapeNames[group.label]}  /  ${group.label}  · ${group.items.length}`,pad,y+17);y+=groupHead;
      group.items.forEach((entry,index)=>{const col=index%columns,row=Math.floor(index/columns);drawSheetTile(ctx,entry.points,pad+col*(tile+gap),y+row*(tile+gap),tile);});y+=Math.ceil(group.items.length/columns)*(tile+gap)+sectionSpace;}
    return canvas;}
  function previewDataset(){const can=$('sheetPreview'),ctx=can.getContext('2d'),bounds=can.getBoundingClientRect(),w=Math.max(260,bounds.width),h=Math.max(90,bounds.height),d=Math.min(devicePixelRatio||1,2);can.width=Math.floor(w*d);can.height=Math.floor(h*d);ctx.setTransform(d,0,0,d,0,0);ctx.fillStyle='#fffdf8';ctx.fillRect(0,0,w,h);
    const sample=[];for(const entry of dataset.entries.slice(-7))sample.push({label:entry.label,points:entry.points});if(!sample.length){ctx.fillStyle='#8b9189';ctx.font='700 12px system-ui';ctx.textAlign='center';ctx.fillText('수집한 그림이 여기에 표시됩니다',w/2,h/2);ctx.textAlign='start';return;}
    const tile=Math.min(68,(w-20)/Math.min(sample.length,7)-5);for(let i=0;i<sample.length;i++){const item=sample[i],x=9+i*(tile+5),y=9;drawSheetTile(ctx,item.points,x,y,tile);ctx.fillStyle='#73817c';ctx.textAlign='center';ctx.font='700 9px system-ui';ctx.fillText(shapeNames[item.label],x+tile/2,y+tile+12);}ctx.textAlign='start';}
  const CRC_TABLE=(()=>{const out=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;out[i]=c>>>0;}return out;})();
  function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=CRC_TABLE[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
  function putU32(out,i,n){out[i]=(n>>>24)&255;out[i+1]=(n>>>16)&255;out[i+2]=(n>>>8)&255;out[i+3]=n&255;}
  function addPngMetadata(pngBytes,info){const encoder=new TextEncoder(),key=encoder.encode('SketchTownDataset'),value=encoder.encode(JSON.stringify(info)),data=new Uint8Array(key.length+1+value.length);data.set(key);data[key.length]=0;data.set(value,key.length+1);
    const chunk=new Uint8Array(data.length+12);putU32(chunk,0,data.length);chunk.set([116,69,88,116],4);chunk.set(data,8);putU32(chunk,8+data.length,crc32(chunk.subarray(4,8+data.length)));
    // PNG signature + IHDR chunk (25 bytes) = 33 bytes. Keep chunk boundaries valid.
    const merged=new Uint8Array(pngBytes.length+chunk.length);merged.set(pngBytes.subarray(0,33));merged.set(chunk,33);merged.set(pngBytes.subarray(33),33+chunk.length);return merged;}
  async function exportSheet(){if(!dataset.entries.length)return;const btn=$('exportSheet');btn.disabled=true;btn.textContent='PNG 생성 중…';
    try{const sheet=makeSheet(),blob=await new Promise((resolve,reject)=>sheet.toBlob(b=>b?resolve(b):reject(new Error('Canvas PNG 직렬화 실패')),'image/png'));
      const info={format:'SketchTownDataset',version:2,classes:glyphKinds,source:'original one-stroke only',count:dataset.entries.length,entries:dataset.entries};
      const png=addPngMetadata(new Uint8Array(await blob.arrayBuffer()),info);const url=URL.createObjectURL(new Blob([png],{type:'image/png'})),a=document.createElement('a');a.href=url;a.download=`SketchTown_Original_${dataset.entries.length}strokes.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2500);$('trainingLast').textContent=`완료: PNG 한 장 · 원본 ${dataset.entries.length}개 + 대칭 허용 메타데이터만 저장`;
    }catch(e){console.error(e);$('trainingLast').textContent=`익스포트 실패: ${e.message}`;}
    finally{btn.disabled=!dataset.entries.length;btn.textContent='한 장의 PNG 내보내기';}}
  $('exportSheet').addEventListener('click',exportSheet);
  loadDataset();updateTrainingView();

