  // Intro film director. The introduction (source/showcase.js) plays the REAL game inside a disposable frame (?showcaseDemo=1);
  // this file only stages the scene (who stands where, full ink and health) and performs the same inputs a player would
  // (a stroke on the battlefield, a click on a personality, a tap on a summon). The fighting itself is the game's own simulation.
  //
  // The timeline names a step as `name:arg:arg`. Positions are screen fractions from the viewport centre (u to the right, v down),
  // so the film frames the same way on a phone and on a desktop. A step returns true when done; false makes the host retry it.
  if(new URLSearchParams(location.search).get('showcaseDemo')==='1'){
    const STROKE_MS=700;                 // how long the finger takes to draw one outline, so the viewer sees the ink go down
    const FOE_KIND='chaser';
    const PORTRAIT_APPROACH_V=-.34;     // portrait: packs stand this fraction of the screen height above the hero
    const SAFE_X=.06,SAFE_TOP=.2,SAFE_BOTTOM=.25; // the screen area free of the HUD, where a far pack must be drawn on
    // A far pack stands this far from the hero. Idle summons stay within ~100 of the hero, so none of them sees it (SUMMON_SIGHT = 480);
    // the volley (MAGIC_RANGE = 720) still reaches it. A portrait screen shows less, so the pack stands closer there.
    const farDistance=()=>innerHeight>innerWidth?SUMMON_SIGHT+150:SUMMON_SIGHT+220;
    const GOLDEN=2.399963229728653;
    class ShowcaseDirector{
      #drawing=false;
      // The game is ready to be filmed once the loading overlay is gone and the first frame is drawn.
      ready(){return document.getElementById('boot')?.classList.contains('done')===true&&renderer.stats?.vertices>0;}
      run(command){
        const [name,...raw]=String(command).split(':'),step=this[`step_${name}`];
        return typeof step==='function'&&step.apply(this,raw.map(value=>value!==''&&Number.isFinite(+value)?+value:value))!==false;
      }

      // ---- geometry: screen fractions <-> world ------------------------------------------------------------------------
      #pixelsPerUnit(){const a={x:0,y:0},b={x:0,y:0};renderer.worldToScreenInto(player.x,player.y,a);renderer.worldToScreenInto(player.x+100,player.y,b);return (b.x-a.x)/100;}
      #worldAt(u,v){const o={x:0,y:0};renderer.worldToScreenInto(player.x,player.y,o);const k=this.#pixelsPerUnit();return {x:player.x+(vw*(.5+u)-o.x)/k,y:player.y+(vh*(.5+v)-o.y)/k};}
      #free(x,y,r){
        if(!touchesObstacle(x,y,r))return {x,y};
        for(let ring=1;ring<=10;ring++)for(let k=0;k<ring*6;k++){const a=k*Math.PI*2/(ring*6),px=x+Math.cos(a)*ring*24,py=y+Math.sin(a)*ring*24;if(!touchesObstacle(px,py,r))return {x:px,y:py};}
        return {x,y};
      }
      #foes(){return world.enemies.filter(e=>!e.dead);}

      // ---- scene -------------------------------------------------------------------------------------------------------
      step_stage(){
        world.enemies.length=0;world.summons.length=0;world.casts.length=0;world.castQueue.length=0;world.hazards.length=0;world.fields.length=0;
        for(const nest of world.nests){nest.on=false;nest.done=true;}
        selectedUnits.clear();selectedTemper=DEFAULT_TEMPER;paintTraitDock();
        return this.step_mend();
      }
      // Full health, ink and summons, so every chapter starts from a healthy field.
      step_mend(){
        player.hp=player.maxHp;player.ink=player.maxInk;player.inkDelayMs=0;player.invulMs=60000;player.koMs=0;
        player.nextMagicAtMs=0;
        for(const s of world.summons)s.hp=s.maxHp;
        return true;
      }
      // Where enemies come from: on a portrait screen the dock covers the bottom and the long axis is vertical, so the pack stands above
      // the hero (v fixed, the old v becomes the sideways offset); on a landscape screen (u,v) are used as given.
      #approachAt(u,v){return innerHeight>innerWidth?this.#worldAt(v,PORTRAIT_APPROACH_V):this.#worldAt(u,v);}
      // The point farDistance() from the hero in the direction of (u,v). Near the map edge the camera stops following the hero, so a point
      // may fall off screen; the mirrored directions are tried in turn, and the first one that lands inside the safe screen area wins.
      #farCenter(u,v){
        const spot={x:0,y:0};
        const toward=(du,dv)=>{
          const target=this.#approachAt(du,dv),dx=target.x-player.x,dy=target.y-player.y,len=hypot(dx,dy)||1;
          return {x:player.x+dx/len*farDistance(),y:player.y+dy/len*farDistance()};
        };
        const candidates=[[u,v],[-u,v],[u,-v],[-u,-v]].map(([du,dv])=>toward(du,dv));
        const inside=p=>{renderer.worldToScreenInto(p.x,p.y,spot);return spot.x>SAFE_X*innerWidth&&spot.x<(1-SAFE_X)*innerWidth&&spot.y>SAFE_TOP*innerHeight&&spot.y<(1-SAFE_BOTTOM)*innerHeight;};
        return candidates.find(inside)??candidates[0];
      }
      // Remove every living enemy, so the next pack is the only one the viewer sees.
      step_clear(){world.enemies.length=0;return true;}
      // A pack of hunters at the screen fraction (u,v); `hpScale` makes them sturdier. With `holdMs` > 0 the pack is "far": it stands
      // farDistance() from the hero (beyond every idle summon's sight), in the direction of (u,v), and stands still for holdMs, so the volley is what reaches it.
      step_foes(count,u,v,hpScale=1,holdMs=0){
        const center=holdMs>0?this.#farCenter(u,v):this.#approachAt(u,v);
        for(let i=0;i<count;i++){const spread=i?26*Math.sqrt(i):0,a=i*GOLDEN,p=this.#free(center.x+Math.cos(a)*spread,center.y+Math.sin(a)*spread,24);const foe=spawnEnemy(FOE_KIND,p.x,p.y,-1,-1,hpScale);foe.stunMs=holdMs;}
        return true;
      }
      // Boss n appears at (u,v) with the earlier bosses already fallen, so its own rule (immunity, weak point) is what the viewer sees.
      step_boss(n,u,v){
        world.bossesDefeated=n;world.bossState=world.bossState.map((_,i)=>i<n?2:0);world.bossState[n]=1;
        const center=this.#approachAt(u,v),p=this.#free(center.x,center.y,70);spawnEnemy('boss',p.x,p.y,n);
        return true;
      }
      // Make sure the given kinds stand next to the hero (a chapter may need a unit an earlier fight lost).
      step_ensure(...kinds){
        kinds.forEach((kind,i)=>{
          if(ownSummons().some(s=>s.kind===kind))return;
          const p=this.#free(player.x+60+i*50,player.y-40,20);
          spawnSummon(player,{...makeShotData(samplePoints(kind,150,150)),x:p.x,y:p.y,temper:selectedTemper});
        });
        return true;
      }

      // ---- the player's inputs -----------------------------------------------------------------------------------------
      step_pick(temper){const button=$('traitChoices').children[temper];if(!button)return false;button.click();return true;}
      step_select(kind){const unit=ownSummons().find(s=>s.kind===kind);return unit?toggleUnitAt({x:unit.x,y:unit.y}):false;}
      // An outline of `kind` drawn by a finger centred on the screen fraction (u,v), `size` pixels wide.
      step_draw(kind,u,v,size=150){
        const center={x:vw*(.5+u),y:vh*(.5+v)};
        return this.#stroke(kind,center,size);
      }
      // A spell drawn right on the hunters: at the middle of everything that is alive.
      step_magic(kind,size=150){
        const foes=this.#foes();if(!foes.length)return false;
        const world_={x:foes.reduce((s,e)=>s+e.x,0)/foes.length,y:foes.reduce((s,e)=>s+e.y,0)/foes.length},center={x:0,y:0};
        renderer.worldToScreenInto(world_.x,world_.y,center);
        return this.#stroke(kind,center,size);
      }
      #stroke(kind,center,size){
        if(this.#drawing||!drawingAllowed())return false;
        const points=samplePoints(kind,size,size);if(points.length<3)return false;
        const xs=points.map(p=>p.x),ys=points.map(p=>p.y),mx=(Math.min(...xs)+Math.max(...xs))/2,my=(Math.min(...ys)+Math.max(...ys))/2;
        const path=points.map(p=>({x:center.x+p.x-mx,y:center.y+p.y-my}));
        const send=(type,p)=>collectCombatDrawing({type,pointerId:71,x:p.x,y:p.y});
        this.#drawing=true;send('down',path[0]);
        const started=performance.now();let sent=0;
        const frame=now=>{
          const t=Math.min(1,(now-started)/STROKE_MS),upto=Math.round(t*(path.length-1));
          while(sent<upto)send('move',path[++sent]);
          if(t<1){requestAnimationFrame(frame);return;}
          send('up',path[path.length-1]);this.#drawing=false;
        };
        requestAnimationFrame(frame);
        return true;
      }
    }
    window.BloomSketchShowcase=Object.freeze(new ShowcaseDirector());
  }
