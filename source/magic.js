  // Magic: drawing a flame, a water drop or a lightning bolt does not summon anything. The drawn point is the target, and the
  // caster plus every living summon of the caster within MAGIC_RANGE of that point fire together. Single source for the three spells.
  //
  // Structure:
  //   Magic (is-a base) -> LobMagic  (flies in an arc, lands after a flight and hurts an area)
  //                      | BoltMagic (straight and instant, hurts every enemy on the line from the shooter to the target)
  //   Magic HAS a list of HitEffect objects (summons.js) and an optional steam reaction (steamedBy).
  // The damage source passed to damageEnemy is the spell kind, so boss rules (bosses.js) keep working.
  const MAGIC_RANGE=720;           // a shooter farther than this from the target point does not take part
  const MAGIC_COOLDOWN_MS=500;     // one shared cooldown per caster, for all three spells
  const MAGIC_INK=30;              // flat price per cast, in ink
  const MAGIC_CASTER_DAMAGE=14;    // the caster's own shot
  const MAGIC_SUMMON_FACTOR=2;     // a summon's shot = its basic attack damage x this x its power
  const MAGIC_GRAVITY=1500;        // units/s^2 pulling a lobbed shot's height z back to the ground
  const MAGIC_LAUNCH_Z=14;         // height of the shooter's hand above the ground
  const MAGIC_SPREAD=15;           // lobbed shots land on a golden-angle spiral around the target so they do not stack on one pixel
  const MAGIC_BOLT_HALF_WIDTH=16;  // an enemy within this distance of the bolt line is struck
  const MAGIC_STEAM_FACTOR=1.5,MAGIC_STEAM_STUN_MS=450,MAGIC_STEAM_COLOR='#8fb8c9';
  const GOLDEN_ANGLE=2.399963229728653;

  class Magic{
    // steamedBy: the enemy status this spell burns off into steam (fire on a wet enemy, water on a burning one).
    constructor({kind,name,color,damageFactor,effects=[],steamedBy=null}){Object.assign(this,{kind,name,color,damageFactor,steamedBy});this.effects=Object.freeze([...effects]);}
    get role(){return '마법 · 일제 사격';}
    // One shooter's hit on one enemy: damage, then the spell's effects; a steam reaction replaces the effects.
    hit(enemy,amount){
      if(enemy.dead)return;
      const steam=this.steamedBy!==null&&enemy[this.steamedBy]>0;
      damageEnemy(enemy,steam?amount*MAGIC_STEAM_FACTOR:amount,enemy.x,enemy.y-18,this.color,this.kind);
      if(enemy.dead)return;
      if(steam){
        enemy.wetMs=0;enemy.burnMs=0;enemy.stunMs=Math.max(enemy.stunMs,MAGIC_STEAM_STUN_MS);
        world.fields.push({kind:'ring',x:enemy.x,y:enemy.y,r:enemy.r+40,ageMs:0,lifeMs:420,color:MAGIC_STEAM_COLOR});burst(enemy.x,enemy.y,MAGIC_STEAM_COLOR,6,70);
      }else for(const effect of this.effects)effect.apply(this,enemy,amount);
    }
    // All shooters fire at the target. `areaPower` (0..1, the drawn size) scales the area of effect.
    fire(){throw new Error('Magic.fire is implemented by LobMagic and BoltMagic');}
  }
  class LobMagic extends Magic{
    constructor(fields,{radius,groundField}){super(fields);this.radius=radius;this.groundField=groundField;}
    fire(owner,shooters,target,areaPower){
      const radius=+(this.radius*(.8+.5*clamp(areaPower,0,1))).toFixed(2);
      shooters.forEach((shooter,index)=>{
        const spread=index===0?0:MAGIC_SPREAD*Math.sqrt(index),angle=index*GOLDEN_ANGLE;
        const tx=clamp(target.x+Math.cos(angle)*spread,0,CFG.world.width),ty=clamp(target.y+Math.sin(angle)*spread,0,CFG.world.height);
        const dist=hypot(tx-shooter.x,ty-shooter.y),flight=clamp(260+dist*.65,320,900)/1000;
        // x,y is the ground position and z the height above it (drawn at y - z). z(t)=z0+vz*t-g*t^2/2 reaches 0 at the end of the flight.
        world.fields.push({kind:'lob',spell:this.kind,owner,x:shooter.x,y:shooter.y,z:MAGIC_LAUNCH_Z,vx:(tx-shooter.x)/flight,vy:(ty-shooter.y)/flight,
          vz:(MAGIC_GRAVITY*flight*flight/2-MAGIC_LAUNCH_Z)/flight,r:dist/2+60,radius,damage:+(shooter.damage*this.damageFactor).toFixed(2),
          ageMs:0,lifeMs:4000,color:this.color,landed:false});
      });
    }
    land(lob){
      for(const enemy of world.enemies)if(!enemy.dead&&hypot(enemy.x-lob.x,enemy.y-lob.y)<lob.radius+enemy.r)this.hit(enemy,lob.damage);
      world.fields.push({kind:this.groundField,x:lob.x,y:lob.y,r:lob.radius,ageMs:0,lifeMs:520,color:this.color});
      burst(lob.x,lob.y,this.color,6,80);
    }
  }
  class BoltMagic extends Magic{
    fire(owner,shooters,target){
      for(const shooter of shooters){
        world.fields.push({kind:'arc',x:shooter.x,y:shooter.y,ex:target.x,ey:target.y,ageMs:0,lifeMs:260,color:this.color});
        for(const enemy of world.enemies)if(!enemy.dead&&segmentCircle(shooter.x,shooter.y,target.x,target.y,enemy.x,enemy.y,enemy.r+MAGIC_BOLT_HALF_WIDTH))this.hit(enemy,shooter.damage*this.damageFactor);
      }
      world.fields.push({kind:'ring',x:target.x,y:target.y,r:56,ageMs:0,lifeMs:320,color:this.color});
    }
  }

  const MAGICS=Object.freeze({
    flame:    Object.freeze(new LobMagic({kind:'flame',name:'불꽃 마법',color:art.flame,damageFactor:1,effects:[new BurnEffect()],steamedBy:'wetMs'},{radius:64,groundField:'flame'})),
    water:    Object.freeze(new LobMagic({kind:'water',name:'물방울 마법',color:art.water,damageFactor:.75,effects:[new WetEffect()],steamedBy:'burnMs'},{radius:76,groundField:'splash'})),
    lightning:Object.freeze(new BoltMagic({kind:'lightning',name:'번개 마법',color:art.lightning,damageFactor:.9,effects:[new ChainEffect(230,320,.31)]}))
  });
  const isMagicKind=kind=>Object.hasOwn(MAGICS,kind);

  // The caster (if in range) and each living summon in range, with the damage of one shot each.
  function magicShooters(actor,target){
    const id=actorId(actor),list=[];
    if(hypot(actor.x-target.x,actor.y-target.y)<=MAGIC_RANGE)list.push({x:actor.x,y:actor.y-10,damage:MAGIC_CASTER_DAMAGE*actor.power});
    for(const s of world.summons)if(s.owner===id&&s.hp>0&&hypot(s.x-target.x,s.y-target.y)<=MAGIC_RANGE)list.push({x:s.x,y:s.y-s.r*.6,damage:summonSpecOf(s.kind).strike.damage*s.power*MAGIC_SUMMON_FACTOR});
    return list;
  }
  let lastMagicCast=null;          // {spell,shooters} of the latest cast on this page; presentation/debug only, not part of the rollback state
  // Runs inside withActor(actor). Returns whether the spell was cast.
  function castMagic(actor,shot){
    const spell=MAGICS[shot.kind];
    if(!spell||actor.hp<=0||actor.koMs>0)return false;
    if(world.clockMs<actor.nextMagicAtMs){showResult(`${spell.name} · ${((actor.nextMagicAtMs-world.clockMs)/1000).toFixed(1)}초 뒤에 다시 쓸 수 있어요`,1200);return false;}
    const target={x:shot.x,y:shot.y},shooters=magicShooters(actor,target);
    if(!shooters.length){showResult('사거리 밖 · 내 캐릭터나 소환수 가까이에 그려 주세요',1800);return false;}
    if(!spendInk(actor,+(MAGIC_INK*actor.inkCostRate).toFixed(3)))return false;
    actor.nextMagicAtMs=world.clockMs+MAGIC_COOLDOWN_MS;
    spell.fire(actorId(actor),shooters,target,shot.areaPower);
    lastMagicCast={spell:spell.kind,shooters:shooters.length};
    showResult(`${spell.name} · ${shooters.length}발`,1400);sfx('throw');
    return true;
  }
  // Lobbed shots fly by integrating x, y and z each tick; one that reaches the ground (z <= 0) lands, and its field is retired at once.
  function tickMagic(dt){
    const s=dt/1000;
    for(const f of world.fields){
      if(f.kind!=='lob'||f.landed)continue;
      f.x+=f.vx*s;f.y+=f.vy*s;f.z+=f.vz*s-MAGIC_GRAVITY*s*s/2;f.vz-=MAGIC_GRAVITY*s;
      if(f.z>0)continue;
      f.z=0;f.landed=true;f.ageMs=f.lifeMs;MAGICS[f.spell].land(f);
    }
  }
