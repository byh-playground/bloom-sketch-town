  // UI is a projection of the single authoritative RPG world. It never changes combat HP/EXP itself.
  function resizeAll(){const r=field.getBoundingClientRect();if(r.width<=0||r.height<=0)return;
    dropDraw();
    vw=r.width;vh=r.height;dpr=Math.min(2,devicePixelRatio||1);renderer.resize(vw,vh,dpr);screenDpr=dpr;txtCanvas.width=Math.max(1,Math.round(vw*dpr));txtCanvas.height=Math.max(1,Math.round(vh*dpr));
    const d=draw.getBoundingClientRect();if(d.width>0&&d.height>0){drawDpr=dpr;draw.width=Math.round(vw*drawDpr);draw.height=Math.round(vh*drawDpr);}
    const tr=trainingPad.getBoundingClientRect();if(tr.width>0&&tr.height>0){tw=tr.width;th=tr.height;trainingDpr=dpr;trainingPad.width=Math.round(tw*trainingDpr);trainingPad.height=Math.round(th*trainingDpr);}
    const mr=mini.getBoundingClientRect();mini.width=Math.round(Math.max(1,mr.width)*dpr);mini.height=Math.round(Math.max(1,mr.height)*dpr);miniCtx.setTransform(dpr,0,0,dpr,0,0);
    previewDataset();}
  // The terrain layer of the minimap is painted once per layout and size; only sites, enemies and heroes move each frame.
  let miniTerrain=null,miniTerrainKey='';
  function miniTerrainLayer(w,h){
    const key=`${mapLayout.seed}:${w}x${h}:${dpr}`;if(miniTerrain&&miniTerrainKey===key)return miniTerrain;
    const g=mapLayout.grid,small=document.createElement('canvas');small.width=g.cols;small.height=g.rows;
    const sx=small.getContext('2d'),img=sx.createImageData(g.cols,g.rows);
    for(let k=0;k<g.land.length;k++){const c=hexRgb(groundColor(g,k));img.data[k*4]=c[0];img.data[k*4+1]=c[1];img.data[k*4+2]=c[2];img.data[k*4+3]=255;}
    sx.putImageData(img,0,0);
    const layer=document.createElement('canvas');layer.width=Math.max(1,Math.round(w*dpr));layer.height=Math.max(1,Math.round(h*dpr));
    const lx=layer.getContext('2d');lx.imageSmoothingEnabled=true;lx.drawImage(small,0,0,layer.width,layer.height);
    miniTerrain=layer;miniTerrainKey=key;return layer;
  }
  function paintMinimap(){const w=mini.width/dpr,h=mini.height/dpr;miniCtx.setTransform(dpr,0,0,dpr,0,0);miniCtx.clearRect(0,0,w,h);
    miniCtx.drawImage(miniTerrainLayer(w,h),0,0,w,h);
    const xx=x=>x/CFG.world.width*w, yy=y=>y/CFG.world.height*h;
    const spawn=mapLayout.spawn;miniCtx.fillStyle='#1d8a4a';miniCtx.beginPath();miniCtx.arc(xx(spawn.x),yy(spawn.y),3,0,Math.PI*2);miniCtx.fill();
    for(const s of mapLayout.sites){if(s.kind==='camp'){miniCtx.fillStyle='#c98a4a';miniCtx.fillRect(xx(s.x)-1.5,yy(s.y)-1.5,3,3);}else if(s.kind==='portal'){miniCtx.strokeStyle='#8a5cc4';miniCtx.lineWidth=1.2;miniCtx.beginPath();miniCtx.arc(xx(s.x),yy(s.y),2.4,0,Math.PI*2);miniCtx.stroke();}}
    // Boss rings carry their number: grey = fallen, purple = sealed, orange = the next one to fight.
    const next=world.bossesDefeated<BOSS_PROFILES.length?nextBossId():-1;miniCtx.font='700 8px system-ui';miniCtx.textAlign='center';miniCtx.textBaseline='middle';
    for(const site of mapLayout.bossSites){const i=site.bossId,down=world.bossState[i]===2,col=down?'#b8b2b8':i===next?'#e0792a':'#7d5a9e',cx=xx(site.x),cy=yy(site.y);
      miniCtx.fillStyle=down?'#ece8ec':'#fff8ee';miniCtx.beginPath();miniCtx.arc(cx,cy,5,0,Math.PI*2);miniCtx.fill();miniCtx.lineWidth=i===next?2:1.4;miniCtx.strokeStyle=col;miniCtx.stroke();miniCtx.fillStyle=col;miniCtx.fillText(String(i+1),cx,cy+.4);}
    miniCtx.textBaseline='alphabetic';
    miniCtx.fillStyle='#a66b70';for(const e of world.enemies)if(!e.dead){miniCtx.beginPath();miniCtx.arc(xx(e.x),yy(e.y),e.kind==='boss'?4:1.6,0,Math.PI*2);miniCtx.fill();}
    if(mp.shared){const other=player===hostPlayer?guestPlayer:hostPlayer;miniCtx.beginPath();miniCtx.arc(xx(other.x),yy(other.y),3.9,0,Math.PI*2);miniCtx.fillStyle='#639ac4';miniCtx.fill();}
    const px=xx(player.x),py=yy(player.y);miniCtx.beginPath();miniCtx.arc(px,py,4.4,0,Math.PI*2);miniCtx.fillStyle='#fff';miniCtx.fill();miniCtx.lineWidth=2;miniCtx.strokeStyle='#396c6b';miniCtx.stroke();miniCtx.beginPath();miniCtx.arc(px,py,2.2,0,Math.PI*2);miniCtx.fillStyle='#396c6b';miniCtx.fill();
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
  class SummonView extends SceneView {static renderSchema={hp:R.STEP,maxHp:R.STEP,hitMs:R.COUNTDOWN_MS,cdMs:R.COUNTDOWN_MS,faceX:R.STEP,temper:R.STEP,shape:R.STEP,targetId:R.STEP};}
  class HazardView extends SceneView {static renderSchema={vx:R.STEP,vy:R.STEP};}
  class CastView extends SceneView {static renderSchema={durationMs:R.STEP,owner:R.STEP,shot:R.STEP};}
  class FieldView extends SceneView {static renderSchema={ex:R.STEP,ey:R.STEP};}
  class ParticleView extends SceneView {static renderSchema={angle:R.ANGLE,initialMs:R.STEP,segment:R.STEP};}
  class FloaterView extends SceneView {static renderSchema={text:R.STEP};}
  class RollView extends SceneView {static renderSchema={maxLifeMs:R.STEP,dirX:R.STEP,dirY:R.STEP};}
  const sceneTypes={hero:HeroView,enemy:EnemyView,summon:SummonView,hazard:HazardView,cast:CastView,field:FieldView,particle:ParticleView,floater:FloaterView,rollMark:RollView,rollTarget:RollView,pickup:SceneView};
  mp.interpolation=new PresentationRuntime({stepMs:CFG.tickMs,delayMs:CFG.tickMs*2,snapDistance:180});
  let poseReady=false,capturedAtMs=0,paintFrameNow=0,presentationActive=false,paintFrame=null,localPaintFrame=null;
  let nextPaintAt=0,presentationSnapshots=0,lastAcceptedRevision=-1;
  const renderViewCache=new WeakMap(),unidentifiedIds=new WeakMap();
  const sceneViews={hero:[],enemy:[],summon:[],hazard:[],cast:[],pickup:[],field:[],particle:[],floater:[],rollMark:[],rollTarget:[]};
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
    for(const object of world.summons)visit(object,'summon');
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
      if(!reset&&!previous.has(id)&&kind==='hazard'&&Number.isFinite(object.prevX)&&Number.isFinite(object.prevY)){
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
      sceneViews[view.renderKind].push(view);
    });
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
      onInputRelease(){fieldInput.releaseAll('loop');stickInput.releaseAll('loop');localMovementInput.fill(0);dropDraw();releaseTrain();},
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
    fieldInput.dispose();stickInput.dispose();trainingInput.dispose();
  });
  window.addEventListener('pageshow',event=>{if(event.persisted)resumeGameLoops();});
  resizeAll();applyRoute();rebindGameLoop();
  // E2E probes observe the actual SDK frame / tick / draw / gameplay pipeline.
  function pointAt(aim,reach){return {x:+clamp(player.x+Math.cos(aim)*reach,0,CFG.world.width).toFixed(1),y:+clamp(player.y+Math.sin(aim)*reach,0,CFG.world.height).toFixed(1)};}
  let arenaCache=null;
  window.__sketchRpgDebug={
    source:{renderer:'BLOOM GameKit Renderer2D · WebGL1',input:'ActionState/createDOMInput + LocalInputPreview',time:'GameKit createDeadlineScheduler 30TPS + separate RAF capped 60FPS + InterpolationTimeline/PresentationRuntime',audio:'AudioPlayer'},
    analyze(raw){const s=makeShotData(raw);return {name:s.name,kind:s.kind,area:s.areaPx2,damage:s.baseDamage,cnn:s.cnn.prob,reference:s.reference};},
    sample:samplePoints,
    drawingState(){return {pointer:drawInput.pointer,points:drawInput.points.map(p=>({...p})),world:{...drawInput.world},center:drawInput.center};},
    summons(){return world.summons.map(q=>({id:q.id,owner:q.owner,kind:q.kind,temper:q.temper,name:q.name,x:q.x,y:q.y,r:q.r,hp:q.hp,maxHp:q.maxHp,power:q.power,targetId:q.targetId,shape:q.shape}));},
    summonSpecs(){return Object.fromEntries(Object.entries(SUMMON_SPECS).map(([k,q])=>[k,{name:q.name,role:q.role,anchored:q.anchored,taunt:q.taunt,hp:q.hp,ink:q.ink,damage:q.strike.damage,cooldownMs:q.strike.cooldownMs,range:q.strike.range}]));},
    summonLimit(){return SUMMON_LIMIT;},
    queuedShots(){return [...world.commands.filter(c=>c.type==='cast'),...world.castQueue,...world.casts].map(c=>c.shot);},
    // Test helper: a point `reach` units from the player along `aim` radians (the game itself places summons by drawn position).
    pointAt(aim,reach){return pointAt(aim,reach);},
    cast(type,aim=0,reach=120){const shot={...makeShotData(samplePoints(type)),...pointAt(aim,reach)};world.commands.push({type:'cast',shot});},
    // Command for an exact summon kind (the stroke itself is only a reference outline).
    castKind(kind,aim=0,reach=120,areaPower=.5,temper=0){const base=makeShotData(samplePoints(kind==='normal'?'line':kind)),spec=summonSpecOf(kind),shot={...base,kind,name:spec.name,color:art[kind]||art.normal,...pointAt(aim,reach),temper,areaPower,baseDamage:spec.damage(areaPower)};world.commands.push({type:'cast',shot});return shot.kind;},
    castStroke(raw,aim=0,reach=120){const shot={...makeShotData(raw),...pointAt(aim,reach)};world.commands.push({type:'cast',shot});return {kind:shot.kind,baseDamage:shot.baseDamage};},
    spellSpec(raw){const shot=makeShotData(raw);return {kind:shot.kind,castMs:castDurationMs(shot),recoveryMs:spellRecoveryMs(),areaPower:shot.areaPower,baseDamage:shot.baseDamage};},
    invulnerable(){player.invulMs=1e9;},
    lastShot(){return lastShot&&structuredClone(lastShot);},
    clearLastShot(){lastShot=null;},
    traitState(){return {temper:selectedTemper,summary:$('traitSummary').textContent,dockVisible:!!$('traitDock').offsetParent,choices:[...$('traitChoices').children].map(b=>({temper:+b.dataset.temper,on:b.classList.contains('on')})),faceMarks:TraitFace.marks(PERSONALITIES[selectedTemper].look).length};},
    personalities(){return PERSONALITIES.map(p=>({id:p.id,name:p.name,summary:p.temperament.summary(),multipliers:{...p.temperament}}));},
    mergeUnits(){return world.summons.map(s=>({id:s.id,kind:s.kind,tier:s.tier,hp:s.hp,maxHp:s.maxHp,r:s.r,power:s.power,x:s.x,y:s.y,owner:s.owner}));},
    mergeCommand(ids){world.commands.push({type:'merge',ids});},
    selectedUnits(){return [...selectedUnits];},
    recipes(){return {...FUSION_RECIPES};},
    presentedSummons(){return sceneViews.summon.map(q=>({id:q.id,x:q.x,y:q.y,kind:q.kind,hp:q.hp}));},
    renderedActors(){return [hostPlayer,guestPlayer].map(actor=>{const view=renderViewCache.get(actor);return {id:view?.actorId,x:view?.x,y:view?.y,castActive:!!view&&((view.castPreviewMs||0)>0||sceneViews.cast.some(c=>c.owner===view.actorId)),currentClip:view?.currentClip??null,currentExpression:view?.currentExpression??null,nextCastAtMs:actor.nextCastAtMs,screenX:view?(view.x-camera.x)*camera.zoom:null};});},
    previewInfo(){const now=performance.now(),model=mp.localPresentation&&mp.localPoseSource?mp.localPresentation.modelFor(mp.localPoseSource,now):null;return {enabled:!!mp.inputPreview,ready:mp.inputPreview?.ready??false,pending:mp.inputPreview?.pendingCount??0,metrics:mp.inputPreview?.metrics||null,x:model?.x??null,y:model?.y??null,castMs:model?.castMs??null,actorX:player.x,actorY:player.y,revision:mp.poseRevision};},
    movementState(){return {x:player.moveX,y:player.moveY,speed:CFG.player.walkSpeed};},rollState(){return {...player.dash};},slowState(){return {ratio:world.slowRatio,drawing:drawInput.pointer!==null,hitstopMs:world.hitstopMs};},
    advanceSession(){const result=gameSession.advance(SOLO_INPUT);if(result.status==='advanced')capturePresentation();return result;},pauseRendering(){pauseGameLoops();},resumeRendering(){resumeGameLoops();},pausePainting(){stopPainting();},resumePainting(){startPainting();},renderFrame(){loop.render();},selectGlyph(kind){selectGlyph(kind);},
    renderNow(){renderInterpolated();},
    // Test arena: wipe the field, switch every nest off, and put one enemy beside the player.
    combatFixture(kind='boss',x=player.x+200,y=player.y){world.enemies.length=0;world.summons.length=0;world.casts.length=0;world.castQueue.length=0;world.hazards.length=0;world.fields.length=0;for(const q of world.nests){q.on=false;q.done=true;}world.bossesDefeated=0;world.bossState.fill(0);return spawnEnemy(kind,x,y).id;},
    castQueueLength(){return world.castQueue.length;},unlockAll(){for(const k of UNLOCKABLE_KINDS)if(!world.unlocked.includes(k))world.unlocked.push(k);return world.unlocked.slice();},unlockState(){return {unlocked:world.unlocked.slice(),reward:world.reward&&{choices:world.reward.choices.slice()}};},castInProgress(){return world.casts.length;},effectsSnapshot(){return world.fields.map(f=>({kind:f.kind,ageMs:f.ageMs,lifeMs:f.lifeMs}));},

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
    // Wake nest `index` with its members at 1 HP and stunned; the hero stands 140 units west of it.
    // Wake the first wild nest of `zone` with at least three members: members at 1 HP and stunned, the hero 140 units from it on open ground.
    nestFixture(zone=0){world.enemies.length=0;world.summons.length=0;world.casts.length=0;world.castQueue.length=0;world.hazards.length=0;world.fields.length=0;for(const q of world.nests){q.on=false;q.done=true;}world.commands.length=0;const index=mapLayout.nests.findIndex(n=>n.kind==='wild'&&n.zone===zone&&n.members.length>=3),n=mapLayout.nests[index],s=world.nests[index];s.done=false;s.on=true;spawnNestMembers(index);for(const e of world.enemies){e.hp=1;e.stunMs=15000;}let px=n.x-140,py=n.y;for(const [dx,dy] of [[-140,0],[140,0],[0,-140],[0,140],[-200,0],[200,0]])if(!touchesObstacle(n.x+dx,n.y+dy,20)){px=n.x+dx;py=n.y+dy;break;}player.x=px;player.y=py;player.moveX=player.moveY=0;player.nextCastAtMs=world.clockMs;camera.x=player.x;camera.y=player.y;dropDraw();resetPresentation();capturePresentation();return world.enemies.length;},
    bossState(){const b=activeBoss();return {defeated:world.bossesDefeated,states:[...world.bossState],sealed:BOSS_PROFILES.map((_,i)=>bossSealed(i)),next:nextBossId(),sites:mapLayout.bossSites.map(q=>({...q})),profiles:BOSS_PROFILES.map(p=>({id:p.id,name:p.name,hp:p.hp,ruleText:p.ruleText(),best:p.bestKind(),factors:Object.fromEntries(SHAPE_KINDS.map(k=>[k,p.multiplier(k)]))})),active:b?{id:b.id,bossId:b.bossId,name:b.name,hp:b.hp,maxHp:b.maxHp,x:b.x,y:b.y}:null};},
    setBossesDefeated(n){world.bossesDefeated=n;world.bossState=world.bossState.map((_,i)=>i<n?2:0);},
    // Put boss n next to the player (stunned so only the damage rules are under test) and return its enemy id.
    // Put boss n next to the player (stunned so only the damage rules are under test; earlier bosses count as fallen) and return its enemy id.
    spawnBoss(n,sealed=false){world.enemies.length=0;world.summons.length=0;world.casts.length=0;world.castQueue.length=0;world.hazards.length=0;world.fields.length=0;for(const q of world.nests){q.on=false;q.done=true;}world.bossesDefeated=sealed?0:n;world.bossState=world.bossState.map((_,i)=>sealed?0:i<n?2:0);world.bossState[n]=1;const e=spawnEnemy('boss',player.x+190,player.y,n);e.stunMs=1e9;e.hp=e.maxHp;return e.id;},
    // One real damageEnemy call per source kind; returns the hit points removed.
    bossHit(id,kind,amount=100){const e=world.enemies.find(q=>q.id===id);const before=e.hp;damageEnemy(e,amount,e.x,e.y-18,'#be7757',kind);return before-e.hp;},
    bossHp(id){const e=world.enemies.find(q=>q.id===id);return e?{hp:e.hp,dead:e.dead}:null;},
    finishBoss(){const e=activeBoss();e.hp=1;damageEnemy(e,50,e.x,e.y,'#be7757',BOSS_PROFILES[e.bossId].bestKind());},
    mapState(){const m=mapLayout;return {seed:m.seed,attempt:m.attempt,hash:m.hash(),worldSeed:world.mapSeed,size:m.size,spawn:{x:m.spawn.x,y:m.spawn.y},bossSites:m.bossSites.map(q=>({...q})),sites:m.sites.map(q=>({kind:q.kind,x:q.x,y:q.y,zone:q.zone})),nests:m.nests.map(n=>({kind:n.kind,x:n.x,y:n.y,zone:n.zone,members:n.members.slice(),hpScale:n.hpScale,leash:n.leash})),report:{...m.report},counts:{props:m.props.length,decals:m.decals.length,obstacles:world.obstacles.length,trees:world.trees.length,houses:world.houses.length}};},
    mapHashFor(seed){const t=performance.now(),l=generateWorldMap(seed);return {hash:l.hash(),attempt:l.attempt,ms:performance.now()-t};},
    terrainBlocked(x,y,r){return touchesObstacle(x,y,r);},
    nestStates(){return world.nests.map((q,i)=>({i,on:q.on,cd:q.cd,done:q.done,alive:world.enemies.filter(e=>e.nest===i&&!e.dead).length,kind:mapLayout.nests[i].kind,zone:mapLayout.nests[i].zone,x:mapLayout.nests[i].x,y:mapLayout.nests[i].y,members:mapLayout.nests[i].members.length}));},
    spawnPoint(){return {x:mapLayout.spawn.x,y:mapLayout.spawn.y};},
    // Waypoints (every 2nd cell) of a walkable route from the hero to (x,y) that keeps 18 units from obstacles; null when none exists.
    pathTo(x,y){
      const g=mapLayout.grid,cols=g.cols,start=g.cellOf(player.x,player.y),goal=g.cellOf(x,y),sk=g.index(start.i,start.j),gk=g.index(goal.i,goal.j);
      const prev=new Int32Array(cols*g.rows).fill(-2);prev[sk]=-1;const queue=[sk];
      for(let q=0;q<queue.length;q++){const k=queue[q];if(k===gk)break;const ci=k%cols,cj=Math.floor(k/cols);
        for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){if(!di&&!dj)continue;const ni=ci+di,nj=cj+dj;if(!g.inside(ni,nj))continue;const nk=g.index(ni,nj);if(prev[nk]!==-2)continue;const c=g.center(ni,nj);if(touchesObstacle(c.x,c.y,18))continue;prev[nk]=k;queue.push(nk);}}
      if(prev[gk]===-2)return null;const cells=[];for(let k=gk;k!==-1;k=prev[k])cells.push(k);cells.reverse();
      return cells.filter((_,i)=>i%2===0||i===cells.length-1).map(k=>g.center(k%cols,Math.floor(k/cols)));
    },
    // A free standing point 60 units before a river/cliff cell in an axis direction, for walking-into-water tests.
    edgeProbe(wall){
      const g=mapLayout.grid,dirs=[['d',1,0],['a',-1,0],['s',0,1],['w',0,-1]];
      for(let j=4;j<g.rows-4;j+=3)for(let i=4;i<g.cols-4;i+=3){const k=g.index(i,j);if(g.wall[k]!==wall||g.road[k])continue;
        for(const [key,dx,dy] of dirs){const x=(i+.5)*g.cell-dx*60,y=(j+.5)*g.cell-dy*60;let free=true;for(let t=0;t<=24&&free;t+=6)if(touchesObstacle(x+dx*t,y+dy*t,16))free=false;
          if(free&&!touchesObstacle(x,y,16)&&!touchesObstacle(x-dx*40,y-dy*40,16))return {x,y,key,dx,dy,wallX:(i+.5)*g.cell,wallY:(j+.5)*g.cell};}}
      return null;
    },
    // Open ground for fixtures: the nearest point to the spawn with a free strip of 520 units to the east. fx/fy is a point on the far side of the map.
    arena(){
      if(!arenaCache||arenaCache.seed!==mapLayout.seed){
        const sp=mapLayout.spawn;let found={x:sp.x,y:sp.y};
        search:for(let ring=0;ring<=40;ring++){const R=ring*48;for(let a=0;a<(ring?16:1);a++){const t=a*Math.PI/8,x=Math.round(sp.x+Math.cos(t)*R),y=Math.round(sp.y+Math.sin(t)*R);let ok=true;for(let dx=-60;dx<=520&&ok;dx+=40)for(let dy=-130;dy<=130&&ok;dy+=65)if(touchesObstacle(x+dx,y+dy,28))ok=false;if(ok){found={x,y};break search;}}}
        arenaCache={seed:mapLayout.seed,x:found.x,y:found.y,fx:clamp(CFG.world.width-found.x,150,CFG.world.width-150),fy:clamp(CFG.world.height-found.y,150,CFG.world.height-150)};
      }
      return {x:arenaCache.x,y:arenaCache.y,fx:arenaCache.fx,fy:arenaCache.fy};
    },
    tickNestsNow(dt=CFG.tickMs){tickNests(dt);},
    setInk(value){player.ink=clamp(value,0,player.maxInk);},
    snapshot(){return {slowRatio:world.slowRatio,hitstopMs:world.hitstopMs,tick:gameSession.tick,player:{x:player.x,y:player.y,hp:player.hp,ink:player.ink},mode:world.mode,kills:world.kills,bossesDefeated:world.bossesDefeated,activeBoss:activeBoss()?{id:activeBoss().bossId,name:activeBoss().name,hp:activeBoss().hp,maxHp:activeBoss().maxHp}:null,enemyCount:world.enemies.filter(e=>!e.dead).length,summonCount:world.summons.length,castCount:world.casts.length,castQueueCount:world.castQueue.length,roll:{charges:player.dash.charges,rechargeMs:player.dash.rechargeMs,activeMs:player.dash.leftMs},modal:ui.modal,worldWidth:CFG.world.width,worldHeight:CFG.world.height,drawPhase:drawInput.pointer!==null?'drawing':'idle',lastResult:world.lastResult,rendererState:renderer.state};}
  };
