  const actions=new ActionState(),gesture={drawId:null,points:[],length:0,startMs:0,trainingId:null,trainingPoints:[],lastCombatStroke:null};
  let player={x:475,y:735,vx:0,vy:0,moveX:0,moveY:0,faceX:1,faceY:0,r:CFG.player.radius,hp:CFG.player.hp,maxHp:CFG.player.hp,ink:100,inkDelayMs:0,cards:emptyCards(),power:1,dash:{leftMs:0,durationMs:0,elapsedMs:0,distance:0,charges:2,rechargeMs:0,dirX:1,dirY:0,originX:475,originY:735,rollMarkMs:0},nextCastAtMs:0,invulMs:0,healMsgMs:0,hits:0};
  applyCards(player);
  const hostPlayer=player;
  const guestPlayer={...hostPlayer,cards:emptyCards(),x:536,y:756,hp:hostPlayer.hp,maxHp:hostPlayer.maxHp,dash:{...hostPlayer.dash,originX:536,originY:756},nextCastAtMs:0,hits:0};
  applyCards(guestPlayer);
  const mp={role:'solo',connected:false,ready:false,connecting:false,shared:false,room:null,session:null,code:'',localId:null,ownerId:null,interpolation:null,poseRevision:0,poseSequence:0,poseReset:true,stats:{rollbacks:0,recoveries:0,commands:0,advanced:0}};
  function actors(){return mp.shared?[hostPlayer,guestPlayer]:[hostPlayer];}
  function actorId(actor){return actor===guestPlayer?'b':'a';}
  function actorOf(id){return id==='b'?guestPlayer:hostPlayer;}
  function withActor(actor,fn){const before=player;player=actor;try{return fn();}finally{player=before;}}
  const camera={x:0,y:0,zoom:1};
  const world={regionKills:[0,0,0,0,0],bossState:[0,0,0,0,0],nests:[],obstacles:[],grid:new Map(),decals:[],trees:[],houses:[],enemies:[],summons:[],hazards:[],casts:[],particles:[],floaters:[],pickups:[],fields:[],commands:[],castQueue:[],unlocked:['circle','triangle','square'],reward:null,rollMarks:[],rollTarget:null,nextId:1,seed:0x31415,clockMs:0,kills:0,bossesDefeated:0,hitstopMs:0,lastHitstopClockMs:-1000,hitFlashMs:0,slowRatio:1,screenTextMs:0,screenText:'',effectShakeMs:0,mode:'playing',deathMs:0,lastResult:null};
  const audioRecipes={
    draw:{category:'sfx',layers:[{kind:'tone',type:'sine',hz:610,end:910,ms:90,gain:.3}]},
    throw:{category:'sfx',layers:[{kind:'tone',type:'triangle',hz:410,end:950,ms:128,gain:.42},{kind:'noise',hz:2100,ms:65,gain:.17}]},
    hit:{category:'sfx',layers:[{kind:'tone',type:'triangle',hz:225,end:61,ms:133,gain:.50},{kind:'noise',hz:1180,ms:83,gain:.36}]},
    kill:{category:'sfx',layers:[{kind:'tone',type:'triangle',hz:310,end:77,ms:190,gain:.52},{kind:'tone',type:'sine',hz:380,end:760,ms:208,gain:.38},{kind:'noise',hz:2150,ms:125,gain:.28}]},
    bounce:{category:'sfx',layers:[{kind:'tone',type:'sine',hz:620,end:860,ms:87,gain:.20},{kind:'noise',hz:1900,ms:52,gain:.15}]},
    dash:{category:'sfx',layers:[{kind:'noise',hz:1200,ms:128,gain:.31}]},
    land:{category:'sfx',layers:[{kind:'tone',type:'triangle',hz:180,end:78,ms:110,gain:.26},{kind:'noise',hz:420,ms:76,gain:.13}]},
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
  function touchesObstacle(x,y,r){if(!circleBounds(x,y,r)||mapLayout.terrainBlocks(x,y,r))return true;const list=world.grid.get(gridKey(x,y))||[];for(const o of list){if(hypot(o.x-x,o.y-y)<o.r+r)return true;}return false;}
  function moveCollider(e,dx,dy,r){if(!touchesObstacle(e.x+dx,e.y,r))e.x+=dx;if(!touchesObstacle(e.x,e.y+dy,r))e.y+=dy;}
  function createWorld(mapSeed){
    applyMapLayout(mapSeed);
    world.nests=mapLayout.nests.map(()=>({on:false,cd:0,done:false}));
    placeActorsAtSpawn();
  }
  // Both heroes start (and are revived) at the coast camp; the guest stands a few steps beside the host.
  function spawnPointFor(actor){const sp=mapLayout.spawn,x=sp.x+(actor===guestPlayer?36:0),y=sp.y+(actor===guestPlayer?14:0);return mapLayout.terrainBlocks(x,y,actor.r)?{x:sp.x,y:sp.y}:{x,y};}
  function placeActorsAtSpawn(){for(const a of [hostPlayer,guestPlayer]){const p=spawnPointFor(a);a.x=p.x;a.y=p.y;a.dash.originX=p.x;a.dash.originY=p.y;}camera.x=hostPlayer.x;camera.y=hostPlayer.y;}
  const enemyDefs={chaser:{r:19,hp:55,speed:89,damage:11,color:'#a57673',name:'종이 사냥꾼'},spitter:{r:20,hp:48,speed:65,damage:9,color:'#8e8ba8',name:'잉크 투척수'},charger:{r:23,hp:85,speed:72,damage:18,color:'#c1966b',name:'낙서 돌격수'}};
  // Bosses take their stats from BOSS_PROFILES[bossId]; every enemy keeps its own copy of the stats the AI and renderer read.
  function spawnEnemy(kind,x,y,bossId=kind==='boss'?0:-1,nest=-1,hpScale=1,damageScale=1){const profile=bossId>=0?BOSS_PROFILES[bossId]:null,d=profile||enemyDefs[kind],id=world.nextId++;const e={id,kind,bossId,name:d.name,color:d.color,speed:d.speed,damage:+(d.damage*damageScale).toFixed(2),region:regionAt(x,y),nest,home:false,x,y,r:d.r,hp:Math.round(d.hp*hpScale),maxHp:Math.round(d.hp*hpScale),vx:0,vy:0,ageMs:0,aiMs:0,windupMs:0,attackMs:400+rand()*550,chargeMs:0,chargeDX:0,chargeDY:0,hitMs:0,burnMs:0,burnTickMs:400,burnAmount:0,wetMs:0,stunMs:0,tid:0,dead:false};world.enemies.push(e);return e;}
  function announce(text,time=1700){world.screenText=text;world.screenTextMs=time;if(!resimulatingGame){$('screenMessage').textContent=text;$('screenMessage').classList.add('show');}}
  createWorld(initialMapSeed());

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
  function takeDamage(amount,fromX,fromY){if(player.invulMs>0||world.mode!=='playing')return false;player.hp=Math.max(0,player.hp-Math.round(amount));player.invulMs=520;player.hits++;world.effectShakeMs=180;floating(player.x,player.y-32,`-${Math.round(amount)}`,'#bb604f');burst(player.x,player.y,'#d07962',10,83);sfx('hit');if(fromX!=null){const d=hypot(player.x-fromX,player.y-fromY)||1;moveCollider(player,(player.x-fromX)/d*17,(player.y-fromY)/d*17,player.r);}if(player.hp<=0){if(!resimulatingGame&&player===(mp.role==='join'?guestPlayer:hostPlayer))dropDraw();if(mp.shared){player.koMs=1150;announce('동료의 잉크가 번졌다 · 잠시 뒤 부활!',1100);}else{world.mode='over';world.deathMs=0;announce('먹물이 번졌다… 이번 판은 여기까지',2400);}}return true;}
  function reviveActor(actor){withActor(actor,()=>{{const p=spawnPointFor(actor);player.x=p.x;player.y=p.y;}player.hp=Math.ceil(player.maxHp*.75);player.invulMs=1600;player.koMs=0;player.dash.leftMs=0;player.dash.charges=CFG.player.roll.capacity;player.dash.rechargeMs=0;player.nextCastAtMs=0;});}
  function revive(){world.summons.length=0;{const p=spawnPointFor(player);player.x=p.x;player.y=p.y;}player.hp=Math.ceil(player.maxHp*.75);player.invulMs=1600;player.dash.leftMs=0;player.dash.charges=CFG.player.roll.capacity;player.dash.rechargeMs=0;player.nextCastAtMs=0;world.hazards.length=0;world.casts.length=0;world.castQueue.length=0;world.rollMarks.length=0;world.mode='playing';}
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
      item.color=e.color;item.lifeMs=480+hashSketch(e.id,i,20)*280;item.initialMs=760;item.r=1.5;
      world.particles.push(item);
    }
  }
  // `source` is the drawn shape (CNN class) that caused the damage; boss rules scale or cancel it.
  function damageEnemy(e,amount,x,y,color='#be7757',source='normal'){if(e.dead)return 0;
    if(e.bossId>=0){const factor=BOSS_PROFILES[e.bossId].multiplier(source);if(factor===0){e.hitMs=SKETCH.hitFlashMs;floating(x??e.x,y??e.y-32,'면역','#8a8f93');return 0;}if(factor>1)floating((x??e.x)+16,(y??e.y-32)-16,'약점!','#d0803a');amount*=factor;if(bossSealed(e.bossId)){amount*=BOSS_SEAL_DAMAGE_SCALE;if(world.clockMs-(e.sealMsgMs??-9999)>1400){e.sealMsgMs=world.clockMs;floating((x??e.x)-16,(y??e.y-32)-16,'봉인 −90%','#7d5a9e');}}}
    const d=Math.max(1,Math.round(amount));e.hp=Math.max(0,e.hp-d);e.hitMs=SKETCH.hitFlashMs;floating(x??e.x,y??e.y-32,`-${d}`,color);
    if(world.clockMs-world.lastHitstopClockMs>110){world.lastHitstopClockMs=world.clockMs;world.hitstopMs=Math.max(world.hitstopMs,e.kind==='boss'?64:43);world.hitFlashMs=155;world.effectShakeMs=Math.max(world.effectShakeMs,e.kind==='boss'?190:110);}
    // Radial scratch and high-contrast paper sparks at the real contact point.
    world.fields.push({kind:'impact',x:e.x,y:e.y-3,r:e.kind==='boss'?59:33,ageMs:0,lifeMs:260,color});
    burst(e.x,e.y,color,e.kind==='boss'?11:7,99);
if(e.hp<=0){e.dead=true;world.kills++;if(e.kind!=='boss')world.regionKills[e.region]++;burst(e.x,e.y,e.color,9,100);tearEnemyInk(e);sfx('kill');if(e.kind!=='boss'){world.pickups.push({x:e.x,y:e.y,r:8,lifeMs:24000,kind:'ink',amount:1+Math.floor(rand()*3)});}else{world.bossState[e.bossId]=2;world.bossesDefeated++;offerUnlockReward();if(world.bossesDefeated>=BOSS_PROFILES.length){world.reward=null;world.mode='clear';}announce(world.bossesDefeated>=BOSS_PROFILES.length?`${e.name} 격파 · 스케치 타운을 되찾았다!`:`${e.name} 격파 · ${world.bossesDefeated}/${BOSS_PROFILES.length} · ${nextBossId()+1}번 보스`,3500);world.pickups.push({x:e.x,y:e.y,r:15,lifeMs:30000,kind:'ink',amount:24});}}
    else sfx('hit');return d;}

  function enemyProjectile(x,y,tx,ty,kind='ink',speed=260,damage=9){const dx=tx-x,dy=ty-y,m=hypot(dx,dy)||1;world.hazards.push({x,y,prevX:x,prevY:y,vx:dx/m*speed,vy:dy/m*speed,r:kind==='orb'?11:7,kind,color:kind==='orb'?'#9d729c':'#9f8fb1',damage,ageMs:0,lifeMs:2100});}
  // Boss UI follows the nearest living boss; several can be alive at once because they stand in different zones.
  function activeBoss(){let best=null,bd=1e18;for(const e of world.enemies){if(e.kind!=='boss'||e.dead)continue;const d=hypot(e.x-player.x,e.y-player.y);if(d<bd){bd=d;best=e;}}return best;}
  // Boss n is sealed (takes BOSS_SEAL_DAMAGE_SCALE of every hit) until bosses 0..n-1 have fallen.
  function bossSealed(id){for(let j=0;j<id;j++)if(world.bossState[j]!==2)return true;return false;}
  function nextBossId(){const i=world.bossState.findIndex(v=>v!==2);return i<0?BOSS_PROFILES.length-1:i;}
  // A boss appears when an able player comes within its site radius + 220, in any order; only its seal enforces the order.
  function updateBossSummon(){
    const live=actors().filter(a=>a.hp>0&&!(a.koMs>0));
    for(const site of mapLayout.bossSites){
      const i=site.bossId;if(world.bossState[i]!==0)continue;
      if(!live.some(a=>hypot(a.x-site.x,a.y-site.y)<site.radius+220))continue;
      const profile=BOSS_PROFILES[i];world.bossState[i]=1;spawnEnemy('boss',site.x,site.y,i);
      announce(bossSealed(i)?`${profile.name} 등장 · 봉인됨(피해 −90%) · ${i}번 보스를 먼저 쓰러뜨리세요`:`${profile.name} 등장 · ${profile.ruleText()}`,3200);
    }
  }
  // Mob nests (WORLD_MAP.mobs): a nest wakes when a living hero comes within activeRadius, sleeps (members removed) when every
  // hero is beyond despawnRadius, and refills respawnMs after its last member fell while all heroes stayed beyond respawnAwayPx.
  const ENEMY_CAP=60;
  function spawnNestMembers(index){
    const n=mapLayout.nests[index],M=WORLD_MAP.mobs,count=n.members.length;
    for(let k=0;k<count;k++){
      const a=(k+rand())*Math.PI*2/count,rr=34+rand()*56;let x=n.x+Math.cos(a)*rr,y=n.y+Math.sin(a)*rr;
      if(mapLayout.terrainBlocks(x,y,20)){x=n.x;y=n.y;}
      spawnEnemy(n.members[k],x,y,-1,index,n.hpScale,M.damageScale[n.zone]).region=n.zone;
    }
  }
  function tickNests(dt){
    const M=WORLD_MAP.mobs,nests=mapLayout.nests,live=actors().filter(a=>a.hp>0&&!(a.koMs>0));
    const near=(n,r)=>live.some(a=>{const dx=a.x-n.x,dy=a.y-n.y;return dx*dx+dy*dy<r*r;});
    const alive=new Array(nests.length).fill(0);let total=0;
    for(const e of world.enemies){if(e.dead)continue;total++;if(e.nest>=0)alive[e.nest]++;}
    for(let i=0;i<nests.length;i++){
      const n=nests[i],s=world.nests[i];if(!s)continue;
      if(s.on){
        if(alive[i]===0){s.on=false;if(n.respawn)s.cd=M.respawnMs;else s.done=true;}
        else if(!near(n,M.despawnRadius)){for(const e of world.enemies)if(e.nest===i&&!e.dead)e.dead=true;s.on=false;s.cd=0;total-=alive[i];}
      }else if(!s.done){
        if(s.cd>0){if(!near(n,M.respawnAwayPx))s.cd=Math.max(0,s.cd-dt);}
        else if(near(n,M.activeRadius)&&total+n.members.length<=ENEMY_CAP){spawnNestMembers(i);s.on=true;total+=n.members.length;}
      }
    }
  }
  function enemyAction(e){if(e.dead||world.mode!=='playing')return;const summon=summonById(e.tid),tgt=summon&&summon.hp>0?summon:player,dx=tgt.x-e.x,dy=tgt.y-e.y,d=hypot(dx,dy)||1;
    if(e.attackType==='melee'){if(d<e.r+tgt.r+48){if(tgt===player)takeDamage(e.damage,e.x,e.y);else hurtSummon(tgt,e.damage);}burst(e.x+dx/d*20,e.y+dy/d*20,'#a87978',6,38);}
    else if(e.attackType==='charge'){e.chargeMs=e.kind==='boss'?510:390;e.chargeDX=dx/d;e.chargeDY=dy/d;}
    else if(e.attackType==='spit'){enemyProjectile(e.x,e.y,tgt.x,tgt.y,'ink',280,e.damage);}
    else if(e.attackType==='nova'){for(let i=0;i<12;i++){const a=i*Math.PI/6+world.clockMs*.0003;enemyProjectile(e.x,e.y,e.x+Math.cos(a)*130,e.y+Math.sin(a)*130,'orb',215,10);}burst(e.x,e.y,'#bb86b4',14,95);}
    e.attackType=null;}
  function moveEnemy(e,dt,dx,dy){const wet=e.wetMs>0?.56:1;moveCollider(e,dx*wet*dt/1000,dy*wet*dt/1000,e.r*.68);}
  function updateEnemies(dt){const previousActor=player;try{for(const e of world.enemies){if(e.dead)continue;
    if(mp.shared){const h=hypot(hostPlayer.x-e.x,hostPlayer.y-e.y),g=hypot(guestPlayer.x-e.x,guestPlayer.y-e.y);player=guestPlayer&&guestPlayer.koMs<=0&&g<h?guestPlayer:hostPlayer;if(hostPlayer.koMs>0&&guestPlayer.koMs<=0)player=guestPlayer;}e.ageMs+=dt;e.hitMs=Math.max(0,e.hitMs-dt);e.stunMs=Math.max(0,e.stunMs-dt);e.wetMs=Math.max(0,e.wetMs-dt);if(e.burnMs>0){e.burnMs=Math.max(0,e.burnMs-dt);e.burnTickMs-=dt;if(e.burnTickMs<=0){e.burnTickMs+=470;damageEnemy(e,e.burnAmount,e.x,e.y-13,art.flame,'flame');if(e.dead)continue;}}
      // Inactive far-off enemies never simulate AI, but status timers remain consistent.
      const tgt=enemyTarget(e,player),dx=tgt.x-e.x,dy=tgt.y-e.y,d=hypot(dx,dy)||1;e.tid=tgt===player?0:tgt.id;if(hypot(player.x-e.x,player.y-e.y)>970&&tgt===player&&e.kind!=='boss')continue;
      if(e.stunMs>0){moveCollider(e,e.vx*dt/1000,e.vy*dt/1000,e.r*.68);e.vx*=.85;e.vy*=.85;continue;}
      // A nest member that strayed past its leash walks home and ignores heroes until it is back.
      if(e.nest>=0){const n=mapLayout.nests[e.nest],hx=n.x-e.x,hy=n.y-e.y,hd=hypot(hx,hy)||1;if(!e.home&&hd>n.leash)e.home=true;if(e.home){if(hd<70)e.home=false;else moveEnemy(e,dt,hx/hd*enemyDefs[e.kind].speed,hy/hd*enemyDefs[e.kind].speed);continue;}}
      if(e.chargeMs>0){e.chargeMs=Math.max(0,e.chargeMs-dt);moveCollider(e,e.chargeDX*(e.kind==='boss'?490:570)*dt/1000,e.chargeDY*(e.kind==='boss'?490:570)*dt/1000,e.r*.67);if(hypot(player.x-e.x,player.y-e.y)<player.r+e.r+6){takeDamage(e.damage,e.x,e.y);e.chargeMs=0;}else{const hitSummon=world.summons.find(s=>s.hp>0&&hypot(s.x-e.x,s.y-e.y)<s.r+e.r+6);if(hitSummon){hurtSummon(hitSummon,e.damage);e.chargeMs=0;}}continue;}
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
        if(d<760&&d>195)moveEnemy(e,dt,dx/d*e.speed,dy/d*e.speed);
        if(d<670&&e.attackMs<=0){e.attackMs=(e.hp<e.maxHp*.52?1750:2350)*BOSS_PROFILES[e.bossId].tempo;e.windupMs=e.hp<e.maxHp*.52?520:700;e.attackType=e.aiMs%3===2?'charge':'nova';e.aiMs++;}
      }
      moveCollider(e,e.vx*dt/1000,e.vy*dt/1000,e.r*.68);e.vx*=Math.pow(.12,dt/1000);e.vy*=Math.pow(.12,dt/1000);
      // Entity-vs-hero separation, proportional to actual contact overlap; no position snap onto player.
      const separation=hypot(player.x-e.x,player.y-e.y);const overlap=player.r+e.r*.69-separation;
      if(overlap>0.1&&separation>.01)moveCollider(e,(e.x-player.x)/separation*overlap*.55,(e.y-player.y)/separation*overlap*.55,e.r*.68);
    }}finally{player=previousActor;} }
  // A summon is drawn in, so the pause is a short, fixed summoning pose (longer strokes take slightly longer).
  function castDurationMs(shot){return clamp(220+shot.geo.length*.04,220,380);}
  function spellRecoveryMs(){return 120;}
  // Ink is paid in installments while the body is inked in along the pre-drawn stroke: progress = paid/cost.
  // With enough ink the pace equals the old fixed pose duration; with little ink it stalls to the regen rate.
  function makeCast(shot,cost){
    const duration=castDurationMs(shot);
    world.casts.push({id:world.nextId++,owner:actorId(player),shot,ageMs:0,durationMs:duration,x:player.x,y:player.y,cost,paid:0});
    showResult(`${shot.name} 그리는 중 · ${summonSpecOf(shot.kind).role} · 체력 ${summonSpecOf(shot.kind).maxHp(shot.areaPower)}`,1450);sfx('draw');
  }
  // Unlocks are run state: the line projectile and the plain scribble are always available; the three start shapes are
  // open from the beginning; every boss defeat offers a choice among the shapes still locked (per run, shared by both players).
  const UNLOCKABLE_KINDS=Object.freeze(['flame','water','lightning','star','shuriken','starcircle']);
  const isKindOpen=kind=>kind==='line'||kind==='normal'||world.unlocked.includes(kind);
  function offerUnlockReward(){
    const locked=UNLOCKABLE_KINDS.filter(k=>!world.unlocked.includes(k));
    if(!locked.length){world.reward=null;return;}
    const pool=locked.slice(),choices=[];
    while(choices.length<3&&pool.length)choices.push(pool.splice(Math.floor(rand()*pool.length),1)[0]);
    world.reward={choices};
  }
  function applyUnlock(kind){
    if(!world.reward||!world.reward.choices.includes(kind)||world.unlocked.includes(kind))return false;
    world.unlocked.push(kind);world.reward=null;announce(`${summonSpecOf(kind).name} 해금`,2600);sfx('draw');return true;
  }
  // The line is the only projectile: no face, fired from the owner along the drawn direction, paid at once.
  const LINE_BOLT=Object.freeze({speed:620,lifeMs:620,damage:15,pierce:2,radius:10,ink:22,cooldownMs:200});
  function fireLine(shot){
    if(world.clockMs<player.nextCastAtMs)return false;
    const a=shot.shape[0],b=shot.shape[shot.shape.length-1];let dx=b.x-a.x,dy=b.y-a.y;const len=hypot(dx,dy);
    if(len<1e-3){dx=player.faceX||1;dy=player.faceY||0;}else{dx/=len;dy/=len;}
    if(!spendInk(player,Math.min(player.maxInk,+(LINE_BOLT.ink*player.inkCostRate).toFixed(3))))return false;
    player.nextCastAtMs=world.clockMs+LINE_BOLT.cooldownMs;
    world.fields.push({kind:'bolt',owner:actorId(player),x:player.x+dx*(player.r+6),y:player.y+dy*(player.r+6),dx,dy,r:LINE_BOLT.radius,ageMs:0,lifeMs:LINE_BOLT.lifeMs,color:shot.color,hits:[],pierceLeft:LINE_BOLT.pierce,damage:+(LINE_BOLT.damage*player.power).toFixed(2)});
    sfx('draw');return true;
  }
  function tickBolts(dt){
    for(const f of world.fields){if(f.kind!=='bolt'||f.pierceLeft<=0)continue;
      const px=f.x,py=f.y,step=LINE_BOLT.speed*dt/1000;f.x+=f.dx*step;f.y+=f.dy*step;
      for(const e of world.enemies){if(e.dead||f.hits.includes(e.id)||!segmentCircle(px,py,f.x,f.y,e.x,e.y,e.r+f.r))continue;
        f.hits.push(e.id);withActor(actorOf(f.owner),()=>damageEnemy(e,f.damage,e.x,e.y-20,f.color,'line'));
        if(--f.pierceLeft<=0){f.ageMs=f.lifeMs;break;}}}
  }
  function submitSpell(shot){if(!isKindOpen(shot.kind))shot={...shot,kind:'normal',name:summonSpecOf('normal').name,color:art.normal};if(shot.kind==='line')return player.hp>0&&!(player.koMs>0)&&fireLine(shot);if(player.hp<=0||player.koMs>0||world.castQueue.filter(c=>c.owner===actorId(player)).length>=3)return false;world.castQueue.push({shot,owner:actorId(player),cost:spellInkCost(player,shot)});return true;}
  function tickCasts(dt){
    for(let i=world.casts.length-1;i>=0;i--){const c=world.casts[i];const actor=actorOf(c.owner);c.x=actor.x;c.y=actor.y;
      const pay=Math.min(actor.ink,c.cost-c.paid,c.cost*dt/c.durationMs);
      if(pay>0){actor.ink-=pay;c.paid+=pay;}
      c.ageMs=c.durationMs*(c.cost>0?c.paid/c.cost:1);
      if(c.paid>=c.cost-1e-6){actor.inkDelayMs=400;actor.nextCastAtMs=world.clockMs+spellRecoveryMs();withActor(actor,()=>spawnSummon(actor,c.shot));world.casts.splice(i,1);}}
    for(const actor of actors()){
      const id=actorId(actor);if(world.clockMs<actor.nextCastAtMs||world.casts.some(c=>c.owner===id))continue;
      const index=world.castQueue.findIndex(c=>c.owner===id);if(index>=0&&world.casts.length<CFG.castLimit){
        const queued=world.castQueue.splice(index,1)[0];withActor(actor,()=>makeCast(queued.shot,queued.cost));}
    }
  }
  function segmentCircle(x1,y1,x2,y2,cx,cy,r){const vx=x2-x1,vy=y2-y1,l=vx*vx+vy*vy,t=l?clamp(((cx-x1)*vx+(cy-y1)*vy)/l,0,1):0;return hypot(cx-(x1+vx*t),cy-(y1+vy*t))<=r;}
  function tickHazards(hostileDt){
    for(let i=world.hazards.length-1;i>=0;i--){const p=world.hazards[i];p.ageMs+=hostileDt;p.prevX=p.x;p.prevY=p.y;p.x+=p.vx*hostileDt/1000;p.y+=p.vy*hostileDt/1000;
      let hit=false;for(const actor of actors()){if(actor.koMs>0)continue;if(segmentCircle(p.prevX,p.prevY,p.x,p.y,actor.x,actor.y,actor.r+p.r)){withActor(actor,()=>takeDamage(p.damage,p.x,p.y));burst(p.x,p.y,p.color,5,55);hit=true;break;}}
      if(!hit)for(const s of world.summons){if(s.hp>0&&segmentCircle(p.prevX,p.prevY,p.x,p.y,s.x,s.y,s.r+p.r)){hurtSummon(s,p.damage);burst(p.x,p.y,p.color,5,55);hit=true;break;}}
      if(hit||p.ageMs>p.lifeMs||!circleBounds(p.x,p.y,0))world.hazards.splice(i,1);}
  }
  function tickEffects(dt){for(let i=world.fields.length-1;i>=0;i--){const f=world.fields[i];f.ageMs+=dt;
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
    // A finished run (defeat or clear) freezes the battlefield; only the result panel remains (new run = new page load).
    if(world.mode==='over'||world.mode==='clear'){tickEffects(dt);return;}
    withActor(hostPlayer,()=>updatePlayer(dt));
    if(mp.shared)withActor(guestPlayer,()=>updatePlayer(dt));
    // Time dilation is local-only; online rollback must not depend on device pointer state.
    const hostileDt=!mp.connected&&drawInput.pointer!==null?dt*.25:dt;
    world.slowRatio=hostileDt/dt;
    tickNests(dt);updateBossSummon();updateEnemies(hostileDt);tickCasts(dt);tickBolts(dt);tickSummons(dt);separateUnits();tickHazards(hostileDt);tickEffects(dt);
    // Dead enemies have already delivered their XP, drops and ink fragments. Their records must NOT
    // survive forever in the canonical rollback history or AI scans. Stable IDs never get reused.
    for(let i=world.enemies.length-1;i>=0;i--)if(world.enemies[i].dead)world.enemies.splice(i,1);
  }
