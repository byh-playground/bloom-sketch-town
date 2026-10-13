  // UI is a projection of the single authoritative RPG world. It never changes combat HP/EXP itself.
  function resizeAll(){const r=field.getBoundingClientRect();if(r.width<=0||r.height<=0)return;
    vw=r.width;vh=r.height;dpr=Math.min(2,devicePixelRatio||1);renderer.resize(vw,vh,dpr);screenDpr=dpr;txtCanvas.width=Math.max(1,Math.round(vw*dpr));txtCanvas.height=Math.max(1,Math.round(vh*dpr));
    const d=draw.getBoundingClientRect();if(d.width>0&&d.height>0){PW=d.width;PH=d.height;drawDpr=dpr;draw.width=Math.round(PW*drawDpr);draw.height=Math.round(PH*drawDpr);}
    const tr=trainingPad.getBoundingClientRect();if(tr.width>0&&tr.height>0){tw=tr.width;th=tr.height;trainingDpr=dpr;trainingPad.width=Math.round(tw*trainingDpr);trainingPad.height=Math.round(th*trainingDpr);}
    const mr=mini.getBoundingClientRect();mini.width=Math.round(Math.max(1,mr.width)*dpr);mini.height=Math.round(Math.max(1,mr.height)*dpr);miniCtx.setTransform(dpr,0,0,dpr,0,0);
    previewDataset();}
  function paintMinimap(){const w=mini.width/dpr,h=mini.height/dpr;miniCtx.setTransform(dpr,0,0,dpr,0,0);miniCtx.clearRect(0,0,w,h);miniCtx.fillStyle='#f5eddf';miniCtx.fillRect(0,0,w,h);
    const xx=x=>x/CFG.world.width*w, yy=y=>y/CFG.world.height*h;
    miniCtx.strokeStyle='#d1bca2';miniCtx.lineWidth=5;miniCtx.beginPath();miniCtx.moveTo(xx(490),yy(735));miniCtx.lineTo(xx(1948),yy(708));miniCtx.stroke();
    miniCtx.fillStyle='#9eae9a';for(const t of world.trees)miniCtx.fillRect(xx(t.x),yy(t.y),1.8,1.8);
    miniCtx.fillStyle='#9c7c6a';for(const b of world.houses)miniCtx.fillRect(xx(b.x)-3,yy(b.y)-2.5,6,5);
    miniCtx.strokeStyle='#9a6e96';miniCtx.beginPath();miniCtx.arc(xx(CFG.boss.x),yy(CFG.boss.y),Math.max(5,CFG.boss.radius/CFG.world.width*w),0,Math.PI*2);miniCtx.stroke();
    miniCtx.fillStyle='#a66b70';for(const e of world.enemies)if(!e.dead){miniCtx.beginPath();miniCtx.arc(xx(e.x),yy(e.y),e.kind==='boss'?4:2,0,Math.PI*2);miniCtx.fill();}
    if(mp.shared){const other=player===hostPlayer?guestPlayer:hostPlayer;miniCtx.beginPath();miniCtx.arc(xx(other.x),yy(other.y),3.9,0,Math.PI*2);miniCtx.fillStyle='#639ac4';miniCtx.fill();}
    const px=xx(player.x),py=yy(player.y);miniCtx.beginPath();miniCtx.arc(px,py,5,0,Math.PI*2);miniCtx.fillStyle='#fff';miniCtx.fill();miniCtx.lineWidth=2;miniCtx.strokeStyle='#396c6b';miniCtx.stroke();miniCtx.beginPath();miniCtx.arc(px,py,2.5,0,Math.PI*2);miniCtx.fillStyle='#396c6b';miniCtx.fill();
  }
  function updateHud(){const pct=100*player.hp/player.maxHp;$('hpFill').style.width=`${clamp(pct,0,100)}%`;$('hpText').textContent=`HP ${Math.ceil(player.hp)} / ${player.maxHp}`;$('inkText').textContent=`잉크 ${player.ink}`;$('level').textContent=`LV ${player.level}`;$('xpFill').style.width=`${100*player.xp/player.xpNext}%`;
    if(world.bossDefeated){$('questTitle').textContent='마을의 새로운 페이지';$('questText').textContent='잉크 감시자를 물리쳤어요! 마을 공방에서 붓끝을 강화해 보세요.';$('questProgress').value=5;}
    else if(world.bossSpawned){$('questTitle').textContent='보스 · 잉크 감시자';$('questText').textContent='길을 따라 동쪽 고대 원형장으로 가서 감시자를 쓰러뜨리세요.';$('questProgress').value=5;}
    else{$('questTitle').textContent='첫 탐험 · 잉크 숲 조사';$('questText').textContent=`몬스터 ${Math.min(world.kills,world.questGoal)}/${world.questGoal} · 동쪽 숲에서 적을 찾아 한 획 마법으로 물리치세요.`;$('questProgress').value=Math.min(world.kills,5);}
    const boss=world.enemies.find(e=>e.kind==='boss'&&!e.dead);$('bossBar').style.display=boss?'block':'none';if(boss)$('bossFill').style.width=`${100*boss.hp/boss.maxHp}%`;
    const predicted=mp.connected&&mp.localPresentation&&mp.localPoseSource
      ?mp.localPresentation.modelFor(mp.localPoseSource,performance.now()):null;
    const d=predicted?{...player.dash,leftMs:predicted.leftMs,charges:predicted.charges}:player.dash,capacity=CFG.player.roll.capacity;
    for(let i=1;i<=capacity;i++){
      const full=i<=d.charges,charging=i===d.charges+1;
      const pct=full?100:charging?clamp(100*(1-d.rechargeMs/CFG.player.roll.rechargeMs),0,100):0;
      $('rollFill'+i).style.width=pct.toFixed(1)+'%';$('rollSlot'+i).classList.toggle('full',full);
    }
    $('rollHud').classList.toggle('roll-empty',d.charges===0);
    $('rollStatus').textContent=`${d.charges} / ${capacity} · ${d.leftMs>0?'구르기 중':d.charges<capacity?'순차 충전 중':'준비 완료'}`;
  }
  // One 15TPS simulation scheduler, separated from RAF presentation at the display refresh rate.
  // GameKit InterpolationTimeline owns both solo and multiplayer presentation. Online RoomSession owns rollback.
  const SOLO_INPUT=new Uint8Array(1),sampleDash={},sampleInteract={},sampleDirections={up:{},down:{},left:{},right:{}};
  function gatherLocalCommands(){
    const dash=actions.sampleInto('dash',sampleDash),interact=actions.sampleInto('interact',sampleInteract);
    let pressedDirection=false,dx=0,dy=0;
    for(const [name,slot] of Object.entries(sampleDirections)){
      actions.sampleInto(name,slot);if(slot.pressed)pressedDirection=true;
      if(slot.held||slot.pressed){if(name==='right')dx++;else if(name==='left')dx--;else if(name==='down')dy++;else if(name==='up')dy--;}
    }
    if(!ui.modal){
      if(pressedDirection||dash.pressed){
        const len=hypot(dx,dy);if(len>.1){dx/=len;dy/=len;}else{dx=player.faceX;dy=player.faceY;}
        world.commands.push({type:'rollVector',dx,dy,distance:rollMaxDistance()});
      }
      if(interact.pressed)world.commands.push({type:'interact'});
    }
    actions.consume();
  }
  function createSoloSession(){return {
    tick:0,inputSize:1,pace:1,profile:{tickRate:15,maxCatchupSteps:CFG.maxCatchup},closed:false,resimulating:false,
    poll(){},releaseInput(){fieldInput.releaseAll('gamekit-blur');paintInput.releaseAll('gamekit-blur');trainingInput.releaseAll('gamekit-blur');},
    advance(){gatherLocalCommands();tick(CFG.tickMs);this.tick++;return {status:'advanced',tick:this.tick};}
  };}
  let gameSession=createSoloSession(),loop=null,deadlinePump=null,paintRAF=0,paintRunning=false;
  let renderFrames=0,frameStarted=0,renderFPS=0,advancedTicks=0,tickStarted=0,measuredTPS=0;
  let frameCostMs=0,maxFrameCostMs=0;
  // A single native BLOOM GameKit InterpolationTimeline drives *both* offline and online presentation.
  // The simulation is never modified for presentation; reusable prototype-based view models own the sampled pose.
  mp.interpolation = new InterpolationTimeline({stepMs:CFG.tickMs,
    schema:{x:'number',y:'number',roll:'number',age:'number',life:'number'}});
  let poseReady=false,capturedAtMs=0,paintFrameNow=0,presentationActive=false;
  let nextPaintAt=0,presentationSnapshots=0,lastAcceptedRevision=-1;
  const renderViewCache=new WeakMap(),unidentifiedIds=new WeakMap();
  let nextPresentationId=0;
  const lastRollCapture=new Map(),lastPositionCapture=new Map();
  function presentationId(object,kind){
    if(kind==='hero')return object===hostPlayer?'hero-a':'hero-b';
    if(Number.isSafeInteger(object.id)&&object.id>=0)return kind+'-'+object.id;
    let id=unidentifiedIds.get(object);
    if(!id){id=kind+'-view-'+(++nextPresentationId);unidentifiedIds.set(object,id);}
    return id;
  }
  function forEachPoseEntity(visit){
    visit(hostPlayer,'hero');
    visit(guestPlayer,'hero');
    for(const object of world.enemies)if(!object.dead)visit(object,'enemy');
    for(const object of world.projectiles)visit(object,'shot');
    for(const object of world.hazards)visit(object,'hazard');
    for(const object of world.casts)visit(object,'cast');
    for(const object of world.pickups)visit(object,'pickup');
    for(const object of world.fields)visit(object,'field');
    for(const object of world.particles)visit(object,'particle');
    for(const object of world.floaters)visit(object,'floater');
    for(const object of world.rollMarks)visit(object,'rollMark');
    if(world.rollTarget)visit(world.rollTarget,'rollTarget');
  }
  // BLOOM GameKit local input preview: an isolated, small actor fork, NOT a second live simulation.
  // Roll physics/collision share startActorRoll + stepActorRoll with the canonical RPG update.
  // A cast publishes only its anticipation pose; actual projectile/damage are confirmed input commands.
  function snapshotLocalActor(){return {actor:{...player,dash:{...player.dash}},mode:world.mode,castMs:0};}
  function writeLocalPose(source,actor,castMs=0){source.x=actor.x;source.y=actor.y;source.roll=actor.dash.elapsedMs;source.leftMs=actor.dash.leftMs;source.durationMs=actor.dash.durationMs;source.dirX=actor.dash.dirX;source.dirY=actor.dash.dirY;source.charges=actor.dash.charges;source.castMs=castMs;}
  function disposeInputPreview(){
    mp.inputPreview?.dispose();mp.inputPreview=null;mp.localPresentation=null;
    mp.localPoseSource=null;mp.localPoseType=null;mp.previewNeedsReset=true;
  }
  function initializeInputPreview(simloop,interpolation){
    disposeInputPreview();
    // The real published GameKit modules own all prediction scheduling, replay and presentation corrections.
    class LocalWizardPose extends interpolation.RenderObject {
      constructor(){super();this.x=0;this.y=0;this.roll=0;this.leftMs=0;this.durationMs=0;this.dirX=1;this.dirY=0;this.charges=2;this.castMs=0;}
      static renderSchema={x:this.POSITION_X,y:this.POSITION_Y,roll:this.LINEAR,leftMs:this.LINEAR,durationMs:this.STEP,dirX:this.STEP,dirY:this.STEP,charges:this.STEP,castMs:this.LINEAR};
      render(){} // The RPG draws the returned model in the existing shared WebGL renderer.
    }
    mp.localPoseType=LocalWizardPose;
    mp.localPoseSource=new LocalWizardPose();
    mp.localPresentation=new interpolation.PresentationRuntime({stepMs:CFG.tickMs,snapDistance:160});
    const identity=presentationId(player,'hero');
    function makeFork(snapshot){
      const fork={actor:{...snapshot.actor,dash:{...snapshot.actor.dash}},mode:snapshot.mode,castMs:snapshot.castMs||0,pose:new LocalWizardPose(),
        restore(value){this.actor={...value.actor,dash:{...value.actor.dash}};this.mode=value.mode;this.castMs=value.castMs||0;writeLocalPose(this.pose,this.actor,this.castMs);},
        step(input,context){
          for(const entry of context.commands||[]){let cmd;
            try{cmd=JSON.parse(MP_READER.decode(entry.payload));}catch{continue;}
            if(cmd?.type==='roll')startActorRoll(this.actor,cmd.dx,cmd.dy,cmd.distance,this.mode);
            else if(cmd?.type==='cast'&&this.mode==='playing')this.castMs=240;
          }
          if(this.actor.koMs>0)this.actor.koMs=Math.max(0,this.actor.koMs-CFG.tickMs);
          else stepActorRoll(this.actor,CFG.tickMs);
          this.castMs=Math.max(0,this.castMs-CFG.tickMs);
          writeLocalPose(this.pose,this.actor,this.castMs);
        }};
      writeLocalPose(fork.pose,fork.actor,fork.castMs);return fork;
    }
    mp.inputPreview=new simloop.LocalInputPreview({createFork:makeFork,
      readEntities:fork=>[{id:identity,generation:0,source:fork.pose}],
      presentation:mp.localPresentation,
      captureSnapshot:snapshotLocalActor,
      cloneSnapshot:value=>({actor:{...value.actor,dash:{...value.actor.dash}},mode:value.mode,castMs:value.castMs}),
      maxPendingInputs:8,maxFutureTicks:8,maxAgeMs:650,stepMs:CFG.tickMs});
    mp.previewNeedsReset=true;
  }
  function wakeInputPreview(){
    if(!mp.connected||!mp.inputPreview||!loop||ui.modal)return;
    // Called after GameKit DOM has captured the edge; no authority step or gameplay logic is run here.
    loop.observeInput(performance.now());
  }
  function captureLocalInputPreview(now,reset){
    if(!mp.connected||!mp.localPresentation||!mp.inputPreview||!mp.session)return;
    writeLocalPose(mp.localPoseSource,player,0);
    const mode=reset||mp.previewNeedsReset?'rollback':'continuous';
    mp.localPresentation.capture({revision:mp.poseRevision,sequence:mp.poseSequence,
      timeMs:gameSession.tick*CFG.tickMs,entities:[{id:presentationId(player,'hero'),generation:0,source:mp.localPoseSource}],
      ...(mode==='rollback'?{mode}: {})},now);
    // The checkpoint contains only the local actor. World state remains in RoomSession's rollback history.
    const metadata=mp.session.localInputState;
    mp.inputPreview.reconcile({snapshot:snapshotLocalActor(),revision:mp.poseRevision,
      tick:mp.session.tick,epoch:mp.session.epoch??0,timeMs:now,
      input:metadata?.replayInput??SOLO_INPUT,
      ...(mode==='rollback'?{mode:'reset'}:{})});
    mp.previewNeedsReset=false;
  }
  function capturePresentation(){
    const entities=[],seen=new Set(),newPositions=new Map(),newRolls=new Map();
    const reset=mp.poseReset,previous=lastPositionCapture;
    if(reset&&mp.poseRevision===lastAcceptedRevision){mp.poseRevision++;mp.poseSequence=0;}
    forEachPoseEntity((object,kind)=>{
      const id=presentationId(object,kind);
      const age=Number.isFinite(object.ageMs)?object.ageMs:0;
      const life=Number.isFinite(object.lifeMs)?object.lifeMs:0;
      const roll=object.dash?.elapsedMs??0;
      const values={x:object.x,y:object.y,roll,age,life};
      const entity={id,generation:object._poseGeneration??0,values};
      const before=previous.get(id);
      if(!reset&&!before&&(kind==='shot'||kind==='hazard')&&Number.isFinite(object.prevX)&&Number.isFinite(object.prevY)){
        // GameKit initialValues makes a projectile's very first 15TPS interval continuous from its launch position.
        entity.initialValues={x:object.prevX,y:object.prevY,roll:0,
          age:Math.max(0,age-CFG.tickMs),life:life};
      }
      if(!reset&&before&&hypot(object.x-before.x,object.y-before.y)>180)entity.teleport=true;
      if(kind==='hero'){
        const old=lastRollCapture.get(id);
        if(!reset&&old!==undefined&&roll<old-1&&object.dash.leftMs>0)entity.resetFields=['roll'];
        newRolls.set(id,roll);
      }
      entities.push(entity);seen.add(id);newPositions.set(id,{x:object.x,y:object.y});
    });
    const now=Math.max(performance.now(),paintFrameNow);
    const accepted=mp.interpolation.accept({revision:mp.poseRevision,sequence:++mp.poseSequence,
      timeMs:gameSession.tick*CFG.tickMs,entities,...(reset?{mode:'rollback'}:{})},now);
    if(accepted){
      capturedAtMs=now;poseReady=true;mp.poseReset=false;lastAcceptedRevision=mp.poseRevision;presentationSnapshots++;
      lastPositionCapture.clear();for(const [id,at] of newPositions)lastPositionCapture.set(id,at);
      lastRollCapture.clear();for(const [id,value] of newRolls)lastRollCapture.set(id,value);
      captureLocalInputPreview(now,reset);
    }
  }
  function resetPresentation(){
    poseReady=false;capturedAtMs=0;paintFrameNow=0;nextPaintAt=0;
    mp.poseRevision++;mp.poseSequence=0;mp.poseReset=true;mp.previewNeedsReset=true;mp.inputPreview?.clear();
    lastPositionCapture.clear();lastRollCapture.clear();
  }
  function presentationObject(object,kind){
    if(!presentationActive||!poseReady)return object;
    let view=renderViewCache.get(object);
    if(!view){view=Object.create(object);renderViewCache.set(object,view);}
    if(!mp.interpolation.sampleInto(presentationId(object,kind),object._poseGeneration??0,paintFrameNow,view))return null;
    view.ageMs=view.age;
    view.lifeMs=view.life;
    if(kind==='hero'){
      if(!Object.hasOwn(view,'dash')||Object.getPrototypeOf(view.dash)!==object.dash)
        view.dash=Object.create(object.dash);
      if(mp.connected&&object===(mp.role==='join'?guestPlayer:hostPlayer)&&mp.localPresentation&&mp.localPoseSource){
        const predicted=mp.localPresentation.modelFor(mp.localPoseSource,paintFrameNow);
        if(predicted){view.x=predicted.x;view.y=predicted.y;view.roll=predicted.roll;
          view.castPreviewMs=predicted.castMs;view.dash.leftMs=predicted.leftMs;
          view.dash.durationMs=predicted.durationMs;view.dash.dirX=predicted.dirX;
          view.dash.dirY=predicted.dirY;view.dash.charges=predicted.charges;
        }
      }
      view.dash.elapsedMs=view.roll;
    }
    return view;
  }
  function renderInterpolated(){
    if(mp.poseReset&&!mp.session?.resimulating)capturePresentation();
    // Timeline accept() may advance its monotonic clock; sample after that capture.
    const now=performance.now();
    paintFrameNow=now;presentationActive=true;
    // This clock is strictly visual. Rollback snapshots and authoritative world.clockMs never change on RAF.
    paintClockMs=world.clockMs+Math.min(CFG.tickMs,Math.max(0,now-capturedAtMs));
    try{
      const view=poseReady?presentationObject(player,'hero'):player;
      if(view)withActor(view,()=>renderWorld());
    }finally{presentationActive=false;}
  }
  function localInputPacket(){
    gatherLocalCommands();
    if(mp.session&&!mp.session.activePlayers.includes(mp.localId)){world.commands.length=0;return {input:SOLO_INPUT,commands:[],predict:false};}
    const commands=[];
    // Commands are canonical one-shot inputs. Capture once and replay only in the SDK.
    for(const command of world.commands.splice(0,12)){
      const payload=encodeLocalCommand(command);
      if(payload){commands.push({payload});mp.stats.commands++;}
    }
    return {input:SOLO_INPUT,commands,predict:commands.length>0};
  }
  const onSimulationAdvance=({status})=>{
    if(status!=='advanced')return;
    capturePresentation();advancedTicks++;
    const now=performance.now();
    if(!tickStarted)tickStarted=now;
    if(now-tickStarted>=1000){measuredTPS=Math.round(advancedTicks*1000/(now-tickStarted));advancedTicks=0;tickStarted=now;}
  };
  function stopPainting(){
    paintRunning=false;
    if(paintRAF)cancelAnimationFrame(paintRAF);
    paintRAF=0;
  }
  function startPainting(){
    if(paintRunning||!loop)return;
    paintRunning=true;
    const paint=()=>{
      if(!paintRunning)return;
      if(mp.inputPreview)loop.observeInput(performance.now());
      loop.render();
      if(paintRunning)paintRAF=requestAnimationFrame(paint);
    };
    paintRAF=requestAnimationFrame(paint);
  }
  function pauseGameLoops(){
    stopPainting();deadlinePump?.stop();loop?.stop();
  }
  function resumeGameLoops(){
    if(deadlinePump?.running)return;
    loop.resetTiming();
    if(mp.inputPreview&&mp.connected){mp.poseReset=true;capturePresentation();}
    loop.pulse(performance.now(),{render:false});
    deadlinePump?.rebase();deadlinePump?.start();
    startPainting();
  }
  function rebindGameLoop(){
    pauseGameLoops();
    loop=createLoop({session:gameSession,getInput:mp.connected?localInputPacket:()=>SOLO_INPUT,
      inputPreview:mp.connected?mp.inputPreview:undefined,
      onPreviewError(error){console.error('[Sketch Town GameKit input preview]',error);mp.stats.previewErrors=(mp.stats.previewErrors||0)+1;},
      backlogPolicy:'drop',maxBacklogTicks:8,onAdvance:onSimulationAdvance,
      render(){
        const now=performance.now();
        // Deadline-based 60Hz cap alternates 2/3 RAF intervals on 144Hz rather than falling to 48 FPS.
        if(nextPaintAt && now+0.7<nextPaintAt)return;
        nextPaintAt=Math.max(nextPaintAt||now,now-1000/60)+1000/60;
        renderInterpolated();
        $('screenMessage').textContent=world.screenText;
        $('screenMessage').classList.toggle('show',world.screenTextMs>0);
        renderDrawPad();drawTrainingPad();
        const slow=!mp.connected&&drawInput.pointer!==null&&!ui.modal;
        $('slowFx').classList.toggle('visible',slow);$('slowIndicator').classList.toggle('visible',slow);
        $('hitFlash').style.opacity=String(clamp(world.hitFlashMs/155,0,1)*.43);
        if(now-lastUiMs>125){lastUiMs=now;updateHud();paintMinimap();}
        if(ui.resultUntil&&now>ui.resultUntil){$('resultChip').classList.remove('show');ui.resultUntil=0;}
        const spent=performance.now()-now;frameCostMs=frameCostMs?mix(frameCostMs,spent,.08):spent;maxFrameCostMs=Math.max(maxFrameCostMs,spent);
        renderFrames++;if(!frameStarted)frameStarted=now;
        if(now-frameStarted>=1000){renderFPS=Math.round(renderFrames*1000/(now-frameStarted));frameStarted=now;renderFrames=0;}
      },
      onInputRelease(){dropDraw();releaseTrain();},
      onError(error){pauseGameLoops();console.error(error);const el=$('error');el.style.display='block';el.textContent=`게임 실행 오류: ${error.stack||error.message||error}`;}
    });
    resetPresentation();capturePresentation();
    // GameKit native timer pump owns the 15TPS deadline independently of rAF presentation.
    deadlinePump=createDeadlineScheduler({getIntervalMs:()=>CFG.tickMs,
      pulse:now=>loop.pulse(now,{render:false}),maxBacklogTicks:8,
      onGap:()=>loop.resetTiming()});
    resumeGameLoops();
  }
  const ro=new ResizeObserver(()=>{if(!renderer.active)resizeAll();});ro.observe(field);ro.observe(draw.parentElement);ro.observe(trainingPad.parentElement);
  window.addEventListener('resize',resizeAll);window.addEventListener('orientationchange',resizeAll);
  window.addEventListener('blur',()=>loop?.releaseInput());
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){stopPainting();loop?.releaseInput();}
    else if(deadlinePump?.running){loop?.resetTiming();deadlinePump.rebase();startPainting();}
  });
  window.addEventListener('pagehide',()=>{pauseGameLoops();sound.dispose();ro.disconnect();renderer.dispose();fieldInput.dispose();paintInput.dispose();trainingInput.dispose();});
  resizeAll();applyRoute();rebindGameLoop();
  // E2E probes observe the actual SDK frame / tick / draw / gameplay pipeline.
  window.__sketchRpgDebug={
    source:{renderer:'BLOOM GameKit Renderer2D · WebGL1',input:'ActionState/createDOMInput + LocalInputPreview',time:'GameKit createDeadlineScheduler 15TPS + separate RAF capped 60FPS + InterpolationTimeline/PresentationRuntime',audio:'AudioPlayer'},
    analyze(raw){const s=makeShotData(raw);return {name:s.name,kind:s.kind,area:s.areaPx2,damage:s.baseDamage,cnn:s.cnn.prob,reference:s.reference};},
    sample:samplePoints,
    cast(type){const shot=makeShotData(samplePoints(type));world.commands.push({type:'cast',shot});},
    castStroke(raw){const shot=makeShotData(raw);world.commands.push({type:'cast',shot});return {kind:shot.kind,baseDamage:shot.baseDamage};},
    spellSpec(raw){const shot=makeShotData(raw);return {kind:shot.kind,castMs:castDurationMs(shot),recoveryMs:spellRecoveryMs(shot),areaPower:shot.areaPower,baseDamage:shot.baseDamage};},
    rollTo(x,y){queueRollTo(x,y);},
    previewInfo(){const now=performance.now(),model=mp.localPresentation&&mp.localPoseSource?mp.localPresentation.modelFor(mp.localPoseSource,now):null;return {enabled:!!mp.inputPreview,ready:mp.inputPreview?.ready??false,pending:mp.inputPreview?.pendingCount??0,metrics:mp.inputPreview?.metrics||null,x:model?.x??null,y:model?.y??null,castMs:model?.castMs??null,actorX:player.x,actorY:player.y,revision:mp.poseRevision};},
    rollState(){return {...player.dash};},slowState(){return {ratio:world.slowRatio,drawing:drawInput.pointer!==null,hitstopMs:world.hitstopMs};},
    advanceSession(){const result=gameSession.advance(SOLO_INPUT);if(result.status==='advanced')capturePresentation();return result;},pauseRendering(){pauseGameLoops();},resumeRendering(){resumeGameLoops();},pausePainting(){stopPainting();},resumePainting(){startPainting();},renderFrame(){loop.render();},selectGlyph(kind){selectGlyph(kind);},
    renderNow(){renderInterpolated();},
    combatFixture(kind='boss',x=680,y=730){world.enemies.length=0;world.projectiles.length=0;world.casts.length=0;world.castQueue.length=0;world.hazards.length=0;world.fields.length=0;world.spawnMs=1e8;return spawnEnemy(kind,x,y).id;},
    ricochetState(){return world.projectiles.map(p=>({id:p.id,kind:p.kind,bouncesLeft:p.bouncesLeft,bouncesTotal:p.bouncesTotal,bounceCount:p.bounceCount,state:p.state,ageMs:p.ageMs,x:p.x,y:p.y}));},
    castQueueLength(){return world.castQueue.length;},effectsSnapshot(){return world.fields.map(f=>({kind:f.kind,ageMs:f.ageMs,lifeMs:f.lifeMs}));},

    moveTo(x,y){player.x=x;player.y=y;camera.x=x;camera.y=y;resetPresentation();capturePresentation();},
    spawnEnemy(kind,x,y){return spawnEnemy(kind,x,y).id;},
    screenAt(x,y){const p={x:0,y:0};renderer.worldToScreenInto(x,y,p);return p;},
    worldAt(x,y){const p={x:0,y:0};renderer.screenToWorldInto(x,y,p);return p;},
    foePositions(){return world.enemies.filter(e=>!e.dead).map(e=>({id:e.id,x:e.x,y:e.y,r:e.r,kind:e.kind,hp:e.hp,wetMs:e.wetMs,stunMs:e.stunMs,burnMs:e.burnMs}));},
    pendingCommands(){return world.commands.map(c=>c.type);},
    setPlayerHp(v){player.hp=clamp(v,0,player.maxHp);},
    tick(ms=CFG.tickMs){tick(ms);},
    datasetCount(){return {original:dataset.entries.length};},
    datasetAdd(type){addSample(samplePoints(type));},
    rendererStats(){return {...renderer.stats};},performanceStats(){return {targetTPS:15,actualTPS:measuredTPS,targetFPS:60,actualFPS:renderFPS,rollbackCount:mp.session?.metrics?.rollbacks??0,interpolated:poseReady&&!!mp.interpolation,trackedEntities:mp.interpolation.size,frameCostMs:+frameCostMs.toFixed(2),maxFrameCostMs:+maxFrameCostMs.toFixed(2),presentationSnapshots};},
    optimizationStats(){return {visualPool:{...visualPools,particles:visualPools.particles.length,floaters:visualPools.floaters.length,activeParticles:world.particles.length,activeFloaters:world.floaters.length},color:{...paletteStats,colors:paletteCache.size},contours:{built:sketchContourBuilds,cached:sketchContourHits},renderer:{...renderer.stats},drawQueueSlots:worldDrawSlots.length,enemyRecords:world.enemies.length,liveEnemies:world.enemies.filter(e=>!e.dead).length};},
    burstFixture(count=24){burst(player.x,player.y,'#bb7153',count,75);},floatingFixture(value='-18'){floating(player.x,player.y-25,value,'#be7757');},

    presentationInfo(){const now=performance.now(),view={};const ok=poseReady&&mp.interpolation.sampleInto(presentationId(player,'hero'),0,now,view);return {ready:poseReady,tracked:mp.interpolation.size,snapshots:presentationSnapshots,simulationX:player.x,simulationY:player.y,renderX:ok?view.x:player.x,renderY:ok?view.y:player.y,clock:world.clockMs,paintClock:paintClockMs};},
    modelReport(){return packed.report;},modelClasses(){return CNN_LABELS.slice();},sketchMetrics(){return {grammar:'procedural-pencil',boilMs:SKETCH.boilMs,alive:world.enemies.filter(e=>!e.dead).length,erasedFragments:world.particles.filter(p=>p.kind==='erasedStroke').length};},
    snapshot(){return {slowRatio:world.slowRatio,hitstopMs:world.hitstopMs,tick:gameSession.tick,player:{x:player.x,y:player.y,hp:player.hp,level:player.level,ink:player.ink},mode:world.mode,kills:world.kills,bossSpawned:world.bossSpawned,bossDefeated:world.bossDefeated,enemyCount:world.enemies.filter(e=>!e.dead).length,projectileCount:world.projectiles.length,castCount:world.casts.length,castQueueCount:world.castQueue.length,roll:{charges:player.dash.charges,rechargeMs:player.dash.rechargeMs,activeMs:player.dash.leftMs},modal:ui.modal,worldWidth:CFG.world.width,worldHeight:CFG.world.height,drawPhase:drawInput.pointer!==null?'drawing':'idle',lastResult:world.lastResult,rendererState:renderer.state};}
  };
