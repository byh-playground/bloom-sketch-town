  // Device collection: BLOOM GameKit createDOMInput + ActionState, one writer for commands.
  const ui={modal:null,returnFocus:null};
  const drawInput={pointer:null,points:[],length:0,finished:null,previewUntilMs:0};
  const sampleFromPointer=(o)=>({x:clamp(o.x,0,PW),y:clamp(o.y,0,PH)});
  function appendDrawPoint(p){const prev=drawInput.points.at(-1);if(prev){const d=hypot(p.x-prev.x,p.y-prev.y);if(d<1.25)return;drawInput.length+=d;}if(drawInput.points.length<1200)drawInput.points.push(p);}
  function setSlowUi(on){$('slowFx').classList.toggle('visible',on);$('slowIndicator').classList.toggle('visible',on);}
  function focusGameplay(){if(!ui.modal&&document.activeElement!==field)field.focus({preventScroll:true});}
  function dropDraw(){drawInput.pointer=null;drawInput.points.length=0;drawInput.length=0;gesture.drawId=null;setSlowUi(false);$('strokeStatus').textContent='획을 완성하면 자동 조준 공격';}
  function finishDraw(){const points=drawInput.points.slice(),length=drawInput.length;dropDraw();focusGameplay();if(points.length<3||length<16){showResult('조금 더 길게 한 획을 그려 주세요',1100);return;}
    gesture.lastCombatStroke=points.map(p=>({...p}));drawInput.finished=points;drawInput.previewUntilMs=performance.now()+400;
    try{const shot=makeShotData(points);world.commands.push({type:'cast',shot});wakeInputPreview();$('lastSpell').textContent=`${shot.name} · 피해 ${Math.round(shot.baseDamage*player.power)}`;$('strokeStatus').textContent=shot.kind==='normal'?'대표 그림과 유사도가 부족해 기본 탄환으로 발사':'성공! 그린 순서로 잉크가 완성돼요';
      if(shot.kind==='normal')showResult('일반 낙서 · 특수 그림 유사도 기준 미달',950);
    }catch(error){console.error(error);showResult('마법 분석 실패 · 다시 그려 보세요',950);}}
  const keyboardBindings={KeyW:'up',ArrowUp:'up',KeyA:'left',ArrowLeft:'left',KeyS:'down',ArrowDown:'down',KeyD:'right',ArrowRight:'right',Space:'dash',KeyE:'interact'};
  // Bounko movement: a battlefield press commits a direction immediately, even while drawing.
  // GameKit DOM input retains pointer capture; a release only ends the gesture, never delays the roll.
  const fieldInput=createDOMInput({target:field,state:actions,keys:keyboardBindings,pointerButtons:{0:'rollAim'},touchAction:'none',onPointer(e){
    if(ui.modal||e.type!=='down')return;
    const target={x:0,y:0};renderer.screenToWorldInto(e.x,e.y,target);queueRollTo(target.x,target.y);
  }});
  // Registered after the GameKit device listener, so the edge already belongs to ActionState.
  document.addEventListener('keydown',e=>{if(!e.repeat&&keyboardBindings[e.code]&&!ui.modal)wakeInputPreview();});
  const paintInput=createDOMInput({target:draw,state:actions,pointerButtons:{0:'paint'},touchAction:'none',onPointer(e){if(ui.modal)return;
    if(e.type==='down'&&drawInput.pointer===null){focusGameplay();drawInput.pointer=e.pointerId;drawInput.points=[];drawInput.length=0;gesture.drawId=e.pointerId;gesture.startMs=world.clockMs;setSlowUi(true);appendDrawPoint(sampleFromPointer(e));$('strokeStatus').textContent='그리는 중 · 손을 떼면 마법 사용';}
    else if(drawInput.pointer===e.pointerId&&e.type==='move'){appendDrawPoint(sampleFromPointer(e));}
    else if(drawInput.pointer===e.pointerId&&e.type==='up'){appendDrawPoint(sampleFromPointer(e));finishDraw();}
    else if(drawInput.pointer===e.pointerId&&e.type==='cancel'){dropDraw();}
  },onRelease(){dropDraw();}});
  $('soundButton').addEventListener('click',async()=>{audioOn=!audioOn;sound.setMuted(!audioOn);$('soundButton').setAttribute('aria-pressed',String(audioOn));$('soundButton').textContent=audioOn?'♪ 켬':'♪ 끔';if(audioOn){await sound.unlock();sfx('select');}});
  function showResult(message,durationMs=1250){if(resimulatingGame)return;const c=$('resultChip');c.textContent=message;c.classList.add('show');ui.resultUntil=performance.now()+durationMs;}
  function changeModal(name){const open=name==='training'||name==='help'||name==='multi';ui.modal=open?name:null;for(const id of ['trainingModal','helpModal','multiplayerModal'])$(id).classList.toggle('open',open&&id===(name==='training'?'trainingModal':name==='help'?'helpModal':'multiplayerModal'));
    if(open){fieldInput.releaseAll('modal');paintInput.releaseAll('modal');dropDraw();if(name==='training'){updateTrainingView();drawTrainingPad();}}
    else{drawInput.pointer=null;focusGameplay();}
    $('trainingButton').setAttribute('aria-expanded',String(name==='training'));$('helpButton').setAttribute('aria-expanded',String(name==='help'));
  }
  function applyRoute(){const route=location.hash.split('?')[0];changeModal(route==='#/training'?'training':route==='#/help'?'help':route==='#/multi'?'multi':null);if(loop)loop.resetTiming();}
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
  function renderDrawPad(){const show=drawInput.pointer!==null?drawInput.points:drawInput.previewUntilMs>performance.now()?drawInput.finished:null;strokePad(draw,drawCtx,PW,PH,drawDpr,show,samplePoints(selectedGlyph));}
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

