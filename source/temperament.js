  // Temperament: the two sliders that replace drawing a face. The player draws only the body outline; each summon carries
  // the slider steps it was drawn with, and its face is generated from them. One table (TRAIT_AXES) drives the stat
  // multipliers, the slider labels, the help text and the face, so none of them is written twice.
  const TRAIT_STEP_MAX=3;
  const TRAIT_STATS=Object.freeze({hp:'체력',damage:'공격력',attackRate:'공격 속도',speed:'이동 속도'});
  // One slider. `effects` is the multiplier change per step on each stat: the first listed stat is the advantage that
  // grows toward the high end, the others are what that end costs (the low end reverses every sign).
  class TraitAxis{
    constructor(id,name,lowLabel,highLabel,effects){this.id=id;this.name=name;this.lowLabel=lowLabel;this.highLabel=highLabel;this.effects=Object.freeze({...effects});Object.freeze(this);}
    validStep(step){return Number.isSafeInteger(step)&&Math.abs(step)<=TRAIT_STEP_MAX;}
  }
  const TRAIT_AXES=Object.freeze([
    new TraitAxis('bold','기세','느긋','사나움',{damage:.1,hp:-.07}),
    new TraitAxis('quick','기민','둔함','날램',{speed:.1,attackRate:.08,hp:-.05})
  ]);
  const TRAIT_IDS=Object.freeze(TRAIT_AXES.map(axis=>axis.id));
  // The steps a summon was drawn with, as plain integers on shots and summons: {bold:-3..3, quick:-3..3}.
  const NEUTRAL_STEPS=Object.freeze(Object.fromEntries(TRAIT_IDS.map(id=>[id,0])));
  function validSteps(owner){return !!owner&&TRAIT_AXES.every(axis=>axis.validStep(owner[axis.id]));}
  function stepsOf(owner){return Object.fromEntries(TRAIT_IDS.map(id=>[id,owner?.[id]??0]));}
  // Stat multipliers for a set of steps. Every extreme gains one stat and pays another, so no setting is strictly best.
  class Temperament{
    constructor(steps){
      const total={hp:0,damage:0,attackRate:0,speed:0};
      for(const axis of TRAIT_AXES)for(const [stat,perStep] of Object.entries(axis.effects))total[stat]+=perStep*(steps?.[axis.id]??0);
      for(const stat of Object.keys(TRAIT_STATS))this[stat]=Math.round((1+total[stat])*1000)/1000;
      Object.freeze(this);
    }
    percent(stat){return Math.round((this[stat]-1)*100);}
    statsWhere(test){return Object.keys(TRAIT_STATS).filter(stat=>test(this[stat]));}
    get advantages(){return this.statsWhere(m=>m>1);}
    get disadvantages(){return this.statsWhere(m=>m<1);}
    describe(stats){return stats.map(stat=>`${TRAIT_STATS[stat]} ${this.percent(stat)>0?'+':''}${this.percent(stat)}%`).join(' · ');}
    summary(){
      if(!this.advantages.length&&!this.disadvantages.length)return '특성 없음';
      return `이점 ${this.describe(this.advantages)||'없음'} / 약점 ${this.describe(this.disadvantages)||'없음'}`;
    }
  }
  const temperamentOf=owner=>new Temperament(owner);
  // The face the steps produce, as marks in unit coordinates (x right, y down, the body centre at 0,0).
  //   {type:'line',x1,y1,x2,y2} {type:'arc',cx,cy,rx,ry,a0,a1} {type:'dot',x,y,r} {type:'accent',name:'vein'|'zzz'|'blush'}
  // quick opens or closes the eyes and mouth; bold slants the brows and bends the mouth from a smile to a frown.
  // The world drawing adds blinking and motion on top of these marks, the slider preview draws them still.
  class TraitFace{
    static #cache=new Map();
    // Memoised per step pair: 49 faces at most, shared by every summon that wears them (the marks are frozen).
    static marks(steps){
      const key=(steps?.bold??0)*10+(steps?.quick??0);let marks=TraitFace.#cache.get(key);
      if(!marks){marks=Object.freeze(TraitFace.#build(steps).map(m=>Object.freeze(m)));TraitFace.#cache.set(key,marks);}
      return marks;
    }
    static #build(steps){
      const b=(steps?.bold??0)/TRAIT_STEP_MAX,k=(steps?.quick??0)/TRAIT_STEP_MAX,marks=[],eyeY=-.2,eyeX=.42;
      const eyeRy=.02+.18*(k+1)/2,eyeRx=.13+.04*Math.max(0,k);
      for(const side of [-1,1]){
        if(eyeRy<.05)marks.push({type:'line',x1:side*eyeX-eyeRx,y1:eyeY+.06,x2:side*eyeX+eyeRx,y2:eyeY+.06});
        else{marks.push({type:'arc',cx:side*eyeX,cy:eyeY,rx:eyeRx,ry:eyeRy,a0:0,a1:Math.PI*2});marks.push({type:'dot',x:side*eyeX,y:eyeY,r:Math.max(.045,eyeRy*.42)});}
        // Brows sit above the eye top. Boldness slants them in toward the nose; a relaxed face only lifts them.
        if(Math.abs(b)>=.3){
          const lift=eyeY-eyeRy-.14-(b<0?.03:0)-.04*Math.max(0,k),inner=b>0?lift+.09*b:lift,outer=b>0?lift-.06*b:lift;
          marks.push({type:'line',x1:side*(eyeX-.2),y1:inner,x2:side*(eyeX+.2),y2:outer});
        }
      }
      const my=.42,mw=k<-.6?.1:.3,bend=-.16*b;
      if(k>.6&&b<.5){marks.push({type:'arc',cx:0,cy:my+.04,rx:.12+.05*k,ry:.05+.1*k,a0:0,a1:Math.PI*2});}
      else marks.push({type:'curve',x1:-mw,y1:my,cx:0,cy:my+2*bend,x2:mw,y2:my});
      if(b>=1)marks.push({type:'accent',name:'vein'});
      if(k<=-1)marks.push({type:'accent',name:'zzz'});
      if(b<=-.6)marks.push({type:'accent',name:'blush'});
      return marks;
    }
  }
