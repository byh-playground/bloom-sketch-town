  // Recognizes a drawn face (any number of strokes) as one of the expressions in face-model.js.
  // Image fit mirrors train_face.py: all strokes share one bounding box, longest side 23.5 of 32.
  // Anything the classifier is not confident about becomes a neutral face, which carries no traits.
  class FaceRecognizer{
    constructor(model){
      const decode=src=>{const bytes=Uint8Array.from(atob(src),c=>c.charCodeAt(0));return new Float32Array(bytes.buffer);};
      this.labels=model.labels;this.hidden=model.hidden;this.minConfidence=model.minConfidence;
      this.w1=decode(model.w1);this.b1=decode(model.b1);this.w2=decode(model.w2);this.b2=decode(model.b2);
      this.big=document.createElement('canvas');this.big.width=96;this.big.height=96;
      this.small=document.createElement('canvas');this.small.width=32;this.small.height=32;
      this.bigCtx=this.big.getContext('2d',{willReadFrequently:true});this.smallCtx=this.small.getContext('2d',{willReadFrequently:true});
    }
    image(strokes){
      let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
      for(const stroke of strokes)for(const p of stroke){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
      const scale=23.5/Math.max(.0001,maxX-minX,maxY-minY),mx=(minX+maxX)/2,my=(minY+maxY)/2,g=this.bigCtx;
      g.fillStyle='#000';g.fillRect(0,0,96,96);g.lineJoin='round';g.lineCap='round';g.lineWidth=7;g.strokeStyle='#fff';
      for(const stroke of strokes){
        g.beginPath();
        stroke.forEach((p,i)=>{const x=48+3*(p.x-mx)*scale,y=48+3*(p.y-my)*scale;i?g.lineTo(x,y):g.moveTo(x,y);});
        if(stroke.length===1){const p=stroke[0];g.lineTo(48+3*(p.x-mx)*scale+.01,48+3*(p.y-my)*scale);}
        g.stroke();
      }
      this.smallCtx.fillStyle='#000';this.smallCtx.fillRect(0,0,32,32);this.smallCtx.drawImage(this.big,0,0,32,32);
      const rgba=this.smallCtx.getImageData(0,0,32,32).data,out=new Float32Array(1024);
      for(let i=0;i<1024;i++)out[i]=rgba[i*4]/255;
      return out;
    }
    probabilities(strokes){
      const x=this.image(strokes),h=new Float32Array(this.hidden),n=this.labels.length,z=new Float32Array(n);
      for(let j=0;j<this.hidden;j++){let s=this.b1[j];const base=j*1024;for(let k=0;k<1024;k++)s+=x[k]*this.w1[base+k];h[j]=Math.max(0,s);}
      let max=-Infinity;
      for(let j=0;j<n;j++){let s=this.b2[j];const base=j*this.hidden;for(let k=0;k<this.hidden;k++)s+=h[k]*this.w2[base+k];z[j]=s;max=Math.max(max,s);}
      let sum=0;for(let j=0;j<n;j++){z[j]=Math.exp(z[j]-max);sum+=z[j];}
      return Array.from(z,v=>v/sum);
    }
    // -> {id, confidence, accepted, probabilities}; id is 'neutral' when the best guess is neutral or not confident enough.
    recognize(strokes){
      if(!strokes.length||!strokes.some(s=>s.length))return {id:'neutral',confidence:1,accepted:false,probabilities:null};
      const prob=this.probabilities(strokes);let best=0;for(let i=1;i<prob.length;i++)if(prob[i]>prob[best])best=i;
      const accepted=best!==0&&prob[best]>=this.minConfidence;
      // candidate: the most likely non-neutral expression even when it is not confident enough (the live ghost shows it faintly).
      let cand=1;for(let i=2;i<prob.length;i++)if(prob[i]>prob[cand])cand=i;
      return {id:accepted?this.labels[best]:'neutral',confidence:prob[best],accepted,candidate:this.labels[cand],probabilities:prob};
    }
  }
  const faceRecognizer=new FaceRecognizer(FACE_MODEL);
