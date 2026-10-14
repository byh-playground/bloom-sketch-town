  const $=id=>document.getElementById(id);
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)),mix=(a,b,t)=>a+(b-a)*t,hypot=Math.hypot;
  const art={normal:'#293846',line:'#344e58',circle:'#799c91',triangle:'#d08c63',square:'#8f8b80',flame:'#ce704e',water:'#519cbd',lightning:'#558fbc',star:'#d8a34a',shuriken:'#9887b0',starcircle:'#cd995c'};
  const CFG=Object.freeze({version:'0.13.2',baseHz:60,renderHz:60,inputHz:60,tickMs:1000/30,maxCatchup:8,world:{width:2380,height:1460},player:{hp:120,radius:16,walkSpeed:140,roll:{capacity:2,rechargeMs:650,rangeDiameters:3,durationMinMs:110,durationMaxMs:270,travelSpeed:765,projectileInvulMs:145}},boss:{x:1948,y:706,radius:255},spawnLimit:17,castLimit:4,maxParticles:360});
  $('gameVersion').textContent=`v${CFG.version} · RPG`;
  let PW=280,PH=150; // recognizer owns DRAW-PAD CSS pixels, not world / GPU coordinates.
  const field=$('field'),renderer=new Renderer2D(field,{batchVertices:32768}),draw=$('draw'),drawCtx=draw.getContext('2d'),trainingPad=$('trainingPad'),trainingCtx=trainingPad.getContext('2d');
  const mini=$('map'),miniCtx=mini.getContext('2d');
  let vw=innerWidth,vh=innerHeight,dpr=1,drawDpr=1,trainingDpr=1,tw=330,th=200;
  const shapeNames={line:'선',circle:'원',triangle:'삼각형',square:'사각형',flame:'불꽃',water:'물방울',lightning:'번개',star:'별',shuriken:'표창',starcircle:'별 마법진'};
  const shapeDesc={line:'빠른 기본 공격',circle:'충격·넉백',triangle:'강한 관통',square:'경직·제어',flame:'나루토풍 화상 문양',water:'젖음·감속',lightning:'젖은 적 추가 연쇄',star:'별빛 폭발',shuriken:'오목 사각 표창 · 회전 다단히트',starcircle:'원+별 광역 마법진'};

  function resample(raw,step=3.3){if(raw.length<2)return raw.slice();
    // Adaptive arc-length spacing keeps even long scribbles complete instead of cropping at 256 points.
    let total=0;for(let i=1;i<raw.length;i++)total+=hypot(raw[i].x-raw[i-1].x,raw[i].y-raw[i-1].y);
    step=Math.max(step,total/230);
    const out=[{x:raw[0].x,y:raw[0].y}];let last=raw[0],remain=step;
    for(let k=1;k<raw.length;k++){let a={x:last.x,y:last.y},b=raw[k];let dx=b.x-a.x,dy=b.y-a.y,L=hypot(dx,dy);if(L<1e-6){last=b;continue;}
      while(L>=remain && out.length<256){const t=remain/L;a={x:a.x+dx*t,y:a.y+dy*t};out.push(a);dx=b.x-a.x;dy=b.y-a.y;L=hypot(dx,dy);remain=step;}
      remain-=L;last=b;
    }
    if(hypot(out[out.length-1].x-raw.at(-1).x,out[out.length-1].y-raw.at(-1).y)>1)out.push({...raw.at(-1)});
    return out;
  }
  // One shared, corner-preserving preprocessing contract for classifier and references.
  // Deliberate long tips (lightning/flame/water) are never trimmed by length alone.
  function strokeLength(pts){let v=0;for(let i=1;i<pts.length;i++)v+=hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);return v;}
  function clipTail(pts,start,limit){
    if(pts.length<10)return pts;
    const forward=start?pts:pts.slice().reverse();
    let travelled=0,join=-1;
    for(let i=1;i<forward.length-5;i++){
      travelled+=hypot(forward[i].x-forward[i-1].x,forward[i].y-forward[i-1].y);
      if(travelled>limit)break;
      if(travelled<5)continue;
      const look=Math.max(3,Math.min(8,Math.round(pts.length*.045)));
      if(i+look>=forward.length)break;
      const a=forward[0],b=forward[i],c=forward[i+look];
      const u=hypot(b.x-a.x,b.y-a.y),v=hypot(c.x-b.x,c.y-b.y);
      if(v<5)continue;
      const dot=((b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y))/(u*v);
      const bend=Math.acos(Math.max(-1,Math.min(1,dot)));
      // At least 55° bending AND one coherent tip segment; micro-wobbles are not tails.
      if(bend>0.96&&u/travelled>.76){join=i;break;}
    }
    if(join<0)return pts;
    const cut=forward.slice(join);return start?cut:cut.reverse();
  }
  function preprocessStroke(raw){
    if(!raw?.length)return [];
    let pts=resample(raw,3.1);if(pts.length<5)return pts;
    const full=strokeLength(pts);let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of pts){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
    const diag=hypot(maxX-minX,maxY-minY);
    const limit=Math.min(full*.105,diag*.17);
    if(limit>=6){pts=clipTail(pts,true,limit);pts=clipTail(pts,false,limit);}
    // Very gentle de-jitter; keep square/lightning corner angles.
    if(pts.length>4){const smoothed=[pts[0]];for(let i=1;i<pts.length-1;i++)smoothed.push({
      x:pts[i].x*.83+(pts[i-1].x+pts[i+1].x)*.085,
      y:pts[i].y*.83+(pts[i-1].y+pts[i+1].y)*.085});smoothed.push(pts.at(-1));pts=smoothed;}
    const length=strokeLength(pts),first=pts[0],last=pts.at(-1),gap=hypot(first.x-last.x,first.y-last.y);
    // A nearly closed hand-drawn loop should be closed in the recognition copy only.
    // Do not close lightning/line: their perimeter is insufficient for a closed contour.
    if(pts.length>10 && length>diag*1.85 && gap<diag*.195 && gap>1){pts=[...pts,{...first}];}
    return pts;
  }
  function geometry(raw){const points=preprocessStroke(raw);let length=0,minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity,cross=0;
    for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];minX=Math.min(minX,a.x);minY=Math.min(minY,a.y);maxX=Math.max(maxX,a.x);maxY=Math.max(maxY,a.y);
      if(i<points.length-1)length+=hypot(b.x-a.x,b.y-a.y);cross+=a.x*b.y-b.x*a.y;
    }
    const width=Math.max(1,maxX-minX),height=Math.max(1,maxY-minY),diagonal=hypot(width,height),endDist=hypot(points[0].x-points.at(-1).x,points[0].y-points.at(-1).y);
    const closed=points.length>9 && endDist<diagonal*.22 && length>diagonal*2.05;
    // A pointed tip is the smaller interior angle of two local segments.
    // Sample a little apart to prevent hand jitter from being counted as thousands of corners.
    let tip=0,sharpCorners=0;
    const stride=Math.max(3,Math.round(12/3.3));
    for(let i=stride;i<points.length-stride;i++){const p0=points[i-stride],p1=points[i],p2=points[i+stride];
      const ax=p0.x-p1.x,ay=p0.y-p1.y,bx=p2.x-p1.x,by=p2.y-p1.y;
      const dot=(ax*bx+ay*by)/Math.max(.001,hypot(ax,ay)*hypot(bx,by));
      const interior=Math.acos(clamp(dot,-1,1));
      const acute=clamp((2.35-interior)/1.65,0,1);tip=Math.max(tip,acute);sharpCorners+=acute/stride;
    }
    const area=Math.abs(cross)/2;
    const aspect=Math.max(width,height)/Math.max(1,Math.min(width,height));const ring=closed?clamp(4*Math.PI*area/(length*length),0,1):0;
    const circle=clamp((ring-.36)/.52,0,1)*clamp(1-Math.abs(Math.log(aspect))*.7,0,1)*clamp(1-tip*.9,0,1);
    const thin=clamp((aspect-1.2)/3,0,1);
    const pointiness=clamp(.08+.81*Math.max(thin,tip)+.1*clamp(sharpCorners/2,0,1)-.95*circle,.02,1);
    const impact=clamp(.13+.90*circle+.16*clamp((length-60)/260,0,1)-.12*clamp((aspect-2)/4,0,1),.05,1);
    // A large bounding box or a long zigzag is NOT equivalent to actual filled area.
    const fill=measureFilledArea(points,closed);
    const mass=clamp(.035+fill.areaPower*.72, .035, 1);
    return {points,length,width,height,diagonal,closed,tip,thin,sharpCorners,circle,pointiness,impact,mass,area:fill.areaPx2,areaPower:fill.areaPower,inkCoverage:fill.inkCoverage,box:{minX,maxX,minY,maxY}};
  }

  // Work is O(N + A) once per completed stroke: A=160*100 fixed cells.
  // Even-odd fill gives actual occupied interior for concave/self-intersecting silhouettes.
  // An OPEN line has no interior and is deliberately low damage; its ink area is a tiny addend.
  const areaCanvas=document.createElement('canvas');areaCanvas.width=160;areaCanvas.height=100;
  const areaCtx=areaCanvas.getContext('2d',{willReadFrequently:true});
  function measureFilledArea(points,closed){
    const {width:w,height:h}=areaCanvas;
    areaCtx.setTransform(1,0,0,1,0,0);areaCtx.clearRect(0,0,w,h);
    areaCtx.setTransform(w/Math.max(1,PW),0,0,h/Math.max(1,PH),0,0);
    areaCtx.beginPath();points.forEach((p,i)=>{i?areaCtx.lineTo(p.x,p.y):areaCtx.moveTo(p.x,p.y);});
    if(closed){areaCtx.closePath();areaCtx.fillStyle='#fff';areaCtx.fill('evenodd');}
    let inside=0;
    if(closed){const rgba=areaCtx.getImageData(0,0,w,h).data;for(let i=3;i<rgba.length;i+=4)inside+=rgba[i]/255;}
    // Stroke is measured separately with actual fixed pen width, never bounding-box area.
    areaCtx.clearRect(0,0,w,h);areaCtx.beginPath();points.forEach((p,i)=>{i?areaCtx.lineTo(p.x,p.y):areaCtx.moveTo(p.x,p.y);});
    areaCtx.lineWidth=3.8;areaCtx.lineCap='round';areaCtx.lineJoin='round';areaCtx.strokeStyle='#fff';areaCtx.stroke();
    const rgba=areaCtx.getImageData(0,0,w,h).data;let ink=0;for(let i=3;i<rgba.length;i+=4)ink+=rgba[i]/255;
    const areaPx2=(inside+ink*.08)*(PW*PH)/(w*h);
    const comparisonArea=Math.PI*Math.pow(Math.min(PW,PH)*.5,2);
    // Ratio to a drawable inscribed circle is stable even when the pad aspect changes.
    const areaPower=clamp(areaPx2/Math.max(1,comparisonArea),0,1.5);
    return {areaPx2,areaPower,inkCoverage:ink/(w*h)};
  }

  const referenceRules={
    line:{threshold:.62,label:'선'},circle:{threshold:.58,label:'원'},triangle:{threshold:.68,label:'삼각형'},
    square:{threshold:.58,label:'사각형'},flame:{threshold:.68,label:'불꽃'},water:{threshold:.70,label:'물방울'},
    lightning:{threshold:.60,label:'번개'},star:{threshold:.71,label:'별'},shuriken:{threshold:.69,label:'표창'},
    starcircle:{threshold:.72,label:'별 마법진'}
  };
  const CNN_LABELS=['normal','line','circle','triangle','square','flame','water','lightning','star','shuriken','starcircle'];
  const REFERENCE_ASSIST_DROP=.12;
  const glyphReferences=JSON.parse($('glyphReferences').textContent);
  function effectiveReferenceThreshold(kind,selected=selectedGlyph){
    const base=referenceRules[kind]?.threshold||.7;
    return kind===selected?Math.max(.47,base-REFERENCE_ASSIST_DROP):base;
  }
  const LOOP_REFERENCE_CLASSES=new Set(['circle','triangle','square','water','star','shuriken']);
  function normalizeStroke(raw,count=64){
    const pts=preprocessStroke(raw);if(!pts.length)return Array.from({length:count},()=>({x:0,y:0}));
    const gap=hypot(pts[0].x-pts.at(-1).x,pts[0].y-pts.at(-1).y);
    const periodic=pts.length>8&&gap<Math.max(2,strokeLength(pts)*.035);
    const picked=[];for(let i=0;i<count;i++){
      // For loops exclude the duplicated endpoint; start point can be anywhere.
      const idx=Math.round(i*(pts.length-1)/(periodic?count:Math.max(1,count-1)));
      picked.push(pts[Math.min(pts.length-1,idx)]);
    }
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of picked){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
    const w=Math.max(1e-6,maxX-minX),h=Math.max(1e-6,maxY-minY),scale=2/Math.max(w,h),cx=(minX+maxX)*.5,cy=(minY+maxY)*.5;
    return picked.map(p=>({x:(p.x-cx)*scale,y:(p.y-cy)*scale}));
  }
  const referenceCache=new Map();
  function normalizedReference(kind){
    if(!referenceCache.has(kind)){
      const paths=[glyphReferences.paths[kind],...(kind==='flame'?glyphReferences.flamePrototypes:[])].filter(Boolean);
      const rotated=kind==='shuriken'?paths.flatMap(path=>[0,1,2,3].map(turn=>path.map(([x,y])=>{
        if(turn===1)return [-y,x];if(turn===2)return [-x,-y];if(turn===3)return [y,-x];return [x,y];
      }))):paths;
      referenceCache.set(kind,rotated.map(p=>normalizeStroke(p.map(([x,y])=>({x:x*100,y:y*100})),64)));
    }
    return referenceCache.get(kind);
  }
  function strokeSimilarity(raw,kind){
    const src=normalizeStroke(raw,64),refs=normalizedReference(kind);let best=0;
    const cyclic=LOOP_REFERENCE_CLASSES.has(kind);const n=src.length;
    for(const ref of refs){
      const shiftStep=cyclic?1:n;
      for(let shift=0;shift<n;shift+=shiftStep){let forward=0,reverse=0;
        for(let i=0;i<n;i++){
          const at=ref[(i+shift)%n],back=ref[(n-1-i+shift)%n];
          forward+=hypot(src[i].x-at.x,src[i].y-at.y);
          reverse+=hypot(src[i].x-back.x,src[i].y-back.y);
        }
        best=Math.max(best,Math.max(0,1-Math.min(forward,reverse)/n/.95));
      }
    }
    return Math.min(1,best);
  }

  // =====================================================================================
  // Genuine PyTorch-trained 3-convolution CNN, exported as Float32 tensors (not heuristics).
  // Inference is handwritten vanilla JS and executes once per completed stroke.
  // =====================================================================================
  const packed=JSON.parse($('sketchCNN').textContent);
  const decode=(src)=>{const bytes=Uint8Array.from(atob(src),s=>s.charCodeAt(0));return new Float32Array(bytes.buffer);};
  const model={};for(const [k,v] of Object.entries(packed.tensors))model[k]=decode(v);
  const raster96=document.createElement('canvas');raster96.width=96;raster96.height=96;
  const raster32=document.createElement('canvas');raster32.width=32;raster32.height=32;
  const g96=raster96.getContext('2d',{willReadFrequently:true}),g32=raster32.getContext('2d',{willReadFrequently:true});
  function imageOf(points){let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const p of points){minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);}
    const scale=23.5/Math.max(0.0001,maxX-minX,maxY-minY),mx=(minX+maxX)/2,my=(minY+maxY)/2;
    g96.fillStyle='#000';g96.fillRect(0,0,96,96);g96.lineJoin='round';g96.lineCap='round';g96.lineWidth=7;g96.strokeStyle='#fff';g96.beginPath();
    points.forEach((p,i)=>{const x=48+3*(p.x-mx)*scale,y=48+3*(p.y-my)*scale;i?g96.lineTo(x,y):g96.moveTo(x,y);});g96.stroke();
    g32.fillStyle='#000';g32.fillRect(0,0,32,32);g32.drawImage(raster96,0,0,32,32);
    const rgba=g32.getImageData(0,0,32,32).data;const out=new Float32Array(32*32);
    for(let i=0;i<out.length;i++)out[i]=rgba[i*4]/255;return out;
  }
  function convReluPool(a,side,inCh,outCh,key){const size=side*side,weights=model[key+'.weight'],bias=model[key+'.bias'],half=side>>1,out=new Float32Array(outCh*half*half);
    for(let oc=0;oc<outCh;oc++){const w0=oc*inCh*9,o0=oc*half*half;
      for(let y=0;y<side;y+=2)for(let x=0;x<side;x+=2){let best=0;
        for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++){
          const Y=y+yy,X=x+xx;let s=bias[oc];
          for(let ic=0;ic<inCh;ic++){const a0=ic*size,w1=w0+ic*9;
            for(let ky=0;ky<3;ky++){const iy=Y+ky-1;if(iy<0||iy>=side)continue;const y0=a0+iy*side,w2=w1+ky*3;
              for(let kx=0;kx<3;kx++){const ix=X+kx-1;if(ix>=0&&ix<side)s+=a[y0+ix]*weights[w2+kx];}
            }
          }
          if(s>best)best=s;
        }
        out[o0+(y>>1)*half+(x>>1)]=best;
      }
    }return out;
  }
  function denseRelu(a,outChannels,key,relu){const w=model[key+'.weight'],b=model[key+'.bias'],out=new Float32Array(outChannels);for(let j=0;j<outChannels;j++){
      let n=b[j],base=j*a.length;for(let k=0;k<a.length;k++)n+=a[k]*w[base+k];out[j]=relu?Math.max(0,n):n;
    }return out;
  }
  function predict(points){const started=performance.now();let x=imageOf(points);x=convReluPool(x,32,1,8,'conv1');x=convReluPool(x,16,8,16,'conv2');x=convReluPool(x,8,16,20,'conv3');x=denseRelu(x,32,'fc1',true);x=denseRelu(x,CNN_LABELS.length,'fc2',false);
    const max=Math.max(...x),ex=x.map(v=>Math.exp(v-max)),sum=ex.reduce((a,b)=>a+b,0),prob=Array.from(ex,v=>v/sum),rank=prob.map((v,i)=>({index:i,value:v})).sort((a,b)=>b.value-a.value);
    return {label:CNN_LABELS[rank[0].index],prob,top:rank[0],latencyMs:performance.now()-started};
  }
  function makeShotData(points){const geo=geometry(points);const result=predict(geo.points);
    const selected=selectedGlyph,topClass=result.label,ref={};
    for(const kind of Object.keys(referenceRules))ref[kind]=strokeSimilarity(geo.points,kind);
    const matching=topClass in referenceRules && ref[topClass]>=effectiveReferenceThreshold(topClass,selected);
    const kind=matching?topClass:(topClass==='line'?'line':'normal');
    const approval={selected,topClass,accepted:matching,similarity:ref[topClass]||0,
      threshold:effectiveReferenceThreshold(topClass,selected),assisted:selected===topClass};
    const special=kind!=='normal'&&kind!=='line';
    const baseDamage=special?Math.round(14+25*Math.sqrt(clamp(geo.areaPower,0,1))*({triangle:1.25,square:.97,flame:1,water:.83,lightning:.95,star:1.06,shuriken:.75,starcircle:1.18}[kind]||1)):Math.round(6+5*clamp(geo.areaPower,0,1));
    const midX=(geo.box.minX+geo.box.maxX)/2,midY=(geo.box.minY+geo.box.maxY)/2;
    const size=clamp(23+19*Math.sqrt(geo.areaPower),23,55),factor=size/Math.max(1,geo.width,geo.height);
    const shape=geo.points.map(p=>({x:(p.x-midX)*factor,y:(p.y-midY)*factor}));
    const topRefKind=Object.entries(ref).sort((a,b)=>b[1]-a[1])[0][0];
    const color=art[kind]||art.normal;
    return {geo,cnn:result,kind,name:kind==='normal'?'낙서 탄환':`${shapeNames[kind]} 마법`,color,shape,pen:geo.pointiness,impact:geo.impact,mass:geo.mass,
      areaPx2:geo.area,areaPower:geo.areaPower,baseDamage,element:special?1:0,
      reference:{scores:ref,topRefKind,approval,selected,topClass},refSimilarity:approval.similarity};
  }

  // One-stroke references and the learned classifier share the same canonical stroke templates.
  function samplePoints(kind,width=PW,height=PH){
    const path=glyphReferences.paths[kind];if(!path)return [];
    const centerX=width*.5,centerY=height*.51,scale=Math.min(width*.30,height*.39);
    return path.map(([x,y])=>({x:centerX+x*scale,y:centerY+y*scale}));
  }
  function shapeSvg(kind){const pts=normalizeStroke(samplePoints(kind,320,180)),d=pts.map((p,i)=>(i?'L':'M')+(48+p.x*28).toFixed(1)+' '+(42+p.y*28).toFixed(1)).join(' '),first=pts[0];return `<svg viewBox="0 0 96 84" aria-hidden="true"><path d="${d}"/><circle cx="${(48+first.x*28).toFixed(1)}" cy="${(42+first.y*28).toFixed(1)}" r="3"/></svg>`;}
  const glyphKinds=['line','circle','triangle','square','flame','water','lightning','star','shuriken','starcircle'];
  let selectedGlyph='circle';
  function selectGlyph(kind){
    if(!referenceRules[kind])return;
    selectedGlyph=kind;
    for(const b of $('ribbon').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.kind===kind));
    $('drawTip').textContent=`${shapeNames[kind]} ${Math.round(effectiveReferenceThreshold(kind)*100)}%↑ · CNN 1위 필수`;
  }
  $('ribbon').innerHTML=glyphKinds.map(k=>`<button class="glyph" data-kind="${k}" aria-label="${shapeNames[k]} · ${shapeDesc[k]} 대표 그림 보기" aria-pressed="false">${shapeSvg(k)}<span>${shapeNames[k]}</span></button>`).join('');
  $('helpReferences').innerHTML=glyphKinds.map(k=>`<div class="help-ref">${shapeSvg(k)}<div>${shapeNames[k]}</div></div>`).join('');
  $('ribbon').addEventListener('click',e=>{const b=e.target.closest('[data-kind]');if(b){selectGlyph(b.dataset.kind);if(e.detail>0)field.focus({preventScroll:true});}});selectGlyph('circle');

