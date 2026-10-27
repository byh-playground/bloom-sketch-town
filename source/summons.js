  // A drawn shape becomes a summon that fights on its own. Single source for what each shape summons.
  //
  // Structure:
  //   SummonSpec (is-a base)  -> MobileSpec (walks to enemies) | AnchoredSpec (stays where it was drawn)
  //   withTaunt (mixin)       -> enemies prefer a taunting summon over the player
  //   SummonSpec HAS a Strike (MeleeStrike | RangedBolt | AreaPulse) and a list of HitEffect objects.
  // The damage source passed to damageEnemy is the drawn shape kind, so boss rules (bosses.js) keep working.
  const SUMMON_LIMIT=10;         // live summons per player; an eleventh replaces that player's oldest
  const SUMMON_SIGHT=480;        // distance within which a summon notices an enemy
  const SUMMON_LEASH=760;        // a summon never chases an enemy farther than this from its owner
  const SUMMON_RETURN=900;       // beyond this distance from the owner a summon is placed next to the owner
  const SUMMON_FOLLOW=96;        // idle summons keep this distance from the owner
  const SUMMON_AGGRO=260;        // enemies notice a summon within this distance
  const SUMMON_TAUNT_BONUS=140;  // extra notice distance for taunting summons
  const SUMMON_SEARCH_STEP=28,SUMMON_SEARCH_RINGS=8; // if the drawn spot is blocked, the nearest free spot within 224 units is used

  // ---- hit effects: what a strike additionally does to the enemy it hit -------------------------------------------
  class HitEffect{apply(){}}
  class BurnEffect extends HitEffect{
    apply(summon,enemy,damage){if(enemy.dead)return;enemy.burnMs=Math.max(enemy.burnMs,2400);enemy.burnTickMs=400;enemy.burnAmount=Math.max(enemy.burnAmount,Math.max(3,damage*.5));}
  }
  class WetEffect extends HitEffect{apply(summon,enemy){if(!enemy.dead)enemy.wetMs=Math.max(enemy.wetMs,3300);}}
  class StunEffect extends HitEffect{
    constructor(ms){super();this.ms=ms;}
    apply(summon,enemy){if(!enemy.dead)enemy.stunMs=Math.max(enemy.stunMs,this.ms);}
  }
  class SplashEffect extends HitEffect{
    constructor(radius,share){super();this.radius=radius;this.share=share;}
    apply(summon,enemy,damage){
      world.fields.push({kind:'ring',x:enemy.x,y:enemy.y,r:this.radius,ageMs:0,lifeMs:360,color:summon.color});
      for(const n of world.enemies)if(!n.dead&&n.id!==enemy.id&&hypot(enemy.x-n.x,enemy.y-n.y)<this.radius+n.r)damageEnemy(n,damage*this.share,n.x,n.y-13,summon.color,summon.kind);
    }
  }
  class ChainEffect extends HitEffect{
    constructor(range,wetRange,share){super();this.range=range;this.wetRange=wetRange;this.share=share;}
    apply(summon,enemy,damage){
      const wet=enemy.wetMs>0,range=wet?this.wetRange:this.range;
      const near=world.enemies.filter(n=>!n.dead&&n.id!==enemy.id&&hypot(n.x-enemy.x,n.y-enemy.y)<range).sort((a,b)=>hypot(a.x-enemy.x,a.y-enemy.y)-hypot(b.x-enemy.x,b.y-enemy.y)).slice(0,wet?3:2);
      for(const n of near){damageEnemy(n,damage*this.share*(n.wetMs>0?1.65:1),n.x,n.y,summon.color,summon.kind);
        world.fields.push({kind:'arc',x:enemy.x,y:enemy.y,ex:n.x,ey:n.y,ageMs:0,lifeMs:235,color:summon.color});}
    }
  }
  class HealOwnerEffect extends HitEffect{
    constructor(amount){super();this.amount=amount;}
    apply(summon){const owner=actorOf(summon.owner);if(owner.hp>0&&!(owner.koMs>0)&&owner.hp<owner.maxHp)owner.hp=Math.min(owner.maxHp,owner.hp+this.amount);}
  }

  // ---- strikes: how a summon attacks --------------------------------------------------------------------------------
  class Strike{
    constructor({damage,cooldownMs,range}){this.damage=damage;this.cooldownMs=cooldownMs;this.range=range;}
    // Distance from the summon's center at which it stops approaching and attacks.
    engageDistance(summon,enemy){return summon.r+enemy.r+this.range;}
    targets(summon,enemy){return [enemy];}
    visual(){}
    execute(summon,enemy,effects){
      const amount=this.damage*summon.power;
      for(const target of this.targets(summon,enemy)){
        damageEnemy(target,amount,target.x,target.y-18,summon.color,summon.kind);
        for(const effect of effects)effect.apply(summon,target,amount);
      }
      this.visual(summon,enemy);
    }
  }
  class MeleeStrike extends Strike{
    visual(summon,enemy){world.fields.push({kind:'slash',x:enemy.x,y:enemy.y,r:summon.r+14,ageMs:0,lifeMs:210,color:summon.color});}
  }
  class RangedBolt extends Strike{
    visual(summon,enemy){world.fields.push({kind:'arc',x:summon.x,y:summon.y-6,ex:enemy.x,ey:enemy.y,ageMs:0,lifeMs:200,color:summon.color});}
  }
  // Hits every enemy within range of the summon, not only the one it aimed at.
  class AreaPulse extends Strike{
    engageDistance(summon,enemy){return this.range+enemy.r;}
    targets(summon){return world.enemies.filter(n=>!n.dead&&hypot(n.x-summon.x,n.y-summon.y)<this.range+n.r);}
    visual(summon){world.fields.push({kind:'ring',x:summon.x,y:summon.y,r:this.range,ageMs:0,lifeMs:360,color:summon.color});}
  }

  // ---- specs --------------------------------------------------------------------------------------------------------
  class SummonSpec{
    constructor({name,role,hp,r,ink,strike,effects=[]}){Object.assign(this,{name,role,hp,r,ink,strike});this.effects=Object.freeze([...effects]);}
    get anchored(){return false;}
    get taunt(){return false;}
    // A larger drawing summons a stronger creature: 0.85x for the smallest drawing up to 1.30x for the largest.
    power(areaPower){return +(0.85+0.45*clamp(areaPower,0,1)).toFixed(3);}
    inkCost(areaPower){return +(this.ink*(0.85+0.3*clamp(areaPower,0,1))).toFixed(3);}
    maxHp(areaPower){return Math.round(this.hp*this.power(areaPower));}
    damage(areaPower){return Math.round(this.strike.damage*this.power(areaPower));}
  }
  class MobileSpec extends SummonSpec{
    constructor(fields){super(fields);this.speed=fields.speed;}
  }
  class AnchoredSpec extends SummonSpec{
    get anchored(){return true;}
  }
  const withTaunt=Base=>class extends Base{get taunt(){return true;}};
  class TauntMobileSpec extends withTaunt(MobileSpec){}

  const SUMMON_SPECS=Object.freeze({
    normal:   new MobileSpec({name:'낙서병',role:'근접',hp:40,r:13,ink:4,speed:120,strike:new MeleeStrike({damage:7,cooldownMs:650,range:14})}),
    line:     new MobileSpec({name:'잉크 사수',role:'원거리',hp:32,r:12,ink:6,speed:105,strike:new RangedBolt({damage:6,cooldownMs:520,range:300})}),
    circle:   new TauntMobileSpec({name:'방패 구체',role:'방어',hp:130,r:17,ink:14,speed:90,strike:new MeleeStrike({damage:5,cooldownMs:800,range:14}),effects:[new SplashEffect(60,.5)]}),
    triangle: new MobileSpec({name:'창병',role:'근접',hp:62,r:14,ink:15,speed:135,strike:new MeleeStrike({damage:19,cooldownMs:720,range:16})}),
    square:   new TauntMobileSpec({name:'벽돌 골렘',role:'방어',hp:170,r:19,ink:18,speed:70,strike:new MeleeStrike({damage:11,cooldownMs:950,range:14}),effects:[new StunEffect(700)]}),
    flame:    new MobileSpec({name:'불씨 정령',role:'원거리',hp:46,r:13,ink:16,speed:100,strike:new RangedBolt({damage:8,cooldownMs:900,range:280}),effects:[new BurnEffect()]}),
    water:    new MobileSpec({name:'물방울 정령',role:'원거리',hp:52,r:13,ink:14,speed:105,strike:new RangedBolt({damage:6,cooldownMs:800,range:280}),effects:[new WetEffect()]}),
    lightning:new MobileSpec({name:'번개새',role:'원거리',hp:40,r:12,ink:17,speed:150,strike:new RangedBolt({damage:9,cooldownMs:850,range:320}),effects:[new ChainEffect(230,320,.31)]}),
    star:     new AnchoredSpec({name:'별 포탑',role:'고정·범위',hp:80,r:16,ink:26,strike:new AreaPulse({damage:14,cooldownMs:1000,range:170}),effects:[new StunEffect(350)]}),
    shuriken: new MobileSpec({name:'표창 닌자',role:'근접',hp:50,r:12,ink:16,speed:175,strike:new MeleeStrike({damage:9,cooldownMs:330,range:14}),effects:[new StunEffect(130)]}),
    starcircle:new AnchoredSpec({name:'마법진',role:'고정·범위·회복',hp:100,r:20,ink:32,strike:new AreaPulse({damage:11,cooldownMs:600,range:200}),effects:[new HealOwnerEffect(1)]})
  });
  function summonSpecOf(kind){return SUMMON_SPECS[kind]||SUMMON_SPECS.normal;}

  // ---- world operations ---------------------------------------------------------------------------------------------
  // The summon appears exactly where the body was drawn (world coordinates), anywhere on the map.
  function summonSpawnPoint(owner,shot,r){
    const x0=clamp(shot.x,r,CFG.world.width-r),y0=clamp(shot.y,r,CFG.world.height-r);
    if(!touchesObstacle(x0,y0,r))return {x:x0,y:y0};
    for(let ring=1;ring<=SUMMON_SEARCH_RINGS;ring++){
      const d=ring*SUMMON_SEARCH_STEP,n=ring*6;
      for(let k=0;k<n;k++){const a=k*Math.PI*2/n,x=x0+Math.cos(a)*d,y=y0+Math.sin(a)*d;if(!touchesObstacle(x,y,r))return {x,y};}
    }
    return {x:owner.x,y:owner.y};
  }
  function spawnSummon(owner,shot){
    const spec=summonSpecOf(shot.kind),point=summonSpawnPoint(owner,shot,spec.r),id=actorId(owner),mine=world.summons.filter(s=>s.owner===id);
    if(mine.length>=SUMMON_LIMIT){const oldest=mine[0];world.summons.splice(world.summons.indexOf(oldest),1);burst(oldest.x,oldest.y,oldest.color,6,50);}
    const face=expressionOf(shot.face),temper=face.temperament,maxHp=Math.round(spec.maxHp(shot.areaPower)*temper.hp);
    const s={id:world.nextId++,owner:id,kind:shot.kind,face:face.id,name:spec.name,color:shot.color,shape:shot.shape,x:point.x,y:point.y,r:spec.r,
      hp:maxHp,maxHp,power:+(spec.power(shot.areaPower)*owner.power*temper.damage).toFixed(3),cdMs:400,ageMs:0,hitMs:0,faceX:1,targetId:0};
    world.summons.push(s);
    world.fields.push({kind:'ring',x:s.x,y:s.y,r:46,ageMs:0,lifeMs:420,color:s.color});
    burst(s.x,s.y,s.color,10,70);sfx('throw');
    return s;
  }
  function summonById(id){return id?world.summons.find(s=>s.id===id)||null:null;}
  function hurtSummon(s,amount){
    if(s.hp<=0)return 0;const d=Math.max(1,Math.round(amount));s.hp=Math.max(0,s.hp-d);s.hitMs=SKETCH.hitFlashMs;
    floating(s.x,s.y-s.r-18,`-${d}`,'#a46d62');burst(s.x,s.y,s.color,4,60);
    if(s.hp===0){burst(s.x,s.y,s.color,12,100);sfx('kill');}
    return d;
  }
  function nearestEnemyOf(s,range){
    let best=null,bestD=range;
    for(const e of world.enemies){if(e.dead)continue;const d=hypot(e.x-s.x,e.y-s.y);if(d<bestD){best=e;bestD=d;}}
    return best;
  }
  function stepSummon(s,dt){
    const spec=summonSpecOf(s.kind),owner=actorOf(s.owner),temper=expressionOf(s.face).temperament,speed=spec.speed*temper.speed;
    s.ageMs+=dt;s.hitMs=Math.max(0,s.hitMs-dt);s.cdMs=Math.max(0,s.cdMs-dt);
    const ownerDistance=hypot(owner.x-s.x,owner.y-s.y);
    if(!spec.anchored&&ownerDistance>SUMMON_RETURN){const p=summonSpawnPoint(owner,{x:owner.x+SUMMON_FOLLOW,y:owner.y},s.r);s.x=p.x;s.y=p.y;s.targetId=0;return;}
    let enemy=nearestEnemyOf(s,SUMMON_SIGHT);
    if(enemy&&hypot(owner.x-enemy.x,owner.y-enemy.y)>SUMMON_LEASH)enemy=null;
    s.targetId=enemy?enemy.id:0;
    if(enemy){
      const dx=enemy.x-s.x,dy=enemy.y-s.y,d=hypot(dx,dy)||1,engage=spec.strike.engageDistance(s,enemy);
      if(dx)s.faceX=dx>0?1:-1;
      if(d>engage){if(!spec.anchored)moveCollider(s,dx/d*speed*dt/1000,dy/d*speed*dt/1000,s.r*.68);}
      else if(s.cdMs<=0){s.cdMs=spec.strike.cooldownMs/temper.attackRate;spec.strike.execute(s,enemy,spec.effects);}
    }else if(!spec.anchored&&ownerDistance>SUMMON_FOLLOW){
      const dx=owner.x-s.x,dy=owner.y-s.y;moveCollider(s,dx/ownerDistance*speed*.9*dt/1000,dy/ownerDistance*speed*.9*dt/1000,s.r*.68);
    }
  }
  // ---- unit collision -----------------------------------------------------------------------------------------------
  // Summons and living enemies are soft discs: overlapping pairs are pushed apart in proportion to how little each one weighs.
  // Anchored summons never move, bosses barely move. Pair order is the array order (enemies, then summons), so every peer
  // computes the same positions. The player keeps the existing enemy-vs-hero separation and is not blocked by summons.
  class UnitBody {
    constructor(unit,weight,radiusScale){this.unit=unit;this.weight=weight;this.radiusScale=radiusScale;}
    get radius(){return this.unit.r*this.radiusScale;}
    get inverseMass(){return this.weight===Infinity?0:1/this.weight;}
    static of(unit,isSummon){
      if(isSummon){const spec=summonSpecOf(unit.kind);return new UnitBody(unit,spec.anchored?Infinity:spec.taunt?2:1,1.15);}
      return new UnitBody(unit,unit.kind==='boss'?8:1,.85);
    }
  }
  class UnitSeparator {
    constructor({strength=.9,maxStep=8,passes=2}={}){this.strength=strength;this.maxStep=maxStep;this.passes=passes;}
    resolve(enemies,summons){
      const bodies=[];
      for(const e of enemies)if(!e.dead)bodies.push(UnitBody.of(e,false));
      for(const s of summons)if(s.hp>0)bodies.push(UnitBody.of(s,true));
      for(let pass=0;pass<this.passes;pass++)for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++)this.separate(bodies[i],bodies[j]);
    }
    separate(a,b){
      const contact=a.radius+b.radius,dx=b.unit.x-a.unit.x,dy=b.unit.y-a.unit.y;
      if(Math.abs(dx)>=contact||Math.abs(dy)>=contact)return;
      let d=hypot(dx,dy);if(d>=contact)return;
      const total=a.inverseMass+b.inverseMass;if(total===0)return;
      let nx,ny;
      if(d<.001){const angle=(a.unit.id*2.399963+b.unit.id*1.618034)%(Math.PI*2);nx=Math.cos(angle);ny=Math.sin(angle);d=0;}else{nx=dx/d;ny=dy/d;}
      const push=Math.min(this.maxStep,(contact-d)*this.strength);
      this.shift(a.unit,-nx*push*a.inverseMass/total,-ny*push*a.inverseMass/total);
      this.shift(b.unit, nx*push*b.inverseMass/total, ny*push*b.inverseMass/total);
    }
    shift(unit,dx,dy){if(!dx&&!dy)return;moveCollider(unit,dx,dy,unit.r*.68);}
  }
  const unitSeparator=new UnitSeparator();
  function separateUnits(){unitSeparator.resolve(world.enemies,world.summons);}
  function tickSummons(dt){
    for(const s of world.summons)stepSummon(s,dt);
    for(let i=world.summons.length-1;i>=0;i--)if(world.summons[i].hp<=0)world.summons.splice(i,1);
  }
  // What an enemy attacks: the nearest summon that is noticed (or a taunting one) before the player.
  function enemyTarget(e,fallback){
    let best=null,bestD=Infinity;
    for(const s of world.summons){const d=hypot(s.x-e.x,s.y-e.y),notice=SUMMON_AGGRO+(summonSpecOf(s.kind).taunt?SUMMON_TAUNT_BONUS:0);if(d<notice&&d<bestD){best=s;bestD=d;}}
    if(!best)return fallback;
    const playerD=hypot(fallback.x-e.x,fallback.y-e.y);
    return summonSpecOf(best.kind).taunt||bestD<playerD+60?best:fallback;
  }
