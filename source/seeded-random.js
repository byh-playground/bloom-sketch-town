// 결정론 난수. 같은 시드 → 모든 브라우저에서 같은 수열(정수 연산만 사용). 맵 생성기가 사용합니다.
  // mulberry32 stream. One instance per generation attempt.
  class SeededRandom{
    constructor(seed){this.state=seed>>>0;}
    next(){
      this.state=(this.state+0x6D2B79F5)>>>0;let t=this.state;
      t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);
      return((t^(t>>>14))>>>0)/4294967296;
    }
    range(min,max){return min+(max-min)*this.next();}
    int(min,max){return Math.floor(this.range(min,max+1));}
    pick(list){return list[Math.floor(this.next()*list.length)];}
    shuffled(list){const out=list.slice();for(let i=out.length-1;i>0;i--){const j=Math.floor(this.next()*(i+1)),t=out[i];out[i]=out[j];out[j]=t;}return out;}
  }
