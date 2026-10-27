  // Personality: the five temperaments a summon can have. The player draws only the body outline and picks one personality
  // (the selector in #traitDock); the summon carries its index as `temper` and its face is generated from the personality's
  // look. One table (PERSONALITIES) drives the stat multipliers, the selector, the help text and the face. Every personality
  // gains in one stat and pays in another, so none is strictly best.
  const LOOK_STEP_MAX=3;
  const TRAIT_STATS=Object.freeze({hp:'체력',damage:'공격력',attackRate:'공격 속도',speed:'이동 속도'});
  class Temperament{
    constructor(multipliers){
      for(const stat of Object.keys(TRAIT_STATS))this[stat]=multipliers[stat]??1;
      Object.freeze(this);
    }
    percent(stat){return Math.round((this[stat]-1)*100);}
    statsWhere(test){return Object.keys(TRAIT_STATS).filter(stat=>test(this[stat]));}
    get advantages(){return this.statsWhere(m=>m>1);}
    get disadvantages(){return this.statsWhere(m=>m<1);}
    describe(stats){return stats.map(stat=>`${TRAIT_STATS[stat]} ${this.percent(stat)>0?'+':''}${this.percent(stat)}%`).join(' · ');}
    summary(){return `이점 ${this.describe(this.advantages)} / 약점 ${this.describe(this.disadvantages)}`;}
  }
  class Personality{
    constructor(id,name,multipliers,look){this.id=id;this.name=name;this.temperament=new Temperament(multipliers);this.look=Object.freeze({...look});Object.freeze(this);}
  }
  const PERSONALITIES=Object.freeze([
    new Personality(0,'발끈',{damage:1.3,hp:.8},{bold:3,quick:1}),
    new Personality(1,'듬직',{hp:1.3,damage:.8},{bold:1,quick:-1}),
    new Personality(2,'느긋',{hp:1.4,attackRate:.7},{bold:-1,quick:-3}),
    new Personality(3,'성급',{attackRate:1.3,hp:.75},{bold:0,quick:3}),
    new Personality(4,'명랑',{speed:1.25,damage:.85},{bold:-3,quick:2})
  ]);
  // A summon or shot carries its personality as the integer `temper` (index in PERSONALITIES).
  const DEFAULT_TEMPER=0;
  function validTemper(owner){return Number.isSafeInteger(owner?.temper)&&owner.temper>=0&&owner.temper<PERSONALITIES.length;}
  const personalityOf=owner=>PERSONALITIES[validTemper(owner)?owner.temper:DEFAULT_TEMPER];
  const temperamentOf=owner=>personalityOf(owner).temperament;
  // The face a look produces, as marks in unit coordinates (x right, y down, the body centre at 0,0).
  //   {type:'line',x1,y1,x2,y2} {type:'arc',cx,cy,rx,ry,a0,a1} {type:'dot',x,y,r} {type:'accent',name:'vein'|'zzz'|'blush'}
  // `look` is {bold,quick} in -3..3: quick opens or closes the eyes and mouth; bold slants the brows and bends the mouth from a smile to a frown.
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
      const b=(steps?.bold??0)/LOOK_STEP_MAX,k=(steps?.quick??0)/LOOK_STEP_MAX,marks=[],eyeY=-.2,eyeX=.42;
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
