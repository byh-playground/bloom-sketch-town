  // Single owner for online membership, command ACKs, input prediction and rollback:
  // BLOOM GameKit RoomSession(mode=online, profile.mode=rollback).
  // Signaling uses public Nostr relays; RTC carries only GameKit's framed inputs,
  // membership control and validated join/recovery checkpoints. No live world broadcast.
  const GAMEKIT_SHA='72b09b260edf9650353017acb49c06873fe9f5a1';
  // Release identity also isolates peers whose cast/checkpoint contracts differ.
  const MP_NAMESPACE='sketch-town-coop-'+CFG.version;
  const MP_SIMULATION_VERSION='sketch-town-'+CFG.version+'-'+GAMEKIT_SHA;
  const MP_ROLLBACK_URL=GAMEKIT_URLS.rollback;
  const MP_TRANSPORT_URL=GAMEKIT_URLS.transport;
  const MP_SIMLOOP_URL=GAMEKIT_URLS.simloop;
  const MP_INTERPOLATION_URL=GAMEKIT_URLS.interpolation;
  const MP_SEED=0x31415,MP_INPUT_SIZE=2;
  const MP_PROFILE={mode:'rollback',tickRate:30,baseInputDelayTicks:1,rollbackWindowTicks:16,
    stateHistorySize:64,maxCatchupSteps:8,checksumInterval:30,maxSnapshotBytes:2*1024*1024,
    maxHistoryBytes:16*1024*1024,maxCommandBytes:4096,maxPendingCommands:64,
    adaptiveInputDelay:true,inputScheduling:'network',inputSafetyMarginMs:8,inputJitterMultiplier:2};
  const MP_TEXT=new TextEncoder(),MP_READER=new TextDecoder('utf-8',{fatal:true});
  const MP_EMPTY=new Uint8Array(MP_INPUT_SIZE);
  let mpAbort=null,mpGeneration=0;
  const mpStatus=message=>{$('mpProgress').textContent=message;};
  function mpUi(){
    const active=mp.connected||mp.connecting;
    $('multiplayerButton').textContent=mp.connected?`협동 · ${mp.role==='host'?'방장':'참가'}`:mp.connecting?'멀티 · 연결 중':'멀티 · 혼자';
    $('mpRoomDisplay').textContent=mp.code||'────';
    $('mpBadge').classList.toggle('off',!active);
    $('mpBadge').textContent=mp.connected?`<${mp.code}> ${mp.session?.status||'연결 중'} · ${mp.session?.profile?.tickRate||30} TPS · ${mp.session?.profile?.mode||'rollback'}`:mp.connecting?`<${mp.code}> 방 연결 중`:'';
    $('mpHost').disabled=active;$('mpJoin').disabled=active;
    $('mpLeave').textContent=active?'연결 종료':'취소';
  }
  const canonicalKeys=['nextId','seed','clockMs','kills','bossSpawned','bossDefeated',
    'hitstopMs','lastHitstopClockMs','hitFlashMs','slowRatio','screenTextMs','screenText',
    'effectShakeMs','mode','deathMs','regionKills','gates'];
  const canonicalArrays=['enemies','projectiles','hazards','casts','pickups','fields','castQueue'];
  function encodeState(){
    const worldState={};for(const key of canonicalKeys)worldState[key]=world[key];
    for(const name of canonicalArrays){worldState[name]=name==='projectiles'?world.projectiles.map(p=>({...p,hitAt:[...p.hitAt]})):world[name];}
    const state={version:CFG.version,world:worldState,actors:[hostPlayer,guestPlayer].map(a=>({...a,dash:{...a.dash}})),
      // Only participant presence, not browser/connection state, influences game physics.
      shared:mp.shared};
    return MP_TEXT.encode(JSON.stringify(state));
  }
  function validateState(snapshot){
    try{if(snapshot.byteLength<20||snapshot.byteLength>MP_PROFILE.maxSnapshotBytes)return false;
      const data=JSON.parse(MP_READER.decode(snapshot));if(data.version!==CFG.version||!data.world||!Array.isArray(data.actors)||data.actors.length!==2)return false;
      const w=data.world;
      if(!Number.isSafeInteger(w.nextId)||w.nextId<1||!Number.isSafeInteger(w.seed)||w.seed<0||!Number.isFinite(w.clockMs)||w.clockMs<0)return false;
      for(const name of canonicalArrays)if(!Array.isArray(w[name])||w[name].length>({enemies:75,projectiles:65,hazards:150,casts:8,pickups:120,fields:350,castQueue:8}[name]))return false;
      // Recovery must preserve the released direction; missing/invalid aim is not an old-schema fallback.
      for(const name of ['casts','castQueue'])if(w[name].some(c=>!validShotAim(c?.shot?.aim)))return false;
      if(!Array.isArray(w.regionKills)||w.regionKills.length!==3||w.regionKills.some(n=>!Number.isSafeInteger(n)||n<0)||!w.gates||GATES.some(g=>!w.gates[g.id]||typeof w.gates[g.id].open!=='boolean'||!Number.isFinite(w.gates[g.id].openedAtMs)||w.gates[g.id].openedAtMs<0||!Array.isArray(w.gates[g.id].stroke)||w.gates[g.id].open&&!validGateStroke(g,w.gates[g.id].stroke)))return false;
      for(const a of data.actors)if(!validProfile(a)||!Number.isFinite(a.ink)||a.ink<0||a.ink>derivedStats(a.investments).maxInk+1e-6||!Number.isFinite(a.inkDelayMs)||a.inkDelayMs<0||a.inkDelayMs>750||!a||!Number.isFinite(a.x)||!Number.isFinite(a.y)||!Number.isFinite(a.hp)||!a.dash||!Number.isFinite(a.dash.charges))return false;
      if(typeof data.shared!=='boolean')return false;
      return true;
    }catch{return false;}
  }
  function loadState(snapshot){
    if(!validateState(snapshot))throw new Error('부적합한 스케치 타운 롤백 체크포인트');
    const data=JSON.parse(MP_READER.decode(snapshot));
    for(const key of canonicalKeys)world[key]=data.world[key];
    for(const name of canonicalArrays)world[name]=name==='projectiles'
      ?data.world[name].map(p=>({...p,hitAt:new Map(p.hitAt)}))
      :data.world[name];
    for(const [i,source] of data.actors.entries()){
      const target=i===0?hostPlayer:guestPlayer;Object.assign(target,source);target.dash={...source.dash};
    }
    mp.shared=data.shared;
    // Presentation-only state is not part of rollback or canonical checkpoint costs.
    clearVisualEffects();world.rollMarks.length=0;world.rollTarget=null;
    mp.poseReset=true;
  }
  function validShotAim(aim){return Number.isFinite(aim)&&aim>=-Math.PI&&aim<=Math.PI;}
  function normalizeCommand(cmd){
    if(cmd.type==='cast'&&Array.isArray(cmd.shot?.shape)&&cmd.shot.shape.length){
      const s=cmd.shot;
      if(!validShotAim(s.aim))return null;
      // Preserve the released radians exactly, rather than re-aiming or quantizing at submission/replay.
      return {type:'cast',shot:{kind:s.kind,name:s.name,color:s.color,aim:s.aim,baseDamage:+s.baseDamage.toFixed(3),
        areaPower:+s.areaPower.toFixed(5),impact:+s.impact.toFixed(5),pen:+s.pen.toFixed(5),
        geo:{length:+s.geo.length.toFixed(3)},
        shape:s.shape.filter((_,i)=>i%Math.max(1,Math.ceil(s.shape.length/28))===0).slice(0,28).map(p=>({x:+p.x.toFixed(2),y:+p.y.toFixed(2)}))}};
    }
    if(cmd.type==='rollVector'){
      const {dx,dy,distance}=cmd,magnitude=hypot(dx,dy);
      if(!Number.isFinite(magnitude)||magnitude<.00001||!Number.isFinite(distance))return null;
      return {type:'roll',dx:Math.round(dx/magnitude*10000)/10000,dy:Math.round(dy/magnitude*10000)/10000,
        distance:Math.round(clamp(distance,0,rollMaxDistance())*100)/100};
    }
    if(cmd.type==='invest'&&STAT_DEFS.some(s=>s.id===cmd.id))return {type:'invest',id:cmd.id};
    if(cmd.type==='redistribute')return {type:'redistribute'};
    if(cmd.type==='profile'&&validProfile(cmd.profile))return {type:'profile',profile:cmd.profile};
    if(cmd.type==='gate'&&gateOf(cmd.id)&&validGateStroke(gateOf(cmd.id),cmd.points))return {type:'gate',id:cmd.id,points:cmd.points};
    return null;
  }
  function encodeLocalCommand(cmd){const value=normalizeCommand(cmd);if(!value)return null;
    const payload=MP_TEXT.encode(JSON.stringify(value));return payload.length<=MP_PROFILE.maxCommandBytes?payload:null;}
  function performNetCommand(actor,raw){
    let command;try{if(raw.length>MP_PROFILE.maxCommandBytes)return;command=JSON.parse(MP_READER.decode(raw));}catch{return;}
    if(command?.type==='roll'){
      const {dx,dy,distance}=command,len=hypot(dx,dy);
      if(!Number.isFinite(len)||len<.96||len>1.04||!Number.isFinite(distance)||distance<1||distance>rollMaxDistance()+.01)return;
      executeRollVector(actor,dx,dy,distance);
    }else if(command?.type==='invest')invest(actor,command.id);
    else if(command?.type==='redistribute')redistribute(actor);
    else if(command?.type==='profile'){if(restoreProfile(actor,command.profile)&&actor===player)mp.profileReady=true;}
    else if(command?.type==='gate'&&world.mode==='playing'&&actor.hp>0&&!actor.koMs)completeGate(actor,command.id,command.points);
    else if(command?.type==='cast'){
      const shot=command.shot;
      if(!shot||!validShotAim(shot.aim)||!['normal',...glyphKinds].includes(shot.kind)||!Number.isFinite(shot.baseDamage)||shot.baseDamage<0||shot.baseDamage>250||!Number.isFinite(shot.areaPower)||shot.areaPower<0||shot.areaPower>1.6||!Number.isFinite(shot.geo?.length)||shot.geo.length<0||shot.geo.length>3500||!Array.isArray(shot.shape)||shot.shape.length<2||shot.shape.length>28||shot.shape.some(p=>!Number.isFinite(p?.x)||!Number.isFinite(p?.y)||Math.abs(p.x)>150||Math.abs(p.y)>150))return;
      withActor(actor,()=>submitSpell(shot));
    }
  }
  const inputAudit={submitted:[],executed:[]};
  const multiplayerAdapter={
    save:encodeState,load:loadState,validateSnapshot:validateState,
    applyMembership({players,reason}){
      const nextShared=players.length>=2;
      // All members receive the same admission boundary, independent of UI role.
      mp.shared=nextShared;
      if(reason!=='initial'){mp.poseReset=true;world.rollMarks.length=0;}
    },
    step(context){
      const old=resimulatingGame;resimulatingGame=Boolean(context.resimulating||context.recovering||context.replaying||context.synctesting);
      try{
        for(const frame of context.inputs){const actor=frame.playerId===mp.ownerId?hostPlayer:guestPlayer;
          readMovementInput(actor,frame.input);
          for(const command of frame.commands){
            inputAudit.executed.push({playerId:frame.playerId,sequence:command.sequence,tick:context.tick,executeTick:command.executeTick,replay:resimulatingGame});
            if(inputAudit.executed.length>128)inputAudit.executed.shift();
            performNetCommand(actor,command.payload);
          }
        }
        tick(CFG.tickMs);
      }finally{resimulatingGame=old;}
    }
  };
  function onMultiplayerEvent(event){
    mp.stats.events=(mp.stats.events||0)+1;
    if(event.type==='input-submitted'&&event.commands.length){
      inputAudit.submitted.push({timeMs:performance.now(),commands:event.commands,schedule:event.schedule});
      if(inputAudit.submitted.length>64)inputAudit.submitted.shift();
    }
    if(event.type==='rollback'||event.type==='recovered') {
      mp.previewNeedsReset=true;mp.inputPreview?.clear();
      mp.poseReset=true;mp.poseRevision++;
      if(event.type==='rollback')mp.stats.rollbacks++;
      else mp.stats.recoveries++;
    }
    if(event.type==='reconciled'){
      mp.stats.reconciled=(mp.stats.reconciled||0)+1;
      capturePresentation();
    }
    if(event.type==='membership-committed'){
      mp.shared=mp.session?.players?.length>=2;
      mp.ready=mp.shared;
      mp.poseReset=true;mp.poseRevision++;mp.previewNeedsReset=true;mp.inputPreview?.clear();
      mpStatus(mp.shared?'참가 승인 완료 · 30 TPS 롤백 협동 시작':'현재 혼자 방을 지키는 중 · 참가자를 기다립니다.');
      if(mp.shared){if(mp.role==='join'&&mp.pendingProfile){world.commands.push({type:'profile',profile:mp.pendingProfile});mp.pendingProfile=null;}goRoute('play');}
      mpUi();
    }
    if(event.type==='peer-interrupted'||event.type==='peer-timeout'||event.type==='peer-disconnected')mpStatus('네트워크 연결 중단 · RoomSession 복구 대기 중');
    if(event.type==='failed'||event.type==='membership-failed'||event.type==='desync-unrecoverable'||event.type==='partition-failed'){
      mpStatus('롤백 동기화 중단: '+(event.reason||event.type)+' · 명시적으로 방을 나가세요.');
      console.error('[Sketch Town rollback]',event);
    }
  }
  function cleanupMultiplayer(){
    const session=mp.session,room=mp.room;
    mp.session=null;mp.room=null;mp.connected=false;mp.ready=false;mp.connecting=false;
    mp.shared=false;mp.localId=null;mp.ownerId=null;disposeInputPreview();
    try{session?.close();}catch(e){console.warn('[Sketch Town] session cleanup',e);}
    try{room?.close();}catch(e){console.warn('[Sketch Town] room cleanup',e);}
    if(mpAbort){mpAbort.abort();mpAbort=null;}
  }
  async function mpConnect(role){
    if(mp.connected||mp.connecting)return;
    const code=$('mpRoomInput').value.trim();if(!/^\d{4}$/.test(code)){mpStatus('방 번호는 숫자 네 자리여야 합니다.');return;}
    mp.pendingProfile=profileOf(player);mp.profileReady=role==='host';mp.role=role;mp.code=code;mp.connecting=true;mpAbort=new AbortController();const generation=++mpGeneration;mpUi();
    try{
      mpStatus('고정 BLOOM GameKit 롤백·전송·보간 모듈 로딩 중…');
      const [rollback,transport,simloop,interpolation]=await Promise.all([import(MP_ROLLBACK_URL),import(MP_TRANSPORT_URL),import(MP_SIMLOOP_URL),import(MP_INTERPOLATION_URL)]);
      if(typeof rollback.createRoomSession!=='function'||typeof transport.createNostrDynamicRoom!=='function'||typeof simloop.LocalInputPreview!=='function'||typeof interpolation.PresentationRuntime!=='function')throw new Error('GameKit 모듈 공개 API 불일치');
      if(generation!==mpGeneration)return;
      mpStatus(role==='host'?'공개 Nostr 신호망에 방을 여는 중…':'동일한 방 번호의 참가자를 찾는 중…');
      const room=await transport.createNostrDynamicRoom({role,room:code,namespace:MP_NAMESPACE,maxPlayers:2,
        signal:mpAbort.signal,timeoutMs:60000,peerTimeoutMs:20000,
        rtcConfig:{iceServers:[{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}]},
        onStatus:s=>{if(generation!==mpGeneration)return;if(s.type==='signal-error'||s.type==='peer-failed')mpStatus('P2P 연결 문제: '+String(s.reason||s.message||s.type));}});
      if(generation!==mpGeneration){room.close();return;}
      mp.room=room;mp.localId=room.localPlayerId;mp.ownerId=room.coordinatorId;mp.connected=true;
      mp.role=role;mp.connecting=false;mp.shared=false;mp.ready=false;
      player=role==='host'?hostPlayer:guestPlayer;
      const session=rollback.createRoomSession({mode:'online',room,simulationVersion:MP_SIMULATION_VERSION,
        seed:MP_SEED,inputSize:MP_INPUT_SIZE,profile:MP_PROFILE,adapter:multiplayerAdapter,
        membership:{maxPlayers:2,maxCatchupSteps:8},roomOwnerId:mp.ownerId,
        onEvent:onMultiplayerEvent});
      if(session.profile.mode!=='rollback'||session.profile.tickRate!==30)throw new Error('RoomSession 30TPS rollback 설정 검증 실패');
      mp.session=session;gameSession=session;
      initializeInputPreview(simloop,interpolation);
      mp.poseRevision++;mp.poseReset=true;mp.poseSequence=0;
      resetPresentation();rebindGameLoop();
      mp.ready=mp.shared;
      if(role==='join'&&mp.shared&&mp.pendingProfile){world.commands.push({type:'profile',profile:mp.pendingProfile});mp.pendingProfile=null;}
      mpStatus(mp.shared?'롤백 협동 시작':'방이 준비되었습니다 · 다른 참가자를 기다립니다.');
      mpUi();
      if(role==='join'&&mp.shared)goRoute('play');
    }catch(e){if(generation!==mpGeneration)return;
      cleanupMultiplayer();mp.role='solo';player=hostPlayer;mp.code='';gameSession=createSoloSession();
      rebindGameLoop();mpUi();mpStatus('연결 실패: '+String(e?.message||e));console.error('[Sketch Town RoomSession]',e);
    }
  }
  $('mpHost').addEventListener('click',()=>{
    if(!/^\d{4}$/.test($('mpRoomInput').value)){
      const rnd=new Uint32Array(1);crypto.getRandomValues(rnd);$('mpRoomInput').value=String(rnd[0]%10000).padStart(4,'0');
    }
    mpConnect('host');
  });
  $('mpJoin').addEventListener('click',()=>mpConnect('join'));
  $('mpLeave').addEventListener('click',async()=>{
    if(mp.connected||mp.connecting){
      $('mpLeave').disabled=true;mpStatus('참가자 목록에서 나가는 중…');let timeout;
      try{if(mp.session)await Promise.race([mp.session.leave(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('참가자 정리 시간 초과')),5000);})]);}
      catch(error){console.warn('[Sketch Town departure]',error.message);}
      finally{clearTimeout(timeout);++mpGeneration;cleanupMultiplayer();location.reload();}
      return;
    }
    goRoute('play');
  });
  $('mpCopy').addEventListener('click',async()=>{
    if(!mp.code)return;try{await navigator.clipboard.writeText(mp.code);mpStatus('방 번호 복사 완료');}
    catch{mpStatus('방 번호 '+mp.code+' · 직접 입력해 주세요');}
  });
  window.addEventListener('pagehide',cleanupMultiplayer);
  mpUi();
  Object.assign(window.__sketchRpgDebug,{
    multiplayerState(){return {role:mp.role,connected:mp.connected,ready:mp.ready,code:mp.code,
      gamekitSHA:GAMEKIT_SHA,namespace:MP_NAMESPACE,simulationVersion:MP_SIMULATION_VERSION,inputHz:CFG.inputHz,inputScheduling:mp.session?.profile.inputScheduling,
      sessionMode:mp.session?.profile.mode||null,tickRate:mp.session?.profile.tickRate||30,previewEnabled:!!mp.inputPreview,
      tick:mp.session?.tick??gameSession.tick,confirmedTick:mp.session?.confirmedTick??null,
      players:mp.session?.players.length||1,shared:mp.shared,network:mp.session?.metrics||null,stats:{...mp.stats},
      host:{x:hostPlayer.x,y:hostPlayer.y,hp:hostPlayer.hp,moveX:hostPlayer.moveX,moveY:hostPlayer.moveY},guest:{x:guestPlayer.x,y:guestPlayer.y,hp:guestPlayer.hp}};},
    inputAudit(){return structuredClone(inputAudit);},
    stateHash(tick){return mp.session?.getStateHash(tick);},
    canonicalBytes(){return encodeState().length;},
    canonicalSnapshot(){return encodeState();},
    canonicalRestore(bytes){loadState(bytes);},
    canonicalStep(inputs=[],resimulating=false){multiplayerAdapter.step({tick:gameSession.tick,inputs,resimulating});},
    encodeNetCommand(cmd){return encodeLocalCommand(cmd);},
    encodeCastForTest(kind,aim=0){const payload=encodeLocalCommand({type:'cast',shot:{...makeShotData(samplePoints(kind)),aim}});return payload?Array.from(payload):null;},
    adapter(){return multiplayerAdapter;}
  });
