  const actions=new ActionState(),gesture={drawId:null,points:[],length:0,startMs:0,trainingId:null,trainingPoints:[],lastCombatStroke:null};
  let player={x:475,y:735,vx:0,vy:0,moveX:0,moveY:0,faceX:1,faceY:0,r:CFG.player.radius,hp:CFG.player.hp,maxHp:CFG.player.hp,level:1,xp:0,xpNext:65,ink:100,inkDelayMs:0,investments:{...savedProfile.investments},power:1,dash:{leftMs:0,durationMs:0,elapsedMs:0,distance:0,charges:2,rechargeMs:0,dirX:1,dirY:0,originX:475,originY:735,rollMarkMs:0},nextCastAtMs:0,invulMs:0,healMsgMs:0,hits:0};
  restoreProfile(player,savedProfile);
  const hostPlayer=player;
  const guestPlayer={...hostPlayer,investments:emptyInvestments(),level:1,xp:0,xpNext:65,x:536,y:756,hp:hostPlayer.hp,maxHp:hostPlayer.maxHp,dash:{...hostPlayer.dash,originX:536,originY:756},nextCastAtMs:0,hits:0};
  applyInvestments(guestPlayer);
  const mp={role:'solo',connected:false,ready:false,connecting:false,shared:false,room:null,session:null,code:'',localId:null,ownerId:null,interpolation:null,poseRevision:0,poseSequence:0,poseReset:true,stats:{rollbacks:0,recoveries:0,commands:0,advanced:0}};
  function actors(){return mp.shared?[hostPlayer,guestPlayer]:[hostPlayer];}
  function actorId(actor){return actor===guestPlayer?'b':'a';}
  function actorOf(id){return id==='b'?guestPlayer:hostPlayer;}
  function withActor(actor,fn){const before=player;player=actor;try{return fn();}finally{player=before;}}
  const camera={x:0,y:0,zoom:1};
  const world={regionKills:[0,0,0],gates:{door:{open:false,stroke:[],owner:null,openedAtMs:0},bridge:{open:false,stroke:[],owner:null,openedAtMs:0}},obstacles:[],grid:new Map(),decals:[],trees:[],houses:[],enemies:[],projectiles:[],hazards:[],casts:[],particles:[],floaters:[],pickups:[],fields:[],commands:[],castQueue:[],rollMarks:[],rollTarget:null,nextId:1,seed:0x31415,clockMs:0,kills:0,bossSpawned:false,bossDefeated:false,hitstopMs:0,lastHitstopClockMs:-1000,hitFlashMs:0,slowRatio:1,screenTextMs:0,screenText:'',effectShakeMs:0,mode:'playing',deathMs:0,lastResult:null};
  const audioRecipes={
    draw:{category:'sfx',layers:[{kind:'tone',type:'sine',hz:610,end:910,ms:90,gain:.3}]},
    throw:{category:'sfx',layers:[{kind:'tone',type:'triangle',hz:410,end:950,ms:128,gain:.42},{kind:'noise',hz:2100,ms:65,gain:.17}]},
    hit:{category:'sfx',layers:[{kind:'tone',type:'triangle',hz:225,end:61,ms:133,gain:.50},{kind:'noise',hz:1180,ms:83,gain:.36}]},
    kill:{category:'sfx',layers:[{kind:'tone',type:'triangle',hz:310,end:77,ms:190,gain:.52},{kind:'tone',type:'sine',hz:380,end:760,ms:208,gain:.38},{kind:'noise',hz:2150,ms:125,gain:.28}]},
    bounce:{category:'sfx',layers:[{kind:'tone',type:'sine',hz:620,end:860,ms:87,gain:.20},{kind:'noise',hz:1900,ms:52,gain:.15}]},
    dash:{category:'sfx',layers:[{kind:'noise',hz:1200,ms:128,gain:.31}]},
    land:{category:'sfx',layers:[{kind:'tone',type:'triangle',hz:180,end:78,ms:110,gain:.26},{kind:'noise',hz:420,ms:76,gain:.13}]},
    level:{category:'sfx',layers:[{kind:'tone',type:'sine',hz:360,end:920,ms:310,gain:.42}]},
    select:{category:'sfx',layers:[{kind:'tone',type:'sine',hz:650,end:510,ms:70,gain:.21}]},
  };
  const sound=new AudioPlayer({...audioDefaults,volume:.67,maxVoices:14,categories:{sfx:{volume:1,max:14,gapMs:18,priority:0}},sounds:audioRecipes});
  sound.setMuted(true);let audioOn=false;
  let resimulatingGame=false;
  function sfx(kind,strength=1){if(audioOn&&!resimulatingGame)sound.play(kind,strength);}

  const rand=()=>{world.seed=(Math.imul(world.seed,1664525)+1013904223)>>>0;return world.seed/4294967296;};
  const cellSize=160,gridKey=(x,y)=>`${Math.floor(x/cellSize)},${Math.floor(y/cellSize)}`;
  function addObstacle(o){world.obstacles.push(o);for(let gx=Math.floor((o.x-o.r)/cellSize);gx<=Math.floor((o.x+o.r)/cellSize);gx++)for(let gy=Math.floor((o.y-o.r)/cellSize);gy<=Math.floor((o.y+o.r)/cellSize);gy++){const key=`${gx},${gy}`;if(!world.grid.has(key))world.grid.set(key,[]);world.grid.get(key).push(o);}}
  function circleBounds(x,y,r){return x>=r&&y>=r&&x<=CFG.world.width-r&&y<=CFG.world.height-r;}
  function touchesObstacle(x,y,r){if(!circleBounds(x,y,r)||gateBlocked(x,y,r)||mapTerrainBlocked(x,y,r))return true;const list=world.grid.get(gridKey(x,y))||[];for(const o of list){if(hypot(o.x-x,o.y-y)<o.r+r)return true;}return false;}
  function moveCollider(e,dx,dy,r){if(!touchesObstacle(e.x+dx,e.y,r))e.x+=dx;if(!touchesObstacle(e.x,e.y+dy,r))e.y+=dy;}
  function createWorld(){
    // Deterministic generated props. No hand-authored image assets, texture uploads, or runtime network.
    for(const h of [{x:275,y:540,w:173,h:127,type:'house'},{x:575,y:462,w:167,h:119,type:'library'},{x:360,y:960,w:162,h:112,type:'shop'}]){world.houses.push(h);addObstacle({x:h.x,y:h.y+16,r:h.w*.46,kind:'house'});}
    populateRegionMap();
    spawnRegion(0);
  }
  const enemyDefs={chaser:{r:19,hp:55,speed:89,damage:11,color:'#a57673',name:'종이 사냥꾼',xp:18},spitter:{r:20,hp:48,speed:65,damage:9,color:'#8e8ba8',name:'잉크 투척수',xp:21},charger:{r:23,hp:85,speed:72,damage:18,color:'#c1966b',name:'낙서 돌격수',xp:27},boss:{r:56,hp:580,speed:55,damage:23,color:'#8d688e',name:'잉크 감시자',xp:190}};
  function spawnEnemy(kind,x,y){const d=enemyDefs[kind],id=world.nextId++;const e={id,kind,region:regionAt(x),x,y,r:d.r,hp:d.hp,maxHp:d.hp,vx:0,vy:0,ageMs:0,aiMs:0,windupMs:0,attackMs:400+rand()*550,chargeMs:0,chargeDX:0,chargeDY:0,hitMs:0,burnMs:0,burnTickMs:400,burnAmount:0,wetMs:0,stunMs:0,dead:false};world.enemies.push(e);return e;}
  function announce(text,time=1700){world.screenText=text;world.screenTextMs=time;if(!resimulatingGame){$('screenMessage').textContent=text;$('screenMessage').classList.add('show');}}
  createWorld();

  // The canonical actor movement kernel is shared by authority and GameKit's detached preview fork.
  // Neither helper reads input devices, queues effects, changes world simulation, or plays audio.
  function refreshActorRoll(actor,dt){const d=actor.dash;if(d.charges>=CFG.player.roll.capacity){d.rechargeMs=0;return;}
    d.rechargeMs-=dt;while(d.rechargeMs<=0&&d.charges<CFG.player.roll.capacity){d.charges++;if(d.charges<CFG.player.roll.capacity)d.rechargeMs+=CFG.player.roll.rechargeMs;else d.rechargeMs=0;}}
  function startActorRoll(actor,dx,dy,distance,mode=world.mode){const d=actor.dash,len=hypot(dx,dy);
    if(mode!=='playing'||actor.koMs>0||d.charges<1||d.leftMs>0||!Number.isFinite(len)||len<.00001||!Number.isFinite(distance)||distance<12)return false;
    dx/=len;dy/=len;distance=clamp(distance,0,actor.r*2*CFG.player.roll.rangeDiameters);
    const duration=clamp(distance/CFG.player.roll.travelSpeed*1000,CFG.player.roll.durationMinMs,CFG.player.roll.durationMaxMs);
    d.originX=actor.x;d.originY=actor.y;d.dirX=dx;d.dirY=dy;d.distance=distance;
    d.durationMs=duration;d.elapsedMs=0;d.leftMs=duration;d.rollMarkMs=0;
    if(d.charges===CFG.player.roll.capacity)d.rechargeMs=CFG.player.roll.rechargeMs;
    d.charges--;actor.faceX=dx;actor.faceY=dy;
    actor.invulMs=Math.max(actor.invulMs,CFG.player.roll.projectileInvulMs);
    return true;
  }
  function rollEase(t){return t+.10*Math.sin(Math.PI*t);}
  function stepActorRoll(actor,dt){
    if(actor.invulMs>0)actor.invulMs=Math.max(0,actor.invulMs-dt);
    refreshActorRoll(actor,dt);
    const d=actor.dash;if(d.leftMs<=0)return {mark:false,landed:false,blocked:false};
    const previous=clamp(d.elapsedMs/Math.max(1,d.durationMs),0,1);
    const next=clamp((d.elapsedMs+dt)/Math.max(1,d.durationMs),0,1);
    const distance=(rollEase(next)-rollEase(previous))*d.distance;
    const ox=actor.x,oy=actor.y;
    moveCollider(actor,d.dirX*distance,d.dirY*distance,actor.r);
    d.elapsedMs=Math.min(d.durationMs,d.elapsedMs+dt);d.leftMs=Math.max(0,d.durationMs-d.elapsedMs);
    d.rollMarkMs-=dt;
    const mark=d.rollMarkMs<=0;
    if(mark)d.rollMarkMs+=33;
    const blocked=hypot(actor.x-ox,actor.y-oy)<distance*.42&&distance>1.7;
    if(blocked){d.leftMs=0;d.elapsedMs=d.durationMs;}
    return {mark,landed:d.leftMs===0,blocked};
  }
  function readMovementInput(actor,input){
    const x=(input[0]>127?input[0]-256:input[0])/127,y=(input[1]>127?input[1]-256:input[1])/127;
    const length=Math.max(1,hypot(x,y));actor.moveX=x/length;actor.moveY=y/length;
  }
  function stepActorMovement(actor,dt){
    const rollingMs=actor.dash.leftMs,effect=stepActorRoll(actor,dt);
    const walkMs=rollingMs>0?Math.max(0,dt-rollingMs):dt;
    if(walkMs>0&&(actor.moveX||actor.moveY)){
      const length=hypot(actor.moveX,actor.moveY);actor.faceX=actor.moveX/length;actor.faceY=actor.moveY/length;
      moveCollider(actor,actor.moveX*CFG.player.walkSpeed*walkMs/1000,actor.moveY*CFG.player.walkSpeed*walkMs/1000,actor.r);
    }
    return effect;
  }
  function addRollMark(x,y){const d=player.dash;world.rollMarks.push({x,y,dirX:d.dirX,dirY:d.dirY,phase:d.durationMs?d.elapsedMs/d.durationMs:0,lifeMs:320,maxLifeMs:320});if(world.rollMarks.length>11)world.rollMarks.shift();}
  function updatePlayer(dt){
    if(player.koMs>0){player.koMs=Math.max(0,player.koMs-dt);if(!player.koMs){reviveActor(player);}return;}
    const effect=stepActorMovement(player,dt);
    if(effect.mark)addRollMark(player.x,player.y);
    if(effect.blocked)burst(player.x,player.y,'#a4aaa0',5,26);
    if(effect.landed){addRollMark(player.x,player.y);sfx('land');}
    if(hypot(player.x-505,player.y-736)<100){player.healMsgMs+=dt;if(player.healMsgMs>580&&player.hp<player.maxHp){player.hp=Math.min(player.maxHp,player.hp+1);player.healMsgMs=0;}}
  }
  function rollMaxDistance(){return player.r*2*CFG.player.roll.rangeDiameters;}
  function beginRoll(x,y){const dx=x-player.x,dy=y-player.y,dist=hypot(dx,dy);
    if(!startActorRoll(player,dx,dy,dist))return false;
    const d=player.dash;
    world.rollTarget={x:player.x+d.dirX*d.distance,y:player.y+d.dirY*d.distance,lifeMs:340,maxLifeMs:340};
    addRollMark(player.x,player.y);burst(player.x,player.y,'#638e79',6,47);sfx('dash');return true;
  }
  // Shared execution contract: offline input and RoomSession replay both call this exact function.
  // A RollVector is captured once by the GameKit input collector, never recomputed on a later tick.
  function executeRollVector(actor,dx,dy,distance){
    const length=hypot(dx,dy),maxDistance=actor.r*2*CFG.player.roll.rangeDiameters;
    if(!Number.isFinite(length)||length<.00001||!Number.isFinite(distance)||distance<12||distance>maxDistance+.01)return false;
    return withActor(actor,()=>beginRoll(actor.x+dx/length*distance,actor.y+dy/length*distance));
  }
  function takeDamage(amount,fromX,fromY){if(player.invulMs>0||world.mode!=='playing')return false;player.hp=Math.max(0,player.hp-Math.round(amount));player.invulMs=520;player.hits++;world.effectShakeMs=180;floating(player.x,player.y-32,`-${Math.round(amount)}`,'#bb604f');burst(player.x,player.y,'#d07962',10,83);sfx('hit');if(fromX!=null){const d=hypot(player.x-fromX,player.y-fromY)||1;moveCollider(player,(player.x-fromX)/d*17,(player.y-fromY)/d*17,player.r);}if(player.hp<=0){if(!resimulatingGame&&player===(mp.role==='join'?guestPlayer:hostPlayer))dropDraw();if(mp.shared){player.koMs=1150;announce('동료의 잉크가 번졌다 · 잠시 뒤 부활!',1100);}else{world.mode='down';world.deathMs=1150;announce('먹물이 번졌다… 마을로 돌아갑니다',1100);}}return true;}
  function reviveActor(actor){withActor(actor,()=>{player.x=actor===guestPlayer?536:480;player.y=actor===guestPlayer?756:735;player.hp=Math.ceil(player.maxHp*.75);player.invulMs=1600;player.koMs=0;player.dash.leftMs=0;player.dash.charges=CFG.player.roll.capacity;player.dash.rechargeMs=0;player.nextCastAtMs=0;});}
  function revive(){player.x=480;player.y=735;player.hp=Math.ceil(player.maxHp*.75);player.invulMs=1600;player.dash.leftMs=0;player.dash.charges=CFG.player.roll.capacity;player.dash.rechargeMs=0;player.nextCastAtMs=0;world.hazards.length=0;world.projectiles.length=0;world.casts.length=0;world.castQueue.length=0;world.rollMarks.length=0;world.mode='playing';}
  function awardXp(value){player.xp+=value;while(player.xp>=player.xpNext){player.xp-=player.xpNext;player.level++;player.xpNext=Math.round(player.xpNext*1.32+10);announce(`레벨 ${player.level} · 강화 포인트 +1!`,1550);sfx('level');}}
  function nearestEnemy(range=900,x=player.x,y=player.y,excludeId=null){
    let nearest=null,best=range;
    for(const e of world.enemies){if(e.dead||e.id===excludeId)continue;const d=hypot(e.x-x,e.y-y);if(d<best){best=d;nearest=e;}}
    return nearest;
  }
  // Bounded presentation-only object pools. Canonical rollback save/load NEVER retains these objects.
  // Reuse an object only after its visible lifetime ends; increment generation so GameKit interpolation
  // does not join a new ink fragment onto the previous occupant's trajectory.
  const visualPools={particles:[],floaters:[],createdParticles:0,reusedParticles:0,returnedParticles:0,
    createdFloaters:0,reusedFloaters:0,returnedFloaters:0};
  function acquireVisual(kind){const particle=kind==='particle',cache=particle?visualPools.particles:visualPools.floaters;
    let item=cache.pop();if(item){visualPools[particle?'reusedParticles':'reusedFloaters']++;}
    else{item={_poseGeneration:0};visualPools[particle?'createdParticles':'createdFloaters']++;}
    item._poseGeneration++;return item;
  }
  function recycleVisual(item,kind){const particle=kind==='particle',cache=particle?visualPools.particles:visualPools.floaters;
    // No payload / geometry references survive a pool checkout. Caps prevent unbounded idle storage.
    item.text=undefined;item.color=undefined;item.kind=undefined;
    const cap=particle?CFG.maxParticles:30;
    if(cache.length<cap){cache.push(item);visualPools[particle?'returnedParticles':'returnedFloaters']++;}
  }
  function clearVisualEffects(){for(const item of world.particles)recycleVisual(item,'particle');world.particles.length=0;
    for(const item of world.floaters)recycleVisual(item,'floater');world.floaters.length=0;
  }
  function floating(x,y,text,color){if(resimulatingGame)return;
    if(world.floaters.length>=30)recycleVisual(world.floaters.shift(),'floater');
    const item=acquireVisual('floater');item.x=x;item.y=y;item.text=text;item.color=color;item.lifeMs=680;
    world.floaters.push(item);
  }
  // Visual effects never advance the canonical PRNG used by AI, item drops and spawning.
  let visualSeed=0x83ac2d17;const visualRand=()=>{visualSeed=(Math.imul(visualSeed,1103515245)+12345)>>>0;return visualSeed/4294967296;};
  function burst(x,y,color,count=8,speed=70){if(resimulatingGame)return;
    for(let i=0;i<count&&world.particles.length<CFG.maxParticles;i++){
      const a=(i/count)*Math.PI*2+(visualRand()-.5)*.4,s=speed*(.4+visualRand()*.9);
      const item=acquireVisual('particle');item.kind='spark';item.x=x;item.y=y;
      item.vx=Math.cos(a)*s;item.vy=Math.sin(a)*s;item.angle=0;item.segment=0;
      item.color=color;item.lifeMs=350+visualRand()*280;item.initialMs=610;item.r=1.4+visualRand()*2.8;
      world.particles.push(item);
    }
  }
  // Ink fragments are visual-only and use stable entity seeds, never the gameplay RNG.
  function tearEnemyInk(e){const count=e.kind==='boss'?25:10;
    for(let i=0;i<count&&world.particles.length<CFG.maxParticles;i++){
      const angle=(i/count)*Math.PI*2+(hashSketch(e.id,i,8)-.5)*.5;
      const speed=(e.kind==='boss'?148:95)*(.50+hashSketch(e.id,i,3)*.55);
      const item=acquireVisual('particle');item.kind='erasedStroke';
      item.x=e.x+(hashSketch(e.id,i,12)-.5)*e.r*.8;
      item.y=e.y+(hashSketch(e.id,i,15)-.5)*e.r*.8;
      item.vx=Math.cos(angle)*speed;item.vy=Math.sin(angle)*speed-22;
      item.angle=angle+.5;item.segment=4+hashSketch(e.id,i,18)*(e.kind==='boss'?19:10);
      item.color=enemyDefs[e.kind].color;item.lifeMs=480+hashSketch(e.id,i,20)*280;item.initialMs=760;item.r=1.5;
      world.particles.push(item);
    }
  }
  function damageEnemy(e,amount,x,y,color='#be7757'){if(e.dead)return 0;const d=Math.max(1,Math.round(amount));e.hp=Math.max(0,e.hp-d);e.hitMs=SKETCH.hitFlashMs;floating(x??e.x,y??e.y-32,`-${d}`,color);
    if(world.clockMs-world.lastHitstopClockMs>110){world.lastHitstopClockMs=world.clockMs;world.hitstopMs=Math.max(world.hitstopMs,e.kind==='boss'?64:43);world.hitFlashMs=155;world.effectShakeMs=Math.max(world.effectShakeMs,e.kind==='boss'?190:110);}
    // Radial scratch and high-contrast paper sparks at the real contact point.
    world.fields.push({kind:'impact',x:e.x,y:e.y-3,r:e.kind==='boss'?59:33,ageMs:0,lifeMs:260,color});
    burst(e.x,e.y,color,e.kind==='boss'?11:7,99);
if(e.hp<=0){e.dead=true;world.kills++;if(e.kind!=='boss')world.regionKills[e.region]++;burst(e.x,e.y,enemyDefs[e.kind].color,9,100);tearEnemyInk(e);sfx('kill');awardXp(enemyDefs[e.kind].xp);if(mp.shared){withActor(player===hostPlayer?guestPlayer:hostPlayer,()=>awardXp(enemyDefs[e.kind].xp));}if(e.kind!=='boss'){world.pickups.push({x:e.x,y:e.y,r:8,lifeMs:24000,kind:'ink',amount:1+Math.floor(rand()*3)});}else{world.bossDefeated=true;announce('잉크 감시자 격파 · 스케치 타운을 되찾았다!',3500);world.pickups.push({x:e.x,y:e.y,r:15,lifeMs:30000,kind:'ink',amount:24});}
      if(regionCleared(2)&&!world.bossSpawned){world.bossSpawned=true;spawnEnemy('boss',CFG.boss.x,CFG.boss.y);announce('고대 원형장에 잉크 감시자가 나타났다!',2600);}}
    else sfx('hit');return d;}

  function enemyProjectile(x,y,tx,ty,kind='ink',speed=260,damage=9){const dx=tx-x,dy=ty-y,m=hypot(dx,dy)||1;world.hazards.push({x,y,prevX:x,prevY:y,vx:dx/m*speed,vy:dy/m*speed,r:kind==='orb'?11:7,kind,color:kind==='orb'?'#9d729c':'#9f8fb1',damage,ageMs:0,lifeMs:2100});}
  function enemyAction(e){if(e.dead||world.mode!=='playing')return;const dx=player.x-e.x,dy=player.y-e.y,d=hypot(dx,dy)||1;
    if(e.attackType==='melee'){if(d<e.r+player.r+48)takeDamage(enemyDefs[e.kind].damage,e.x,e.y);burst(e.x+dx/d*20,e.y+dy/d*20,'#a87978',6,38);}
    else if(e.attackType==='charge'){e.chargeMs=e.kind==='boss'?510:390;e.chargeDX=dx/d;e.chargeDY=dy/d;}
    else if(e.attackType==='spit'){enemyProjectile(e.x,e.y,player.x,player.y,'ink',280,enemyDefs[e.kind].damage);}
    else if(e.attackType==='nova'){for(let i=0;i<12;i++){const a=i*Math.PI/6+world.clockMs*.0003;enemyProjectile(e.x,e.y,e.x+Math.cos(a)*130,e.y+Math.sin(a)*130,'orb',215,10);}burst(e.x,e.y,'#bb86b4',14,95);}
    e.attackType=null;}
  function moveEnemy(e,dt,dx,dy){const wet=e.wetMs>0?.56:1;moveCollider(e,dx*wet*dt/1000,dy*wet*dt/1000,e.r*.68);}
  function updateEnemies(dt){const previousActor=player;try{for(const e of world.enemies){if(e.dead)continue;
    if(mp.shared){const h=hypot(hostPlayer.x-e.x,hostPlayer.y-e.y),g=hypot(guestPlayer.x-e.x,guestPlayer.y-e.y);player=guestPlayer&&guestPlayer.koMs<=0&&g<h?guestPlayer:hostPlayer;if(hostPlayer.koMs>0&&guestPlayer.koMs<=0)player=guestPlayer;}e.ageMs+=dt;e.hitMs=Math.max(0,e.hitMs-dt);e.stunMs=Math.max(0,e.stunMs-dt);e.wetMs=Math.max(0,e.wetMs-dt);if(e.burnMs>0){e.burnMs=Math.max(0,e.burnMs-dt);e.burnTickMs-=dt;if(e.burnTickMs<=0){e.burnTickMs+=470;damageEnemy(e,e.burnAmount,e.x,e.y-13,art.flame);if(e.dead)continue;}}
      // Inactive far-off enemies never simulate AI, but status timers remain consistent.
      const dx=player.x-e.x,dy=player.y-e.y,d=hypot(dx,dy)||1;if(d>970&&e.kind!=='boss')continue;
      if(e.stunMs>0){moveCollider(e,e.vx*dt/1000,e.vy*dt/1000,e.r*.68);e.vx*=.85;e.vy*=.85;continue;}
      if(e.chargeMs>0){e.chargeMs=Math.max(0,e.chargeMs-dt);moveCollider(e,e.chargeDX*(e.kind==='boss'?490:570)*dt/1000,e.chargeDY*(e.kind==='boss'?490:570)*dt/1000,e.r*.67);if(hypot(player.x-e.x,player.y-e.y)<player.r+e.r+6){takeDamage(enemyDefs[e.kind].damage,e.x,e.y);e.chargeMs=0;}continue;}
      if(e.windupMs>0){e.windupMs-=dt;if(e.windupMs<=0){e.windupMs=0;enemyAction(e);}continue;}
      e.attackMs-=dt;
      if(e.kind==='chaser'){
        if(d>36)moveEnemy(e,dt,dx/d*enemyDefs.chaser.speed+e.vx,dy/d*enemyDefs.chaser.speed+e.vy);
        if(d<58&&e.attackMs<=0){e.attackMs=1030;e.windupMs=330;e.attackType='melee';}
      }else if(e.kind==='spitter'){
        if(d<220)moveEnemy(e,dt,-dx/d*enemyDefs.spitter.speed,-dy/d*enemyDefs.spitter.speed);
        else if(d>340)moveEnemy(e,dt,dx/d*enemyDefs.spitter.speed,dy/d*enemyDefs.spitter.speed);
        else if(Math.sin(world.clockMs*.001+e.id)>.7)moveEnemy(e,dt,-dy/d*enemyDefs.spitter.speed*.5,dx/d*enemyDefs.spitter.speed*.5);
        if(d<560&&e.attackMs<=0){e.attackMs=1630;e.windupMs=470;e.attackType='spit';}
      }else if(e.kind==='charger'){
        if(d<650&&d>80)moveEnemy(e,dt,dx/d*enemyDefs.charger.speed,dy/d*enemyDefs.charger.speed);
        if(d<460&&e.attackMs<=0){e.attackMs=2400;e.windupMs=650;e.attackType='charge';}
      }else if(e.kind==='boss'){
        if(d<760&&d>195)moveEnemy(e,dt,dx/d*enemyDefs.boss.speed,dy/d*enemyDefs.boss.speed);
        if(d<670&&e.attackMs<=0){e.attackMs=e.hp<e.maxHp*.52?1750:2350;e.windupMs=e.hp<e.maxHp*.52?520:700;e.attackType=e.aiMs%3===2?'charge':'nova';e.aiMs++;}
      }
      moveCollider(e,e.vx*dt/1000,e.vy*dt/1000,e.r*.68);e.vx*=Math.pow(.12,dt/1000);e.vy*=Math.pow(.12,dt/1000);
      // Entity-vs-hero separation, proportional to actual contact overlap; no position snap onto player.
      const separation=hypot(player.x-e.x,player.y-e.y);const overlap=player.r+e.r*.69-separation;
      if(overlap>0.1&&separation>.01)moveCollider(e,(e.x-player.x)/separation*overlap*.55,(e.y-player.y)/separation*overlap*.55,e.r*.68);
    }}finally{player=previousActor;} }
  // Actual attack rate: fast low-area lines, slower recognized drawings with longer ricochet persistence.
  function castDurationMs(shot){return shot.kind==='line'||shot.kind==='normal'?clamp(92+shot.geo.length*.050,90,150):clamp(255+Math.sqrt(Math.max(0,shot.areaPower))*165+shot.geo.length*.05,245,530);}
  function spellRecoveryMs(shot){return shot.kind==='line'||shot.kind==='normal'?40:185+Math.min(190,shot.areaPower*150);}
  function makeCast(shot){
    const duration=castDurationMs(shot);
    world.casts.push({id:world.nextId++,owner:actorId(player),shot,ageMs:0,durationMs:duration,x:player.x,y:player.y});
    player.nextCastAtMs=world.clockMs+duration+spellRecoveryMs(shot);
    showResult(`${shot.name} · ${shot.kind==='normal'?'빠른 단발':'지속 반사'} · 피해 ${Math.round(shot.baseDamage*player.power)}`,1450);sfx('draw');
  }
  function submitSpell(shot){if(player.hp<=0||player.koMs>0||world.castQueue.filter(c=>c.owner===actorId(player)).length>=3||!spendInk(player,spellInkCost(player,shot)))return false;world.castQueue.push({shot,owner:actorId(player)});return true;}
  function fireProjectile(c){
    const shot=c.shot,dx=Math.cos(shot.aim),dy=Math.sin(shot.aim);
    const special=shot.kind!=='normal'&&shot.kind!=='line',bulk=clamp(shot.areaPower,0,1);
    const bounces=special?Math.min(9,Math.max(3,3+Math.floor(bulk*4)+(shot.kind==='lightning'||shot.kind==='shuriken'?2:0)+(shot.kind==='starcircle'?2:0))):0;
    const speed=special?clamp(590-bulk*110+(shot.kind==='lightning'||shot.kind==='shuriken'?90:0),445,710):830;
    const radius=clamp(7+Math.sqrt(Math.max(0,bulk))*8,7,21);
    const p={id:world.nextId++,x:player.x+dx*27,y:player.y+dy*27,prevX:player.x,prevY:player.y,
      vx:dx*speed,vy:dy*speed,speed,angle:Math.atan2(dy,dx),shape:shot.shape,color:shot.color,kind:shot.kind,
      areaPower:shot.areaPower,baseDamage:shot.baseDamage*player.power,impact:shot.impact,pen:shot.pen,r:radius,
      hitAt:new Map(),bouncesLeft:bounces,bouncesTotal:bounces,bounceCount:0,lastHitId:null,
      state:'flight',targetId:null,orbitMs:0,orbitDurationMs:0,orbitCenter:null,orbitAngle:0,
      lifeMs:special?clamp(2750+bounces*440,3250,7900):840,ageMs:0};
    if(world.projectiles.length>=55)world.projectiles.shift();world.projectiles.push(p);
    burst(p.x,p.y,p.color,5,42);sfx('throw');
  }
  function tickCasts(dt){
    for(let i=world.casts.length-1;i>=0;i--){const c=world.casts[i];const actor=actorOf(c.owner);c.ageMs+=dt;c.x=actor.x;c.y=actor.y;
      if(c.ageMs>=c.durationMs){withActor(actor,()=>fireProjectile(c));world.casts.splice(i,1);}}
    for(const actor of actors()){
      const id=actorId(actor);if(world.clockMs<actor.nextCastAtMs||world.casts.some(c=>c.owner===id))continue;
      const index=world.castQueue.findIndex(c=>c.owner===id);if(index>=0&&world.casts.length<CFG.castLimit){
        const queued=world.castQueue.splice(index,1)[0];withActor(actor,()=>makeCast(queued.shot));}
    }
  }
  function segmentCircle(x1,y1,x2,y2,cx,cy,r){const vx=x2-x1,vy=y2-y1,l=vx*vx+vy*vy,t=l?clamp(((cx-x1)*vx+(cy-y1)*vy)/l,0,1):0;return hypot(cx-(x1+vx*t),cy-(y1+vy*t))<=r;}
  function chooseRicochetTarget(p,hit){
    const other=nearestEnemy(1080,hit.x,hit.y,hit.id);
    if(other)return other;
    return hit.dead?null:hit; // Single boss: circle away briefly, then strike again.
  }
  function ricochet(p,hit){
    if(p.bouncesLeft<=0)return true;
    const next=chooseRicochetTarget(p,hit);if(!next)return true;
    p.bouncesLeft--;p.bounceCount++;
    p.lastHitId=hit.id;p.targetId=next.id;
    p.hitAt.set(hit.id,p.ageMs);
    p.state='orbit';p.orbitCenter={x:hit.x,y:hit.y,r:hit.r,id:hit.id};
    p.orbitDurationMs=next.id===hit.id?245:105;
    p.orbitMs=p.orbitDurationMs;
    // Start the orbit at the actual hit position; a new radius/+0.32 angle snapped the center sideways.
    p.orbitStartRadius=hypot(p.x-hit.x,p.y-hit.y);
    p.orbitAngle=Math.atan2(p.y-hit.y,p.x-hit.x);
    p.baseDamage*=p.kind==='shuriken'?.91:.89;
    world.fields.push({kind:'arc',x:hit.x,y:hit.y,ex:next.x,ey:next.y,ageMs:0,lifeMs:225,color:p.color});sfx('bounce');
    return false;
  }
  function hitProjectile(p,e){
    if(e.dead)return false;
    const v=hypot(p.vx,p.vy)||1;
    const multiplier=p.kind==='triangle'?1.26:p.kind==='shuriken'?.67:p.kind==='water'?.90:1;
    const inflicted=damageEnemy(e,p.baseDamage*multiplier*(e.kind==='boss'?.88:1),e.x,e.y-18,p.color);
    e.vx+=p.vx/v*(16+p.impact*73);e.vy+=p.vy/v*(16+p.impact*73);
    p.hitAt.set(e.id,p.ageMs);
    if(p.kind==='circle'){
      const radius=40+Math.sqrt(p.areaPower)*47;
      world.fields.push({kind:'ring',x:e.x,y:e.y,r:radius,ageMs:0,lifeMs:360,color:art.circle});
      for(const n of world.enemies)if(!n.dead&&n.id!==e.id&&hypot(e.x-n.x,e.y-n.y)<radius+n.r){damageEnemy(n,p.baseDamage*.21,n.x,n.y-13,art.circle);}
    }else if(p.kind==='triangle'){
      if(!e.dead){e.stunMs=Math.max(e.stunMs,140);}
      world.fields.push({kind:'slash',x:e.x,y:e.y,r:55,ageMs:0,lifeMs:260,color:art.triangle});
    }else if(p.kind==='square'){
      if(!e.dead)e.stunMs=Math.max(e.stunMs,760);
      world.fields.push({kind:'ring',x:e.x,y:e.y,r:50,ageMs:0,lifeMs:390,color:art.square});
    }else if(p.kind==='flame'){
      if(!e.dead){e.burnMs=Math.max(e.burnMs,2400);e.burnTickMs=400;e.burnAmount=Math.max(e.burnAmount,Math.max(3,p.baseDamage*.15));}
      world.fields.push({kind:'flame',x:e.x,y:e.y,r:36,ageMs:0,lifeMs:1050,color:art.flame});
    }else if(p.kind==='water'){
      if(!e.dead)e.wetMs=Math.max(e.wetMs,3300);
      world.fields.push({kind:'splash',x:e.x,y:e.y,r:63,ageMs:0,lifeMs:420,color:art.water});
    }else if(p.kind==='lightning'){
      const wet=e.wetMs>0;
      if(wet&&!e.dead)damageEnemy(e,Math.max(5,p.baseDamage*.37),e.x,e.y-25,art.lightning);
      const range=wet?320:230;
      const near=world.enemies.filter(n=>!n.dead&&n.id!==e.id&&hypot(n.x-e.x,n.y-e.y)<range).sort((a,b)=>hypot(a.x-e.x,a.y-e.y)-hypot(b.x-e.x,b.y-e.y)).slice(0,wet?3:2);
      for(let i=0;i<near.length;i++){const n=near[i],boost=n.wetMs>0?1.65:1;
        damageEnemy(n,p.baseDamage*(i===0?.31:.18)*boost,n.x,n.y,art.lightning);
        world.fields.push({kind:'arc',x:e.x,y:e.y,ex:n.x,ey:n.y,ageMs:0,lifeMs:235,color:art.lightning});}
    }else if(p.kind==='star'||p.kind==='starcircle'){
      const range=p.kind==='starcircle'?152:88;
      world.fields.push({kind:p.kind==='starcircle'?'magiccircle':'star',x:e.x,y:e.y,r:range,ageMs:0,lifeMs:p.kind==='starcircle'?1700:480,color:art[p.kind],power:p.baseDamage*.17,tickMs:310});
      for(const n of world.enemies)if(!n.dead&&n.id!==e.id&&hypot(e.x-n.x,e.y-n.y)<range+n.r){damageEnemy(n,p.baseDamage*(p.kind==='starcircle'?.34:.28),n.x,n.y-17,p.color);if(p.kind==='star')n.stunMs=Math.max(n.stunMs,340);}
    }else if(p.kind==='shuriken'){
      world.fields.push({kind:'slash',x:e.x,y:e.y,r:38,ageMs:0,lifeMs:210,color:art.shuriken});
      if(!e.dead)e.stunMs=Math.max(e.stunMs,130);
    }
    if(inflicted>=22)world.fields.push({kind:'impact',x:e.x,y:e.y,r:67,ageMs:0,lifeMs:230,color:p.color});
    return ricochet(p,e);
  }
  function advanceHoming(p,dt){
    if(p.kind==='normal'||p.kind==='line'||p.bounceCount===0)return;
    const target=world.enemies.find(e=>e.id===p.targetId&&!e.dead) || nearestEnemy(850,p.x,p.y);
    if(!target)return;
    p.targetId=target.id;
    const want=Math.atan2(target.y-p.y,target.x-p.x),now=Math.atan2(p.vy,p.vx);
    let delta=Math.atan2(Math.sin(want-now),Math.cos(want-now));
    const turn=clamp(delta,-dt*.011,dt*.011),next=now+turn;
    p.vx=Math.cos(next)*p.speed;p.vy=Math.sin(next)*p.speed;
    p.angle=next;
  }
  function advanceOrbit(p,dt){
    const c=p.orbitCenter,center=world.enemies.find(e=>e.id===c.id&&!e.dead)||c;
    p.orbitMs=Math.max(0,p.orbitMs-dt);
    const progress=clamp((p.orbitDurationMs-p.orbitMs)/p.orbitDurationMs,0,1);
    const radius=mix(p.orbitStartRadius,center.r+p.r+50,progress),theta=p.orbitAngle+progress*Math.PI*(p.targetId===c.id?1.6:.72);
    p.x=center.x+Math.cos(theta)*radius;p.y=center.y+Math.sin(theta)*radius;
    p.angle=theta+Math.PI/2;
    if(p.orbitMs<=0){
      const target=world.enemies.find(e=>e.id===p.targetId&&!e.dead) || nearestEnemy(1080,p.x,p.y);
      if(!target)return false;
      const dx=target.x-p.x,dy=target.y-p.y,dist=hypot(dx,dy)||1;
      p.targetId=target.id;p.vx=dx/dist*p.speed;p.vy=dy/dist*p.speed;
      p.state='flight';p.angle=Math.atan2(p.vy,p.vx);
    }
    return true;
  }
  function tickProjectiles(dt,hostileDt=dt){
    for(let i=world.projectiles.length-1;i>=0;i--){const p=world.projectiles[i];p.ageMs+=dt;p.prevX=p.x;p.prevY=p.y;
      let remove=p.ageMs>=p.lifeMs;
      if(!remove&&p.state==='orbit')remove=!advanceOrbit(p,dt);
      else if(!remove){advanceHoming(p,dt);p.x+=p.vx*dt/1000;p.y+=p.vy*dt/1000;remove=!circleBounds(p.x,p.y,0);
        if(!remove)for(const e of world.enemies){if(e.dead||p.ageMs-(p.hitAt.get(e.id)??-1e6)<(p.kind==='shuriken'?130:310))continue;
          if(segmentCircle(p.prevX,p.prevY,p.x,p.y,e.x,e.y,e.r+p.r)){remove=hitProjectile(p,e);break;}}
      }
      if(remove)world.projectiles.splice(i,1);
    }
    for(let i=world.hazards.length-1;i>=0;i--){const p=world.hazards[i];p.ageMs+=hostileDt;p.prevX=p.x;p.prevY=p.y;p.x+=p.vx*hostileDt/1000;p.y+=p.vy*hostileDt/1000;
      let hit=false;for(const actor of actors()){if(actor.koMs>0)continue;if(segmentCircle(p.prevX,p.prevY,p.x,p.y,actor.x,actor.y,actor.r+p.r)){withActor(actor,()=>takeDamage(p.damage,p.x,p.y));burst(p.x,p.y,p.color,5,55);hit=true;break;}}
      if(hit||p.ageMs>p.lifeMs||!circleBounds(p.x,p.y,0))world.hazards.splice(i,1);}
  }
  function tickEffects(dt){for(let i=world.fields.length-1;i>=0;i--){const f=world.fields[i];f.ageMs+=dt;
      if(f.kind==='magiccircle'){
        f.tickMs-=dt;
        if(f.tickMs<=0){f.tickMs+=330;for(const e of world.enemies){if(!e.dead&&hypot(e.x-f.x,e.y-f.y)<f.r){damageEnemy(e,Math.max(2,f.power),e.x,e.y-22,f.color);}}}
      }
      if(f.ageMs>=f.lifeMs)world.fields.splice(i,1);}
    const drag=Math.pow(.14,dt/1000);
    for(let i=world.particles.length-1;i>=0;i--){const f=world.particles[i];f.lifeMs-=dt;f.x+=f.vx*dt/1000;f.y+=f.vy*dt/1000;f.vx*=drag;f.vy*=drag;
      if(f.lifeMs<=0){world.particles.splice(i,1);recycleVisual(f,'particle');}}
    for(let i=world.floaters.length-1;i>=0;i--){const f=world.floaters[i];f.lifeMs-=dt;f.y-=dt*.028;
      if(f.lifeMs<=0){world.floaters.splice(i,1);recycleVisual(f,'floater');}}
    for(let i=world.rollMarks.length-1;i>=0;i--){world.rollMarks[i].lifeMs-=dt;if(world.rollMarks[i].lifeMs<=0)world.rollMarks.splice(i,1);}
    if(world.rollTarget){world.rollTarget.lifeMs-=dt;if(world.rollTarget.lifeMs<=0)world.rollTarget=null;}
    const aliveActors=actors();
    for(let i=world.pickups.length-1;i>=0;i--){const p=world.pickups[i];p.lifeMs-=dt;
      let nearest=null,distSq=Infinity;
      for(const a of aliveActors){if(a.koMs)continue;const dx=p.x-a.x,dy=p.y-a.y,v=dx*dx+dy*dy;if(v<distSq){distSq=v;nearest=a;}}
      if(!nearest)continue;const d=Math.sqrt(distSq);
      if(d<88&&d>1){p.x+=(nearest.x-p.x)/d*dt*.18;p.y+=(nearest.y-p.y)/d*dt*.18;}
      if(d<28){nearest.ink=Math.min(nearest.maxInk,nearest.ink+p.amount);floating(p.x,p.y-18,`+${p.amount} 잉크`,'#78967f');world.pickups.splice(i,1);continue;}
      if(p.lifeMs<=0)world.pickups.splice(i,1);
    }
  }
  function tickCommands(){while(world.commands.length){const cmd=world.commands.shift(),payload=encodeLocalCommand(cmd);if(payload)performNetCommand(player,payload);}}
  function tick(dt){if(!mp.connected)tickCommands();if(ui.modal&&!mp.connected)return;
    world.clockMs+=dt;for(const actor of actors())recoverInk(actor,dt);
    world.hitFlashMs=Math.max(0,world.hitFlashMs-dt);
    world.effectShakeMs=Math.max(0,world.effectShakeMs-dt);
    world.screenTextMs=Math.max(0,world.screenTextMs-dt);
    if(world.screenTextMs===0&&!resimulatingGame)$('screenMessage').classList.remove('show');
    // Hitstop pauses authoritative combat for a brief, explicit millisecond duration.
    if(world.hitstopMs>0){world.hitstopMs=Math.max(0,world.hitstopMs-dt);return;}
    if(world.mode==='down'){world.deathMs-=dt;if(world.deathMs<=0)revive();tickEffects(dt);return;}
    withActor(hostPlayer,()=>updatePlayer(dt));
    if(mp.shared)withActor(guestPlayer,()=>updatePlayer(dt));
    // Time dilation is local-only; online rollback must not depend on device pointer state.
    const hostileDt=!mp.connected&&drawInput.pointer!==null?dt*.25:dt;
    world.slowRatio=hostileDt/dt;
    updateEnemies(hostileDt);tickCasts(dt);tickProjectiles(dt,hostileDt);tickEffects(dt);
    // Dead enemies have already delivered their XP, drops and ink fragments. Their records must NOT
    // survive forever in the canonical rollback history or AI scans. Stable IDs never get reused.
    for(let i=world.enemies.length-1;i>=0;i--)if(world.enemies[i].dead)world.enemies.splice(i,1);
  }
