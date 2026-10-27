  // Expressions: the face a summon wears decides its temperament (what it is better and worse at).
  // Single source for the six faces. Ids and their order come from the recognizer's labels (face-model.js),
  // so the classifier output index and this table cannot drift apart.
  //
  // A Temperament multiplies four stats. Multipliers above 1 are the advantage, below 1 the disadvantage;
  // the on-screen text is derived from the numbers, never written twice.
  const TEMPERAMENT_AXES=Object.freeze({hp:'체력',damage:'공격력',attackRate:'공격 속도',speed:'이동 속도'});
  class Temperament{
    constructor(multipliers={}){
      for(const axis of Object.keys(TEMPERAMENT_AXES))this[axis]=multipliers[axis]??1;
      Object.freeze(this);
    }
    percent(axis){return Math.round((this[axis]-1)*100);}
    axesWhere(test){return Object.keys(TEMPERAMENT_AXES).filter(axis=>test(this[axis]));}
    get advantages(){return this.axesWhere(m=>m>1);}
    get disadvantages(){return this.axesWhere(m=>m<1);}
    describe(axes){return axes.map(axis=>`${TEMPERAMENT_AXES[axis]} ${this.percent(axis)>0?'+':''}${this.percent(axis)}%`).join(' · ');}
    summary(){
      if(!this.advantages.length&&!this.disadvantages.length)return '특성 없음';
      return `이점 ${this.describe(this.advantages)} / 약점 ${this.describe(this.disadvantages)}`;
    }
  }
  // Guides are the easy reference faces shown while drawing (unit coordinates, y down). A one-point stroke is a tap.
  const guideArc=(cx,cy,rx,ry,a0,a1,n=10)=>Array.from({length:n+1},(_,i)=>[cx+rx*Math.cos(a0+(a1-a0)*i/n),cy+ry*Math.sin(a0+(a1-a0)*i/n)]);
  const EYE_DOTS=[[[-.45,-.3]],[[.45,-.3]]];
  class Expression{
    constructor(id,name,temperament,guide){this.id=id;this.name=name;this.temperament=temperament;this.guide=Object.freeze(guide);Object.freeze(this);}
    get traitless(){return !this.temperament.advantages.length&&!this.temperament.disadvantages.length;}
  }
  const EXPRESSION_TABLE=Object.freeze({
    neutral:new Expression('neutral','무표정',new Temperament(),[...EYE_DOTS,[[-.38,.45],[.38,.45]]]),
    joy:new Expression('joy','기쁨',new Temperament({speed:1.2,attackRate:1.1,hp:.85}),[...EYE_DOTS,guideArc(0,.2,.45,.3,.12*Math.PI,.88*Math.PI)]),
    anger:new Expression('anger','화남',new Temperament({damage:1.35,hp:.8}),[[[-.7,-.5],[-.25,-.18]],[[.7,-.5],[.25,-.18]],[[-.38,.45],[.38,.45]]]),
    sleepy:new Expression('sleepy','졸림',new Temperament({hp:1.4,attackRate:.7,speed:.75}),[[[-.68,-.3],[-.25,-.28]],[[.25,-.28],[.68,-.3]],[[-.15,.45],[.15,.45]]]),
    surprise:new Expression('surprise','놀람',new Temperament({speed:1.3,attackRate:1.25,hp:.7}),[...EYE_DOTS,guideArc(0,.5,.22,.22,0,Math.PI*2,16)]),
    sad:new Expression('sad','슬픔',new Temperament({hp:1.25,damage:.75}),[...EYE_DOTS,guideArc(0,.88,.45,.3,1.12*Math.PI,1.88*Math.PI)])
  });
  if(FACE_MODEL.labels.join()!==Object.keys(EXPRESSION_TABLE).join())throw new Error('표정 목록이 인식기 라벨과 다릅니다');
  const EXPRESSIONS=Object.freeze(FACE_MODEL.labels.map(id=>EXPRESSION_TABLE[id]));
  function expressionOf(id){return Object.hasOwn(EXPRESSION_TABLE,id)?EXPRESSION_TABLE[id]:EXPRESSION_TABLE.neutral;}
  function validExpressionId(id){return typeof id==='string'&&Object.hasOwn(EXPRESSION_TABLE,id);}
