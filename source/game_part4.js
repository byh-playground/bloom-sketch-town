  // Device collection: BLOOM GameKit createDOMInput + ActionState, one writer for commands.
  const ui={modal:null,returnFocus:null};
  const drawInput={pointer:null,points:[],length:0,finished:null,previewUntilMs:0,world:{x:0,y:0},center:null,origin:null};
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
    // The summon appears where the drawing's bounding-box center lies on the map (no direction or distance limit).
    const center={x:(minX+maxX)/2,y:(minY+maxY)/2};
    drawInput.center=center;renderer.screenToWorldInto(center.x,center.y,drawInput.world);
  }
  function dropDraw(){drawInput.pointer=null;drawInput.points.length=0;drawInput.length=0;drawInput.finished=null;drawInput.previewUntilMs=0;drawInput.center=null;gesture.drawId=null;setSlowUi(false);$('strokeStatus').textContent='원하는 자리에 한 획 · 그 자리에 소환';}
  // Two-step summon: the body stroke is recognized first, then the face is drawn (any number of strokes, any place).
  // A face cannot be drawn in one stroke, so the player ends the step with a button (or Enter). Nothing is sent to the
  // simulation or paid for until then; cancelling, a modal, death or 15 s without input leaves the ink untouched.
  const FACE_CANCEL_MS=15000,FACE_MAX_STROKES=12;
  let lastFaceResult=null;
  const summonDraft={active:false,shot:null,body:null,center:null,strokes:[],lastActivityMs:0,live:null,liveSig:'',liveMs:0};
  function showFaceStep(on){$('faceBar').hidden=!on;$('faceDone').textContent='✓ 소환';}
  // Live "afterimage" recognition: while a body or face is being drawn, the best-matching reference is shown as a faint ghost
  // laid over the drawing. Faces cost ~0.3 ms per call; the body classifier ~7 ms (CPU, unoptimized container), so both are throttled.
  const LIVE_FACE_MS=100,LIVE_BODY_MS=160;
  const liveBody={sig:'',ms:0,result:null};
  function liveFaceStrokes(){const s=summonDraft.strokes.slice();if(drawInput.pointer!==null&&drawInput.points.length>1)s.push(drawInput.points);return s;}
  function updateLiveFace(force=false){
    if(!summonDraft.active)return;
    const strokes=liveFaceStrokes(),sig=strokes.length+':'+strokes.reduce((n,s)=>n+s.length,0),now=performance.now();
    if(!force&&(sig===summonDraft.liveSig||now-summonDraft.liveMs<LIVE_FACE_MS))return;
    summonDraft.liveSig=sig;summonDraft.liveMs=now;
    summonDraft.live=strokes.length?faceRecognizer.recognize(strokes):null;
    const live=summonDraft.live,name=!live?'':live.accepted?expressionOf(live.id).name:'무표정';
    $('faceDone').textContent=name?`✓ 소환 · ${name}`:'✓ 소환';
  }
  function updateLiveBody(){
    if(drawInput.pointer===null||summonDraft.active){liveBody.result=null;liveBody.sig='';return;}
    const pts=drawInput.points,sig=pts.length+':'+Math.round(drawInput.length),now=performance.now();
    if(pts.length<8||drawInput.length<48){liveBody.result=null;return;}
    if(sig===liveBody.sig||now-liveBody.ms<LIVE_BODY_MS)return;
    liveBody.sig=sig;liveBody.ms=now;
    try{const shot=makeShotData(pts),top=shot.reference.topClass;
      liveBody.result={top:glyphReferences.paths[top]?top:null,accepted:shot.reference.approval.accepted};}catch(e){liveBody.result=null;}
  }
  // Draws reference strokes (unit coordinates) over a screen box, faint and dashed.
  function paintGhost(unitStrokes,box,alpha,label){
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const s of unitStrokes)for(const [x,y] of s){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    const gw=Math.max(.001,maxX-minX),gh=Math.max(.001,maxY-minY),target=Math.max(box.w,box.h,80),k=target/Math.max(gw,gh),cx=box.x+box.w/2,cy=box.y+box.h/2,mx=(minX+maxX)/2,my=(minY+maxY)/2;
    const map=([x,y])=>[cx+(x-mx)*k,cy+(y-my)*k];
    drawCtx.save();drawCtx.globalAlpha=alpha;drawCtx.strokeStyle='#2f7f87';drawCtx.fillStyle='#2f7f87';drawCtx.lineWidth=3;drawCtx.setLineDash([7,6]);
    for(const s of unitStrokes){
      if(s.length===1){const [x,y]=map(s[0]);drawCtx.beginPath();drawCtx.arc(x,y,4.5,0,Math.PI*2);drawCtx.fill();continue;}
      drawCtx.beginPath();s.forEach((q,i)=>{const [x,y]=map(q);i?drawCtx.lineTo(x,y):drawCtx.moveTo(x,y);});drawCtx.stroke();
    }
    drawCtx.setLineDash([]);
    if(label){drawCtx.globalAlpha=Math.min(1,alpha*2.2);drawCtx.font='700 12px sans-serif';drawCtx.textAlign='center';drawCtx.lineWidth=4;drawCtx.strokeStyle='#fffaf0';drawCtx.strokeText(label,cx,cy-target/2-8);drawCtx.fillText(label,cx,cy-target/2-8);}
    drawCtx.restore();
  }
  function strokesBox(strokes){
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const s of strokes)for(const p of s){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
    return minX===Infinity?null:{x:minX,y:minY,w:maxX-minX,h:maxY-minY};
  }
  function paintLiveGhost(){
    if(summonDraft.active){
      const live=summonDraft.live,strokes=liveFaceStrokes(),box=strokesBox(strokes);
      if(live&&live.candidate&&box){const e=expressionOf(live.candidate);paintGhost(e.guide,box,live.accepted?.5:.22,live.accepted?e.name:'');}
    }else if(liveBody.result?.top&&drawInput.points.length>1){
      const box=strokesBox([drawInput.points]),kind=liveBody.result.top;
      paintGhost([glyphReferences.paths[kind]],box,liveBody.result.accepted?.5:.22,liveBody.result.accepted?`${shapeNames[kind]} · ${summonSpecOf(kind).name}`:'');
    }
  }
  function cancelSummonDraft(message){
    const was=summonDraft.active;
    Object.assign(summonDraft,{active:false,shot:null,body:null,center:null,strokes:[],live:null,liveSig:''});showFaceStep(false);
    if(was&&message){showResult(message,1600);$('strokeStatus').textContent='원하는 자리에 한 획 · 그 자리에 소환';}
  }
  // Merge selection: a tap on one of your summons toggles it; a recognized star while two or three are selected merges them.
  // Selection is presentation state only; the sim receives a 'merge' command with the ids.
  const selectedUnits=new Set();
  function ownSummons(){const id=actorId(player);return world.summons.filter(s=>s.owner===id&&s.hp>0);}
  function pruneSelection(){const alive=new Set(ownSummons().map(s=>s.id));for(const id of selectedUnits)if(!alive.has(id))selectedUnits.delete(id);}
  function toggleUnitAt(at){
    let best=null,bestD=Infinity;
    for(const s of ownSummons()){const d=hypot(s.x-at.x,s.y-at.y);if(d<=s.r*1.35+18&&d<bestD){best=s;bestD=d;}}
    if(!best)return false;
    if(selectedUnits.has(best.id))selectedUnits.delete(best.id);
    else if(selectedUnits.size>=3)showResult('합체 재료는 최대 3마리예요',1300);
    else selectedUnits.add(best.id);
    return true;
  }
  $('selectClear').addEventListener('click',()=>selectedUnits.clear());
  function requestMerge(){
    pruneSelection();
    if(selectedUnits.size<2){showResult('합체할 소환수를 2~3마리 눌러 고르세요',1400);return;}
    world.commands.push({type:'merge',ids:[...selectedUnits]});wakeInputPreview();
  }
  function updateSelectionChip(){
    pruneSelection();const chip=$('selectChip'),n=selectedUnits.size;chip.hidden=n===0;if(!n)return;
    const units=[...selectedUnits].map(summonById).filter(Boolean),plan=units.length>=2?planMerge(units):null;
    const text=plan?`선택 ${n} → ${summonSpecOf(plan.kind).name}${plan.type==='tier'?` ${plan.tier}단계`:''} · ★ 그리면 합체`:n<2?'선택 1 · 소환수를 더 눌러 보세요':`선택 ${n} · 합체할 수 없는 조합`;
    if($('selectText').textContent!==text)$('selectText').textContent=text;
  }
  // Run end panel: shown when the run is over (defeat) or cleared; a new run is a fresh page load (state is per run).
  let runEndSig='';
  function updateRunEndPanel(){
    const over=world.mode==='over'||world.mode==='clear',sig=over?world.mode:'';if(sig===runEndSig)return;runEndSig=sig;
    $('runEnd').hidden=!over;if(!over)return;
    const total=Math.floor(world.clockMs/1000),time=`${Math.floor(total/60)}분 ${String(total%60).padStart(2,'0')}초`;
    $('runEndTitle').textContent=world.mode==='clear'?'스케치 타운을 되찾았다!':'먹물이 번졌다…';
    $('runEndStats').textContent=`보스 ${world.bossesDefeated}/${BOSS_PROFILES.length} · 처치 ${world.kills} · 해금 도형 ${world.unlocked.length-3}개 · ${time}`;
    $('runRestart').focus({preventScroll:true});
  }
  $('runRestart').addEventListener('click',()=>location.reload());
  // Boss reward panel: rendered from canonical world.reward; choosing queues the same command path as every other input.
  let rewardSig='';
  function updateRewardPanel(){
    const sig=world.reward?world.reward.choices.join(','):'';if(sig===rewardSig)return;rewardSig=sig;
    const panel=$('rewardPanel'),box=$('rewardChoices');box.innerHTML='';panel.hidden=!sig;if(!sig)return;
    for(const kind of world.reward.choices){const spec=summonSpecOf(kind),b=document.createElement('button');b.type='button';b.dataset.kind=kind;
      b.innerHTML=`${shapeSvg(kind)}<b>${spec.name}</b><small>${spec.role}</small>`;
      b.addEventListener('click',()=>{world.commands.push({type:'unlock',kind});wakeInputPreview();});box.appendChild(b);}
  }
  function beginSummonDraft(shot,bodyPoints,center){
    Object.assign(summonDraft,{active:true,shot,body:bodyPoints.map(p=>({...p})),center:{...center},strokes:[],lastActivityMs:performance.now()});
    showFaceStep(true);
    $('lastSpell').textContent=`${shot.name} · 표정을 그려 주세요`;$('strokeStatus').textContent='도감처럼 눈·입을 그리고 ✓ 소환을 누르세요';
    showResult(`${shot.name} 인식 · 표정을 그리고 ✓ 소환`,2400);
  }
  function addFaceStroke(points){
    if(!points.length)return;
    if(summonDraft.strokes.length>=FACE_MAX_STROKES){showResult(`표정은 ${FACE_MAX_STROKES}획까지예요 · ✓ 소환을 눌러 주세요`,1400);return;}
    summonDraft.strokes.push(points.map(p=>({x:p.x,y:p.y})));summonDraft.lastActivityMs=performance.now();updateLiveFace(true);
    $('strokeStatus').textContent=`표정 ${summonDraft.strokes.length}획 · 다 그렸으면 ✓ 소환`;
  }
  function commitSummon(){
    if(!summonDraft.active)return;
    if(!summonDraft.strokes.length){summonDraft.lastActivityMs=performance.now();showResult('표정을 먼저 그려 주세요 · 눈과 입',1400);return;}
    const result=faceRecognizer.recognize(summonDraft.strokes),face=expressionOf(result.id),shot={...summonDraft.shot,face:face.id},drew=true;
    cancelSummonDraft();
    world.commands.push({type:'cast',shot});wakeInputPreview();
    lastFaceResult={id:face.id,confidence:result.confidence,accepted:result.accepted,strokes:drew};
    $('lastSpell').textContent=`${shot.name} · ${face.name}`;$('strokeStatus').textContent='소환 준비 중';
    showResult(result.accepted?`${shot.name} · ${face.name} · ${face.temperament.summary()}`:`${shot.name} · 어떤 표정과도 맞지 않아 무표정(ㅡㅡ) · 특성 없음`,2600);
  }
  function tickSummonDraft(){
    if(!summonDraft.active)return;
    if(!drawingAllowed()){cancelSummonDraft();return;}
    if(drawInput.pointer===null&&performance.now()-summonDraft.lastActivityMs>FACE_CANCEL_MS)cancelSummonDraft('표정 입력 시간이 지나 취소 · 잉크 소모 없음');
  }
  $('faceDone').addEventListener('click',()=>commitSummon());
  $('faceCancel').addEventListener('click',()=>cancelSummonDraft('소환 취소 · 잉크 소모 없음'));
  document.addEventListener('keydown',e=>{
    if(!summonDraft.active||e.repeat)return;
    if(e.code==='Enter'||e.code==='NumpadEnter'){e.preventDefault();commitSummon();}
    else if(e.code==='Escape'){e.preventDefault();cancelSummonDraft('소환 취소 · 잉크 소모 없음');}
  });
  function finishDraw(){
    if(!drawingAllowed()){dropDraw();cancelSummonDraft();return;}
    updateDrawingAim();const points=drawInput.points.slice(),length=drawInput.length,at={x:drawInput.world.x,y:drawInput.world.y},center=drawInput.center;dropDraw();focusGameplay();
    if(summonDraft.active){addFaceStroke(points);return;}
    if(length<16){if(toggleUnitAt(at))return;}
    if(points.length<3||length<16){showResult('조금 더 길게 한 획을 그려 주세요',1100);return;}
    gesture.lastCombatStroke=points.map(p=>({...p}));
    try{
      const shot=normalizeCommand({type:'cast',shot:{...makeShotData(points),x:at.x,y:at.y,face:'neutral'}}).shot,cost=spellInkCost(player,shot);
      if(shot.kind==='star'&&selectedUnits.size>=2){requestMerge();return;}
      if(shot.kind==='line'){world.commands.push({type:'cast',shot});wakeInputPreview();$('lastSpell').textContent='선 · 투사체';return;}
      beginSummonDraft(shot,points,center);
    }catch(error){console.error(error);showResult('소환 분석 실패 · 다시 그려 보세요',950);}}
  function collectCombatDrawing(e){
    if(e.type==='down'&&drawInput.pointer===null&&drawingAllowed()){
      focusGameplay();dropDraw();drawInput.pointer=e.pointerId;gesture.drawId=e.pointerId;gesture.startMs=world.clockMs;
      setSlowUi(true);appendDrawPoint(sampleFromPointer(e));updateDrawingAim();$('strokeStatus').textContent='놓은 자리에 소환';
    }else if(drawInput.pointer===e.pointerId){
      if(!drawingAllowed()||e.type==='cancel'){dropDraw();return;}
      if(e.type==='move'||e.type==='up'){appendDrawPoint(sampleFromPointer(e));updateDrawingAim();if(e.type==='up')finishDraw();}
    }
  }
  const keyboardBindings={KeyW:'up',ArrowUp:'up',KeyA:'left',ArrowLeft:'left',KeyS:'down',ArrowDown:'down',KeyD:'right',ArrowRight:'right',Space:'dash'};
  // A single captured battlefield pointer owns ink. UI/stick pointers never enter this target.
  const fieldInput=createDOMInput({target:field,state:actions,keys:keyboardBindings,pointerButtons:{0:'paint'},touchAction:'none',onPointer:collectCombatDrawing,onRelease:dropDraw});
  // Intro replays call the same authored stroke-input callback, without emulating pointer capture.
  if (new URLSearchParams(location.search).get('showcaseDemo') === '1') {
    window.BloomSketchShowcase = Object.freeze({
      drawStroke(shape = 'circle') {
        if (!drawingAllowed()) return false;
        const steps = shape === 'line' ? 20 : 54;
        const cx = vw * .56, cy = vh * .47, radius = Math.max(36, Math.min(vw, vh) * .14);
        const point = i => {
          const t = i / steps, a = t * Math.PI * 2;
          return shape === 'line'
            ? {x: cx - radius + radius * 2 * t, y: cy + radius * .35 - radius * .7 * t}
            : {x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius};
        };
        const send = (type, i) => collectCombatDrawing({type, pointerId: 71, ...point(i)});
        send('down', 0);
        for (let i = 1; i < steps; i++) send('move', i);
        send('up', steps);
        return true;
      }
    });
  }
  // Registered after the GameKit device listener, so the edge already belongs to ActionState.
  for(const type of ['keydown','keyup'])document.addEventListener(type,e=>{if(!e.repeat&&keyboardBindings[e.code]&&!ui.modal)wakeInputPreview();});
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
    // Touching the stick rolls once toward the stick direction (or the facing direction on a bare tap); holding then walks on.
    if(e.type==='down')actions.pulse('dash');
    wakeInputPreview();
  },onRelease(){resetMovementStick();wakeInputPreview();}});
  $('soundButton').addEventListener('click',async()=>{audioOn=!audioOn;sound.setMuted(!audioOn);$('soundButton').setAttribute('aria-pressed',String(audioOn));$('soundButton').textContent=audioOn?'♪ 켬':'♪ 끔';if(audioOn){await sound.unlock();sfx('select');}});
  function showResult(message,durationMs=1250){if(resimulatingGame)return;const c=$('resultChip');c.textContent=message;c.classList.add('show');ui.resultUntil=performance.now()+durationMs;}
  function changeModal(name){const open=name==='training'||name==='help'||name==='multi';ui.modal=open?name:null;for(const id of ['trainingModal','helpModal','multiplayerModal'])$(id).classList.toggle('open',open&&id===(name==='training'?'trainingModal':name==='help'?'helpModal':'multiplayerModal'));
    if(open){fieldInput.releaseAll('modal');stickInput.releaseAll('modal');dropDraw();if(name==='training'){updateTrainingView();drawTrainingPad();}}
    else{drawInput.pointer=null;focusGameplay();}
    $('trainingButton').setAttribute('aria-expanded',String(name==='training'));$('helpButton').setAttribute('aria-expanded',String(name==='help'));
  }
  function applyRoute(){const route=location.hash.split('?')[0];changeModal(route==='#/training'?'training':route==='#/help'?'help':route==='#/multi'?'multi':null);if(loop)loop.resetTiming();}
  function goRoute(name){const url=name?`#/${name}`:'#/play';if(location.hash===url){applyRoute();return;}location.hash=url;}
  $('multiplayerButton').addEventListener('click',()=>{closeHeadMenu();goRoute('multi');});
  $('trainingButton').addEventListener('click',()=>{closeHeadMenu();goRoute('training');});
  $('helpButton').addEventListener('click',()=>{closeHeadMenu();goRoute('help');});
  $('codexButton').addEventListener('click',()=>{closeHeadMenu();goRoute('help');requestAnimationFrame(()=>$('codexTitle').scrollIntoView({block:'start'}));});
  // The four head buttons live behind one menu button so the top of the screen stays free for drawing.
  function closeHeadMenu(){$('headMenu').hidden=true;$('menuButton').setAttribute('aria-expanded','false');}
  $('menuButton').addEventListener('click',e=>{e.stopPropagation();const open=$('headMenu').hidden;$('headMenu').hidden=!open;$('menuButton').setAttribute('aria-expanded',String(open));});
  document.addEventListener('pointerdown',e=>{if(!$('headMenu').hidden&&!e.target.closest('#headMenu,#menuButton'))closeHeadMenu();});
  for(const b of document.querySelectorAll('[data-close]'))b.addEventListener('click',()=>goRoute('play'));
  document.querySelectorAll('.modal').forEach(node=>node.addEventListener('pointerdown',e=>{if(e.target===node)goRoute('play');}));
  document.addEventListener('keydown',e=>{if(e.code==='Escape'&&ui.modal){e.preventDefault();goRoute('play');}});
  window.addEventListener('hashchange',applyRoute);

  function strokePad(canvas,context,w,h,ratio,points,guide){context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,w,h);context.save();context.lineJoin='round';context.lineCap='round';if(guide&&guide.length>1){context.setLineDash([4,6]);context.lineWidth=2.3;context.strokeStyle='#d4b78e';context.globalAlpha=points?.length?.18:.48;context.beginPath();guide.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.stroke();context.setLineDash([]);}
    context.lineWidth=1;context.strokeStyle='#eadcc8';context.beginPath();context.moveTo(w*.5,h*.17);context.lineTo(w*.5,h*.83);context.moveTo(w*.17,h*.5);context.lineTo(w*.83,h*.5);context.stroke();
    if(points?.length>1){context.lineWidth=4.4;context.strokeStyle='#34484e';context.beginPath();points.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.stroke();context.lineWidth=1.4;context.strokeStyle='#fff7dd';context.stroke();const end=points.at(-1);context.beginPath();context.arc(end.x,end.y,4.2,0,Math.PI*2);context.fillStyle='#d9a057';context.fill();}context.restore();}
  function paintSummonDraft(){
    if(!summonDraft.active)return;
    const trace=pts=>{drawCtx.beginPath();pts.forEach((p,i)=>i?drawCtx.lineTo(p.x,p.y):drawCtx.moveTo(p.x,p.y));};
    trace(summonDraft.body);drawCtx.lineWidth=6;drawCtx.strokeStyle='rgba(255,247,221,.75)';drawCtx.stroke();drawCtx.lineWidth=3.2;drawCtx.strokeStyle='rgba(52,72,78,.62)';drawCtx.stroke();
    for(const stroke of summonDraft.strokes){
      if(stroke.length===1){drawCtx.beginPath();drawCtx.arc(stroke[0].x,stroke[0].y,6.5,0,Math.PI*2);drawCtx.fillStyle='#fff7dd';drawCtx.fill();drawCtx.beginPath();drawCtx.arc(stroke[0].x,stroke[0].y,4,0,Math.PI*2);drawCtx.fillStyle='#8a5f4a';drawCtx.fill();continue;}
      trace(stroke);drawCtx.lineWidth=6;drawCtx.strokeStyle='#fff7dd';drawCtx.stroke();drawCtx.lineWidth=3.4;drawCtx.strokeStyle='#8a5f4a';drawCtx.stroke();}
  }
  function renderDrawPad(){
    if(drawInput.pointer!==null&&!drawingAllowed())dropDraw();
    if(drawInput.pointer!==null)updateDrawingAim();
    tickSummonDraft();updateLiveFace();updateLiveBody();updateRewardPanel();updateRunEndPanel();updateSelectionChip();
    const points=drawInput.pointer!==null?drawInput.points:drawInput.previewUntilMs>performance.now()?drawInput.finished:null;
    drawCtx.setTransform(drawDpr,0,0,drawDpr,0,0);drawCtx.clearRect(0,0,vw,vh);
    drawCtx.save();drawCtx.lineCap='round';drawCtx.lineJoin='round';paintSummonDraft();paintLiveGhost();
    if(!points?.length){drawCtx.restore();return;}
    if(drawInput.pointer!==null&&drawInput.center&&!summonDraft.active){const c=drawInput.center;drawCtx.strokeStyle='#315f68';drawCtx.lineWidth=2;drawCtx.beginPath();drawCtx.arc(c.x,c.y,18,0,Math.PI*2);drawCtx.stroke();}
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

