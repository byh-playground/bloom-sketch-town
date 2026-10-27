  // Five bosses fought in route order. A boss HAS rules; each rule maps the drawn shape that dealt the damage
  // (the CNN class of the stroke: 'circle', 'flame', ...) to a damage multiplier. The multipliers of all rules multiply.
  // Only shapes the CNN recognises at >= 95% validation accuracy are used, so a correct drawing is not misread.
  class ShapeRule{
    constructor(kinds){this.kinds=Object.freeze([...kinds]);}
    multiplier(){return 1;}
    kindNames(){return this.kinds.map(k=>shapeNames[k]||k).join('·');}
  }
  class ImmuneRule extends ShapeRule{
    multiplier(kind){return this.kinds.includes(kind)?0:1;}
    describe(){return `면역 ${this.kindNames()}`;}
  }
  class WeakRule extends ShapeRule{
    constructor(kinds,factor){super(kinds);this.factor=factor;}
    multiplier(kind){return this.kinds.includes(kind)?this.factor:1;}
    describe(){return `약점 ${this.kindNames()} ×${this.factor}`;}
  }
  // Restriction: shapes outside the list deal only `otherFactor` of their damage.
  class OnlyRule extends ShapeRule{
    constructor(kinds,otherFactor){super(kinds);this.otherFactor=otherFactor;}
    multiplier(kind){return this.kinds.includes(kind)?1:this.otherFactor;}
    describe(){return `${this.kindNames()} 외에는 ${Math.round(this.otherFactor*100)}%`;}
  }

  class BossProfile{
    constructor({id,name,hp,r,speed,damage,color,tempo,rules}){Object.assign(this,{id,name,hp,r,speed,damage,color,tempo});this.rules=Object.freeze([...rules]);Object.freeze(this);}
    multiplier(kind){return this.rules.reduce((m,rule)=>m*rule.multiplier(kind),1);}
    ruleText(){return this.rules.length?this.rules.map(rule=>rule.describe()).join(' · '):'특별한 규칙 없음';}
    // The drawn shape that hurts this boss the most (used by tests and by the end-of-fight helper).
    bestKind(){return SHAPE_KINDS.reduce((best,kind)=>this.multiplier(kind)>this.multiplier(best)?kind:best,SHAPE_KINDS[0]);}
  }

  const SHAPE_KINDS=Object.freeze(['normal','line','circle','triangle','square','flame','water','lightning','star','shuriken','starcircle']);
  const BOSS_PROFILES=Object.freeze([
    new BossProfile({id:'watcher',name:'잉크 감시자',hp:580,r:56,speed:55,damage:23,color:'#8d688e',tempo:1,rules:[]}),
    new BossProfile({id:'fogTurtle',name:'물안개 거북',hp:720,r:60,speed:50,damage:24,color:'#6f9aa5',tempo:1,rules:[new ImmuneRule(['water']),new WeakRule(['flame'],1.8)]}),
    new BossProfile({id:'emberScarecrow',name:'불씨 허수아비',hp:780,r:58,speed:62,damage:26,color:'#c9825a',tempo:.95,rules:[new ImmuneRule(['flame']),new WeakRule(['water'],1.8)]}),
    new BossProfile({id:'stoneCalligrapher',name:'돌 서예가',hp:900,r:64,speed:52,damage:28,color:'#8b8a80',tempo:.9,rules:[new OnlyRule(['triangle','lightning'],.25)]}),
    new BossProfile({id:'blankGiant',name:'빈 종이 거인',hp:1150,r:72,speed:58,damage:30,color:'#b7a8b7',tempo:.8,rules:[new ImmuneRule(['circle']),new WeakRule(['shuriken'],1.8)]})
  ]);
