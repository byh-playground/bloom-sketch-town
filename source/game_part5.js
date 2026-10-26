  // UI is a projection of the single authoritative RPG world. It never changes combat HP/EXP itself.
  function resizeAll(){const r=field.getBoundingClientRect();if(r.width<=0||r.height<=0)return;
    dropDraw();
    vw=r.width;vh=r.height;dpr=Math.min(2,devicePixelRatio||1);renderer.resize(vw,vh,dpr);screenDpr=dpr;txtCanvas.width=Math.max(1,Math.round(vw*dpr));txtCanvas.height=Math.max(1,Math.round(vh*dpr));
    const d=draw.getBoundingClientRect();if(d.width>0&&d.height>0){drawDpr=dpr;draw.width=Math.round(vw*drawDpr);draw.height=Math.round(vh*drawDpr);}
    const tr=trainingPad.getBoundingClientRect();if(tr.width>0&&tr.height>0){tw=tr.width;th=tr.height;trainingDpr=dpr;trainingPad.width=Math.round(tw*trainingDpr);trainingPad.height=Math.round(th*trainingDpr);}
    const mr=mini.getBoundingClientRect();mini.width=Math.round(Math.max(1,mr.width)*dpr);mini.height=Math.round(Math.max(1,mr.height)*dpr);miniCtx.setTransform(dpr,0,0,dpr,0,0);
    previewDataset();}
  function paintMinimap(){const w=mini.width/dpr,h=mini.height/dpr;miniCtx.setTransform(dpr,0,0,dpr,0,0);miniCtx.clearRect(0,0,w,h);miniCtx.fillStyle='#f5eddf';miniCtx.fillRect(0,0,w,h);
    const xx=x=>x/CFG.world.width*w, yy=y=>y/CFG.world.height*h;
    for(const [i,r]of REGIONS.entries()){miniCtx.fillStyle=['#dbe5cc','#ccddda','#e3d8c6'][i];miniCtx.fillRect(xx(r.min),0,xx(r.max-r.min),h);}
    miniCtx.fillStyle='#91b2b6';for(const p of mapLayout.ponds){miniCtx.beginPath();miniCtx.ellipse(xx(p.x),yy(p.y),xx(p.rx),yy(p.ry),0,0,Math.PI*2);miniCtx.fill();}
    miniCtx.fillStyle='#bdb5a6';for(const p of mapLayout.ridges){miniCtx.beginPath();miniCtx.ellipse(xx(p.x),yy(p.y),xx(p.r),yy(p.r),0,0,Math.PI*2);miniCtx.fill();}
    miniCtx.strokeStyle='#bcb18f';miniCtx.lineWidth=2;miniCtx.beginPath();mapLayout.routePoints.forEach(({x,y},i)=>i?miniCtx.lineTo(xx(x),yy(y)):miniCtx.moveTo(xx(x),yy(y)));miniCtx.stroke();

    miniCtx.fillStyle='#9eae9a';for(const t of world.trees)miniCtx.fillRect(xx(t.x),yy(t.y),1.8,1.8);
    miniCtx.fillStyle='#9c7c6a';for(const b of world.houses)miniCtx.fillRect(xx(b.x)-3,yy(b.y)-2.5,6,5);
    for(const [i,site]of mapLayout.bossSites.entries()){miniCtx.strokeStyle=i<world.bossesDefeated?'#c5bfc4':'#9a6e96';miniCtx.beginPath();miniCtx.arc(xx(site.x),yy(site.y),Math.max(4,site.radius/CFG.world.width*w),0,Math.PI*2);miniCtx.stroke();}
    miniCtx.fillStyle='#a66b70';for(const e of world.enemies)if(!e.dead){miniCtx.beginPath();miniCtx.arc(xx(e.x),yy(e.y),e.kind==='boss'?4:2,0,Math.PI*2);miniCtx.fill();}
    if(mp.shared){const other=player===hostPlayer?guestPlayer:hostPlayer;miniCtx.beginPath();miniCtx.arc(xx(other.x),yy(other.y),3.9,0,Math.PI*2);miniCtx.fillStyle='#639ac4';miniCtx.fill();}
    const px=xx(player.x),py=yy(player.y);miniCtx.beginPath();miniCtx.arc(px,py,5,0,Math.PI*2);miniCtx.fillStyle='#fff';miniCtx.fill();miniCtx.lineWidth=2;miniCtx.strokeStyle='#396c6b';miniCtx.stroke();miniCtx.beginPath();miniCtx.arc(px,py,2.5,0,Math.PI*2);miniCtx.fillStyle='#396c6b';miniCtx.fill();
  }
  function updateHud(){const pct=100*player.hp/player.maxHp;$('hpFill').style.width=`${clamp(pct,0,100)}%`;$('hpText').textContent=`HP ${Math.ceil(player.hp)} / ${player.maxHp}`;
    updateProgressionHud();
    const boss=activeBoss();$('bossBar').style.display=boss?'block':'none';
    if(boss){$('bossFill').style.width=`${100*boss.hp/boss.maxHp}%`;const title=`${boss.name} · 보스 ${boss.bossId+1}/${BOSS_PROFILES.length}`,rule=BOSS_PROFILES[boss.bossId].ruleText();if($('bossName').textContent!==title)$('bossName').textContent=title;if($('bossRule').textContent!==rule)$('bossRule').textContent=rule;}
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
  // One 30TPS simulation scheduler, separated from RAF presentation at the display refresh rate.
  // GameKit InterpolationTimeline owns both solo and multiplayer presentation. Online RoomSession owns rollback.
  const SOLO_INPUT=new Uint8Array(2),localMovementInput=new Uint8Array(2),sampleDash={},sampleDirections={up:{},down:{},left:{},right:{}};
  function gatherLocalCommands(){
    const dash=actions.sampleInto('dash',sampleDash);
    let dx=movementStick.x,dy=movementStick.y;
    for(const [name,slot] of Object.entries(sampleDirections)){
      actions.sampleInto(name,slot);
      if(slot.held){if(name==='right')dx++;else if(name==='left')dx--;else if(name==='down')dy++;else if(name==='up')dy--;}
    }
    if(ui.modal||document.hidden){dx=0;dy=0;}
    const length=hypot(dx,dy);if(length>1){dx/=length;dy/=length;}
    localMovementInput[0]=Math.round(dx*127)&255;localMovementInput[1]=Math.round(dy*127)&255;
    if(!ui.modal){
      if(dash.pressed)world.commands.push({type:'rollVector',dx:length>.1?dx:player.faceX,dy:length>.1?dy:player.faceY,distance:rollMaxDistance()});
    }
    actions.consume();
  }
  function createSoloSession(){return {
    tick:0,inputSize:2,pace:1,profile:{tickRate:30,maxCatchupSteps:CFG.maxCatchup},closed:false,resimulating:false,
    poll(){},releaseInput(){fieldInput.releaseAll('gamekit-blur');trainingInput.releaseAll('gamekit-blur');},
    advance(){gatherLocalCommands();readMovementInput(player,localMovementInput);tick(CFG.tickMs);this.tick++;return {status:'advanced',tick:this.tick};}
  };}
  let gameSession=createSoloSession(),loop=null,deadlinePump=null,inputPump=null,paintRAF=0,paintRunning=false;
  let renderFrames=0,frameStarted=0,renderFPS=0,advancedTicks=0,tickStarted=0,measuredTPS=0;
  let frameCostMs=0,maxFrameCostMs=0;
  // GameKit owns the display clock, identities, lifetime and path history. Only declared data reaches draw code.
  const {RenderObject,PresentationRuntime}=gamekitInterpolation;
  const R=RenderObject;
  class SceneView extends RenderObject {
    static renderSchema={x:R.POSITION_X,y:R.POSITION_Y,ageMs:R.LINEAR,lifeMs:R.LINEAR,id:R.STEP,renderKind:R.STEP,kind:R.STEP,r:R.STEP,color:R.STEP};
    render(){}
  }
  class HeroView extends SceneView {static renderSchema={actorId:R.STEP,hp:R.STEP,maxHp:R.STEP,invulMs:R.COUNTDOWN_MS,faceX:R.STEP,faceY:R.STEP,moveX:R.STEP,moveY:R.STEP,
    'dash.leftMs':R.COUNTDOWN_MS,'dash.elapsedMs':R.LINEAR,'dash.durationMs':R.STEP,'dash.dirX':R.STEP,'dash.dirY':R.STEP,'dash.charges':R.STEP};}
  class EnemyView extends SceneView {static renderSchema={hp:R.STEP,maxHp:R.STEP,stunMs:R.COUNTDOWN_MS,chargeMs:R.COUNTDOWN_MS,chargeDX:R.STEP,chargeDY:R.STEP,hitMs:R.COUNTDOWN_MS,windupMs:R.COUNTDOWN_MS,attackType:R.STEP};}
  class ProjectileView extends SceneView {
    static renderSchema={angle:R.ANGLE,shape:R.STEP,bouncesLeft:R.STEP};
    static renderPath={x:'x',y:'y',durationMs:CFG.tickMs*12,maxPoints:64};
  }
  class HazardView extends SceneView {static renderSchema={vx:R.STEP,vy:R.STEP};}
  class CastView extends SceneView {static renderSchema={durationMs:R.STEP,owner:R.STEP,shot:R.STEP};}
  class FieldView extends SceneView {static renderSchema={ex:R.STEP,ey:R.STEP};}
  class ParticleView extends SceneView {static renderSchema={angle:R.ANGLE,initialMs:R.STEP,segment:R.STEP};}
  class FloaterView extends SceneView {static renderSchema={text:R.STEP};}
  class RollView extends SceneView {static renderSchema={maxLifeMs:R.STEP,dirX:R.STEP,dirY:R.STEP};}
  const sceneTypes={hero:HeroView,enemy:EnemyView,shot:ProjectileView,hazard:HazardView,cast:CastView,field:FieldView,particle:ParticleView,floater:FloaterView,rollMark:RollView,rollTarget:RollView,pickup:SceneView};
  mp.interpolation=new PresentationRuntime({stepMs:CFG.tickMs,delayMs:CFG.tickMs*2,snapDistance:180});
  let poseReady=false,capturedAtMs=0,paintFrameNow=0,presentationActive=false,paintFrame=null,localPaintFrame=null;
  let nextPaintAt=0,presentationSnapshots=0,lastAcceptedRevision=-1;
  const renderViewCache=new WeakMap(),unidentifiedIds=new WeakMap(),pathViews=new Map();
  const sceneViews={hero:[],enemy:[],shot:[],hazard:[],cast:[],pickup:[],field:[],particle:[],floater:[],rollMark:[],rollTarget:[]};
  let nextPresentationId=0;
  const lastPositionCapture=new Map();
  function presentationId(object,kind){
    if(kind==='hero')return object===hostPlayer?'hero-a':'hero-b';
    if(Number.isSafeInteger(object.id)&&object.id>=0)return kind+'-'+object.id;
    let id=unidentifiedIds.get(object);
    if(!id){id=kind+'-view-'+(++nextPresentationId);unidentifiedIds.set(object,id);}
    return id;
  }
  function forEachPoseEntity(visit){
    visit(hostPlayer,'hero');
    if(mp.shared)visit(guestPlayer,'hero');
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
  // Walking and roll physics/collision share startActorRoll + stepActorMovement with the canonical RPG update.
  // A cast publishes only its anticipation pose; actual projectile/damage are confirmed input commands.
  function snapshotLocalActor(){return {actor:{...player,dash:{...player.dash}},mode:world.mode,castMs:0};}
  function writeLocalPose(source,actor,castMs=0){source.x=actor.x;source.y=actor.y;source.roll=actor.dash.elapsedMs;source.leftMs=actor.dash.leftMs;source.durationMs=actor.dash.durationMs;source.dirX=actor.dash.dirX;source.dirY=actor.dash.dirY;source.charges=actor.dash.charges;source.castMs=castMs;source.moveX=actor.moveX;source.moveY=actor.moveY;source.faceX=actor.faceX;source.faceY=actor.faceY;}
  function disposeInputPreview(){
    mp.inputPreview?.dispose();mp.inputPreview=null;mp.localPresentation=null;
    mp.localPoseSource=null;mp.localPoseType=null;mp.previewNeedsReset=true;
  }
  function initializeInputPreview(simloop,interpolation){
    disposeInputPreview();
    // The real published GameKit modules own all prediction scheduling, replay and presentation corrections.
    class LocalWizardPose extends interpolation.RenderObject {
      constructor(){super();this.x=0;this.y=0;this.roll=0;this.leftMs=0;this.durationMs=0;this.dirX=1;this.dirY=0;this.charges=2;this.castMs=0;this.moveX=0;this.moveY=0;this.faceX=1;this.faceY=0;}
      static renderSchema={x:this.POSITION_X,y:this.POSITION_Y,roll:this.LINEAR,leftMs:this.LINEAR,durationMs:this.STEP,dirX:this.STEP,dirY:this.STEP,charges:this.STEP,castMs:this.LINEAR,moveX:this.STEP,moveY:this.STEP,faceX:this.STEP,faceY:this.STEP};
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
          readMovementInput(this.actor,input);
          for(const entry of context.commands||[]){let cmd;
            try{cmd=JSON.parse(MP_READER.decode(entry.payload));}catch{continue;}
            if(cmd?.type==='roll')startActorRoll(this.actor,cmd.dx,cmd.dy,cmd.distance,this.mode);
            else if(cmd?.type==='cast'&&this.mode==='playing')this.castMs=240;
          }
          if(this.actor.koMs>0)this.actor.koMs=Math.max(0,this.actor.koMs-CFG.tickMs);
          else stepActorMovement(this.actor,CFG.tickMs);
          this.castMs=Math.max(0,this.castMs-CFG.tickMs);
          writeLocalPose(this.pose,this.actor,this.castMs);
        }};
      writeLocalPose(fork.pose,fork.actor,fork.castMs);return fork;
    }
    mp.inputPreview=new simloop.LocalInputPreview({createFork:makeFork,
      isActive:fork=>fork.actor.dash.leftMs>0||fork.castMs>0,
      readEntities:fork=>[{id:identity,generation:0,source:fork.pose}],
      presentation:mp.localPresentation,
      captureSnapshot:snapshotLocalActor,
      cloneSnapshot:value=>({actor:{...value.actor,dash:{...value.actor.dash}},mode:value.mode,castMs:value.castMs}),
      maxPendingInputs:16,maxFutureTicks:16,maxAgeMs:650,stepMs:CFG.tickMs});
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
      tick:mp.session.tick,epoch:mp.session.epoch??0,timeMs:now,phaseStartMs:loop.simulationTimeMs??now,
      input:metadata?.replayInput??SOLO_INPUT,
      ...(mode==='rollback'?{mode:'reset'}:{})});
    mp.previewNeedsReset=false;
  }
  function capturePresentation(){
    const entities=[],newPositions=new Map();
    const reset=mp.poseReset,previous=lastPositionCapture;
    if(reset&&mp.poseRevision===lastAcceptedRevision){mp.poseRevision++;mp.poseSequence=0;}
    forEachPoseEntity((object,kind)=>{
      const id=presentationId(object,kind),source={...object,renderKind:kind};
      if(kind==='hero')source.actorId=object===hostPlayer?'a':'b';
      const entity={id,generation:object._poseGeneration??0,source,type:sceneTypes[kind]};
      if(!reset&&!previous.has(id)&&(kind==='shot'||kind==='hazard')&&Number.isFinite(object.prevX)&&Number.isFinite(object.prevY)){
        entity.initialSource={...source,x:object.prevX,y:object.prevY,ageMs:Math.max(0,(object.ageMs||0)-CFG.tickMs)};
        entity.initialTimeMs=(gameSession.tick-1)*CFG.tickMs;
      }
      entities.push(entity);newPositions.set(id,{x:object.x,y:object.y});
    });
    const now=Math.max(performance.now(),paintFrameNow);
    const accepted=mp.interpolation.capture({revision:mp.poseRevision,sequence:++mp.poseSequence,
      timeMs:gameSession.tick*CFG.tickMs,entities,...(reset?{mode:'rollback'}:{})},now);
    if(accepted){
      capturedAtMs=now;poseReady=true;mp.poseReset=false;lastAcceptedRevision=mp.poseRevision;presentationSnapshots++;
      lastPositionCapture.clear();for(const [id,at] of newPositions)lastPositionCapture.set(id,at);
      captureLocalInputPreview(now,reset);
    }
  }
  function resetPresentation(){
    poseReady=false;capturedAtMs=0;paintFrameNow=0;nextPaintAt=0;
    mp.poseRevision++;mp.poseSequence=0;mp.poseReset=true;mp.previewNeedsReset=true;mp.inputPreview?.clear();
    lastPositionCapture.clear();
  }
  function renderInterpolated(){
    if(mp.poseReset&&!mp.session?.resimulating)capturePresentation();
    const now=performance.now();paintFrameNow=now;presentationActive=true;
    paintFrame=mp.interpolation.frame(now);
    localPaintFrame=mp.connected&&mp.localPresentation?mp.localPresentation.frame(now):null;
    paintClockMs=paintFrame.timeMs;
    for(const views of Object.values(sceneViews))views.length=0;
    const pathsSeen=new Set();
    paintFrame.forEach((model,id,generation)=>{
      let view=model;
      if(view.renderKind==='hero'){
        const object=view.actorId==='a'?hostPlayer:guestPlayer;
        view=renderViewCache.get(object)??{};Object.assign(view,model);view.dash={...model.dash};
        const predicted=object===(mp.role==='join'?guestPlayer:hostPlayer)?localPaintFrame?.modelFor(mp.localPoseSource):null;
        if(predicted){view.x=predicted.x;view.y=predicted.y;view.moveX=predicted.moveX;view.moveY=predicted.moveY;
          view.faceX=predicted.faceX;view.faceY=predicted.faceY;view.castPreviewMs=predicted.castMs;
          Object.assign(view.dash,{elapsedMs:predicted.roll,leftMs:predicted.leftMs,durationMs:predicted.durationMs,dirX:predicted.dirX,dirY:predicted.dirY,charges:predicted.charges});
        }else view.castPreviewMs=0;
        renderViewCache.set(object,view);
      }
      if(view.renderKind==='shot'){
        let points=pathViews.get(id);if(!points){points=[];pathViews.set(id,points);}pathsSeen.add(id);
        paintFrame.pathInto(id,generation,points);
      }
      sceneViews[view.renderKind].push(view);
    });
    for(const id of pathViews.keys())if(!pathsSeen.has(id))pathViews.delete(id);
    try{const view=sceneViews.hero.find(v=>v.actorId===(mp.role==='join'?'b':'a'));
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
    return {input:localMovementInput,commands,predict:commands.length>0||localMovementInput.some(value=>value!==0)};
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
      loop.render();
      if(paintRunning)paintRAF=requestAnimationFrame(paint);
    };
    paintRAF=requestAnimationFrame(paint);
  }
  function pauseGameLoops(){
    stopPainting();inputPump?.stop();deadlinePump?.stop();loop?.stop();
  }
  function resumeGameLoops(){
    if(deadlinePump?.running)return;
    loop.resetTiming();
    if(mp.inputPreview&&mp.connected){mp.poseReset=true;capturePresentation();}
    loop.observeInput(performance.now());
    loop.pulse(performance.now(),{render:false,input:false});
    inputPump?.rebase();inputPump?.start();
    deadlinePump?.rebase();deadlinePump?.start();
    startPainting();
  }
  function rebindGameLoop(){
    pauseGameLoops();
    loop=createLoop({session:gameSession,rates:{baseHz:CFG.baseHz,inputHz:CFG.inputHz,renderHz:CFG.renderHz},getInput:mp.connected?localInputPacket:()=>SOLO_INPUT,
      inputPreview:mp.connected?mp.inputPreview:undefined,
      onPreviewError(error){console.error('[Sketch Town GameKit input preview]',error);mp.stats.previewErrors=(mp.stats.previewErrors||0)+1;},
      backlogPolicy:'retain',maxBacklogTicks:16,onAdvance:onSimulationAdvance,
      render(){
        const now=performance.now();
        // Deadline-based 60Hz cap alternates 2/3 RAF intervals on 144Hz rather than falling to 48 FPS.
        if(nextPaintAt && now+0.7<nextPaintAt)return;
        nextPaintAt=Math.max(nextPaintAt||now,now-1000/CFG.renderHz)+1000/CFG.renderHz;
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
      onInputRelease(){fieldInput.releaseAll('loop');stickInput.releaseAll('loop');rollButtonInput.releaseAll('loop');localMovementInput.fill(0);dropDraw();releaseTrain();},
      onError(error){pauseGameLoops();console.error(error);const el=$('error');el.style.display='block';el.textContent=`게임 실행 오류: ${error.stack||error.message||error}`;}
    });
    resetPresentation();capturePresentation();
    // GameKit native timer pump owns the 30TPS deadline independently of rAF presentation.
    deadlinePump=createDeadlineScheduler({getDeadlineMs:()=>loop.nextDeadlineMs,
      pulse:now=>loop.pulse(now,{render:false,input:false})});
    inputPump=createDeadlineScheduler({getIntervalMs:()=>1000/CFG.inputHz,
      pulse:now=>loop.pollInput(now),maxBacklogTicks:8});
    resumeGameLoops();
  }
  const ro=new ResizeObserver(()=>{if(!renderer.active)resizeAll();});ro.observe(field);ro.observe(draw.parentElement);ro.observe(trainingPad.parentElement);
  window.addEventListener('resize',resizeAll);window.addEventListener('orientationchange',resizeAll);
  window.addEventListener('blur',()=>loop?.releaseInput());
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){stopPainting();loop?.releaseInput();}
    else if(deadlinePump?.running){loop?.resetTiming();deadlinePump.rebase();startPainting();}
  });
  window.addEventListener('pagehide',event=>{
    pauseGameLoops();
    if(event.persisted)return;
    sound.dispose();ro.disconnect();disposeVectorAssets();renderer.dispose();
    fieldInput.dispose();stickInput.dispose();rollButtonInput.dispose();trainingInput.dispose();
  });
  window.addEventListener('pageshow',event=>{if(event.persisted)resumeGameLoops();});
  resizeAll();applyRoute();rebindGameLoop();
  // E2E probes observe the actual SDK frame / tick / draw / gameplay pipeline.
  window.__sketchRpgDebug={
    source:{renderer:'BLOOM GameKit Renderer2D · WebGL1',input:'ActionState/createDOMInput + LocalInputPreview',time:'GameKit createDeadlineScheduler 30TPS + separate RAF capped 60FPS + InterpolationTimeline/PresentationRuntime',audio:'AudioPlayer'},
    analyze(raw){const s=makeShotData(raw);return {name:s.name,kind:s.kind,area:s.areaPx2,damage:s.baseDamage,cnn:s.cnn.prob,reference:s.reference};},
    sample:samplePoints,
    drawingState(){return {pointer:drawInput.pointer,points:drawInput.points.map(p=>({...p})),aim:drawInput.aim,center:drawInput.center,origin:drawInput.origin};},
    shotDetails(){return world.projectiles.map(p=>({id:p.id,x:p.x,y:p.y,vx:p.vx,vy:p.vy,angle:p.angle,shape:p.shape,state:p.state,r:p.r}));},
    queuedShots(){return [...world.commands.filter(c=>c.type==='cast'),...world.castQueue,...world.casts].map(c=>c.shot);},
    cast(type,aim=0){const shot={...makeShotData(samplePoints(type)),aim};world.commands.push({type:'cast',shot});},
    castStroke(raw,aim=0){const shot={...makeShotData(raw),aim};world.commands.push({type:'cast',shot});return {kind:shot.kind,baseDamage:shot.baseDamage};},
    spellSpec(raw){const shot=makeShotData(raw);return {kind:shot.kind,castMs:castDurationMs(shot),recoveryMs:spellRecoveryMs(shot),areaPower:shot.areaPower,baseDamage:shot.baseDamage};},
    presentedProjectiles(){return sceneViews.shot.map(p=>({id:p.id,x:p.x,y:p.y,head:{...pathViews.get('shot-'+p.id)?.at(-1)},path:pathViews.get('shot-'+p.id)?.map(point=>({...point}))}));},
    renderedActors(){return [hostPlayer,guestPlayer].map(actor=>{const view=renderViewCache.get(actor);return {id:view?.actorId,x:view?.x,y:view?.y,castActive:!!view&&((view.castPreviewMs||0)>0||sceneViews.cast.some(c=>c.owner===view.actorId)),currentClip:view?.currentClip??null,currentExpression:view?.currentExpression??null,nextCastAtMs:actor.nextCastAtMs,screenX:view?(view.x-camera.x)*camera.zoom:null};});},
    previewInfo(){const now=performance.now(),model=mp.localPresentation&&mp.localPoseSource?mp.localPresentation.modelFor(mp.localPoseSource,now):null;return {enabled:!!mp.inputPreview,ready:mp.inputPreview?.ready??false,pending:mp.inputPreview?.pendingCount??0,metrics:mp.inputPreview?.metrics||null,x:model?.x??null,y:model?.y??null,castMs:model?.castMs??null,actorX:player.x,actorY:player.y,revision:mp.poseRevision};},
    movementState(){return {x:player.moveX,y:player.moveY,speed:CFG.player.walkSpeed};},rollState(){return {...player.dash};},slowState(){return {ratio:world.slowRatio,drawing:drawInput.pointer!==null,hitstopMs:world.hitstopMs};},
    advanceSession(){const result=gameSession.advance(SOLO_INPUT);if(result.status==='advanced')capturePresentation();return result;},pauseRendering(){pauseGameLoops();},resumeRendering(){resumeGameLoops();},pausePainting(){stopPainting();},resumePainting(){startPainting();},renderFrame(){loop.render();},selectGlyph(kind){selectGlyph(kind);},
    renderNow(){renderInterpolated();},
    combatFixture(kind='boss',x=680,y=730){world.enemies.length=0;world.bossesDefeated=0;world.projectiles.length=0;world.casts.length=0;world.castQueue.length=0;world.hazards.length=0;world.fields.length=0;return spawnEnemy(kind,x,y).id;},
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
    rendererStats(){return {...renderer.stats};},performanceStats(){return {targetTPS:30,actualTPS:measuredTPS,targetFPS:60,actualFPS:renderFPS,rollbackCount:mp.session?.metrics?.rollbacks??0,interpolated:poseReady&&!!mp.interpolation,trackedEntities:mp.interpolation.size,frameCostMs:+frameCostMs.toFixed(2),maxFrameCostMs:+maxFrameCostMs.toFixed(2),presentationSnapshots};},
    optimizationStats(){return {visualPool:{...visualPools,particles:visualPools.particles.length,floaters:visualPools.floaters.length,activeParticles:world.particles.length,activeFloaters:world.floaters.length},color:{...paletteStats,colors:paletteCache.size},vectorAssets:{draws:vectorAssetDraws,loaded:[...vectorAssets.keys()]},renderer:{...renderer.stats},drawQueueSlots:worldDrawSlots.length,enemyRecords:world.enemies.length,liveEnemies:world.enemies.filter(e=>!e.dead).length};},
    burstFixture(count=24){burst(player.x,player.y,'#bb7153',count,75);},floatingFixture(value='-18'){floating(player.x,player.y-25,value,'#be7757');},

    presentationInfo(){const now=performance.now(),view=poseReady?mp.interpolation.sample(presentationId(player,'hero'),0,now):null;const ok=!!view;return {ready:poseReady,tracked:mp.interpolation.size,snapshots:presentationSnapshots,simulationX:player.x,simulationY:player.y,renderX:ok?view.x:player.x,renderY:ok?view.y:player.y,clock:world.clockMs,paintClock:paintClockMs};},
    modelReport(){return packed.report;},modelClasses(){return CNN_LABELS.slice();},sketchMetrics(){return {grammar:'gamekit-svg-vector-assets',boilMs:SKETCH.boilMs,loadedAssets:[...vectorAssets.keys()],dynamicStroke:'input-sampled geometry remains runtime data',alive:world.enemies.filter(e=>!e.dead).length,erasedFragments:world.particles.filter(p=>p.kind==='erasedStroke').length};},
    runState(){return {actor:structuredClone(player),regionKills:[...world.regionKills],cards:{...player.cards}};},
    cardFixture(id){return addCard(player,id);},
    regionCombatFixture(region=0){const clearing=mapLayout.clearingsOf(region)[0],x=clearing.x-20,y=clearing.y;world.projectiles.length=0;world.casts.length=0;world.castQueue.length=0;world.commands.length=0;world.hazards.length=0;world.fields.length=0;world.enemies=world.enemies.filter(e=>!e.dead&&e.region===region);world.regionKills[region]=0;const kinds=['chaser','spitter','charger','spitter','chaser'];while(world.enemies.length<5){const i=world.enemies.length,e=spawnEnemy(kinds[i%kinds.length],x+i*14,y+(i%2)*12);e.region=region;}world.enemies.forEach((e,i)=>{e.x=x+i*14;e.y=y+(i%2)*12;e.hp=1;e.stunMs=15000;});player.x=x-140;player.y=y;player.moveX=player.moveY=0;player.nextCastAtMs=world.clockMs;camera.x=player.x;camera.y=player.y;dropDraw();resetPresentation();capturePresentation();},
    bossState(){const b=activeBoss();return {defeated:world.bossesDefeated,sites:mapLayout.bossSites.map(q=>({...q})),profiles:BOSS_PROFILES.map(p=>({id:p.id,name:p.name,hp:p.hp,ruleText:p.ruleText(),best:p.bestKind(),factors:Object.fromEntries(SHAPE_KINDS.map(k=>[k,p.multiplier(k)]))})),active:b?{id:b.id,bossId:b.bossId,name:b.name,hp:b.hp,maxHp:b.maxHp,x:b.x,y:b.y}:null};},
    setBossesDefeated(n){world.bossesDefeated=n;},
    // Put boss n next to the player (stunned so only the damage rules are under test) and return its enemy id.
    spawnBoss(n){world.enemies.length=0;world.projectiles.length=0;world.casts.length=0;world.castQueue.length=0;world.hazards.length=0;world.fields.length=0;world.bossesDefeated=n;const e=spawnEnemy('boss',player.x+190,player.y,n);e.stunMs=1e9;e.hp=e.maxHp;return e.id;},
    // One real damageEnemy call per source kind; returns the hit points removed.
    bossHit(id,kind,amount=100){const e=world.enemies.find(q=>q.id===id);const before=e.hp;damageEnemy(e,amount,e.x,e.y-18,'#be7757',kind);return before-e.hp;},
    bossHp(id){const e=world.enemies.find(q=>q.id===id);return e?{hp:e.hp,dead:e.dead}:null;},
    finishBoss(){const e=activeBoss();e.hp=1;damageEnemy(e,50,e.x,e.y,'#be7757',BOSS_PROFILES[e.bossId].bestKind());},
    mapState(){const m=mapLayout;return {seed:m.seed,attempt:m.attempt,hash:m.hash(),worldSeed:world.mapSeed,boss:{...m.boss},route:m.routePoints.map(p=>({...p})),ponds:m.ponds.map(p=>({x:p.x,y:p.y,rx:p.rx,ry:p.ry})),ridges:m.ridges.map(p=>({x:p.x,y:p.y,r:p.r})),clearings:m.clearings.map(c=>({x:c.x,y:c.y,rx:c.rx,ry:c.ry,region:c.region})),landmarks:m.landmarks.map(l=>({...l})),spawns:m.spawns.map(q=>({...q})),counts:{props:m.props.length,solids:m.solids.length,decals:m.decals.length,obstacles:world.obstacles.length,trees:world.trees.length}};},
    mapHashFor(seed){const t=performance.now(),l=generateMapLayout(seed);return {hash:l.hash(),attempt:l.attempt,ms:performance.now()-t};},
    terrainBlocked(x,y,r){return touchesObstacle(x,y,r);},
    setInk(value){player.ink=clamp(value,0,player.maxInk);},
    snapshot(){return {slowRatio:world.slowRatio,hitstopMs:world.hitstopMs,tick:gameSession.tick,player:{x:player.x,y:player.y,hp:player.hp,ink:player.ink},mode:world.mode,kills:world.kills,bossesDefeated:world.bossesDefeated,activeBoss:activeBoss()?{id:activeBoss().bossId,name:activeBoss().name,hp:activeBoss().hp,maxHp:activeBoss().maxHp}:null,enemyCount:world.enemies.filter(e=>!e.dead).length,projectileCount:world.projectiles.length,castCount:world.casts.length,castQueueCount:world.castQueue.length,roll:{charges:player.dash.charges,rechargeMs:player.dash.rechargeMs,activeMs:player.dash.leftMs},modal:ui.modal,worldWidth:CFG.world.width,worldHeight:CFG.world.height,drawPhase:drawInput.pointer!==null?'drawing':'idle',lastResult:world.lastResult,rendererState:renderer.state};}
  };
