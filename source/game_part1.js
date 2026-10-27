  const $=id=>document.getElementById(id);
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)),mix=(a,b,t)=>a+(b-a)*t,hypot=Math.hypot;
  const art={normal:'#293846',line:'#344e58',circle:'#799c91',triangle:'#d08c63',square:'#8f8b80',flame:'#ce704e',water:'#519cbd',lightning:'#558fbc',star:'#d8a34a',shuriken:'#9887b0',starcircle:'#cd995c'};
  const CFG=Object.freeze({version:'0.20.0',baseHz:60,renderHz:60,inputHz:60,tickMs:1000/30,maxCatchup:8,world:{width:4400,height:1460},player:{hp:120,radius:16,walkSpeed:140,roll:{capacity:2,rechargeMs:650,rangeDiameters:3,durationMinMs:110,durationMaxMs:270,travelSpeed:765,projectileInvulMs:145}},castLimit:4,maxParticles:360});
  $('gameVersion').textContent=`v${CFG.version} · RPG`;
  const DRAWING_STATS=Object.freeze({width:280,height:150,penWidth:3.8,recognitionSize:150});
  const field=$('field'),renderer=new Renderer2D(field,{batchVertices:32768}),draw=$('draw'),drawCtx=draw.getContext('2d'),trainingPad=$('trainingPad'),trainingCtx=trainingPad.getContext('2d');
  const mini=$('map'),miniCtx=mini.getContext('2d');
  let vw=innerWidth,vh=innerHeight,dpr=1,drawDpr=1,trainingDpr=1,tw=330,th=200;
  const shapeNames={line:'선',circle:'원',triangle:'삼각형',square:'사각형',flame:'불꽃',water:'물방울',lightning:'번개',star:'별',shuriken:'표창',starcircle:'별 마법진'};
  const shapeDesc=Object.fromEntries(Object.entries(SUMMON_SPECS).map(([kind,spec])=>[kind,`${spec.name} 소환 · ${spec.role}`]));

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
  function strokeBounds(points){
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of points){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
    return {minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
  }
  function canonicalLoop(points){
    // The same closed outline has one sampling origin/direction, independent of pen start.
    const loop=points.slice();if(hypot(loop[0].x-loop.at(-1).x,loop[0].y-loop.at(-1).y)<1e-6)loop.pop();
    let start=0;for(let i=1;i<loop.length;i++)if(loop[i].x<loop[start].x||(loop[i].x===loop[start].x&&loop[i].y<loop[start].y))start=i;
    const n=loop.length,forward=loop[(start+1)%n],back=loop[(start+n-1)%n];
    const direction=forward.x<back.x||(forward.x===back.x&&forward.y<=back.y)?1:-1;
    const out=Array.from({length:n},(_,i)=>loop[(start+direction*i+n)%n]);out.push({...out[0]});return out;
  }
  function preprocessStroke(raw){
    if(!raw?.length)return [];
    const box=strokeBounds(raw),cx=(box.minX+box.maxX)/2,cy=(box.minY+box.maxY)/2;
    const scale=DRAWING_STATS.recognitionSize/Math.max(1e-6,box.width,box.height);
    // Normalize BEFORE pixel-sized tail/resampling thresholds. Restore CSS units for combat stats.
    let input=raw.map(p=>({x:(p.x-cx)*scale,y:(p.y-cy)*scale}));
    const diagonal=hypot(box.width,box.height)*scale;
    const loop=input.length>=4&&strokeLength(input)>diagonal*1.85&&hypot(input[0].x-input.at(-1).x,input[0].y-input.at(-1).y)<diagonal*.195;
    if(loop)input=canonicalLoop(input);
    let pts=resample(input,3.1);
    if(pts.length>=5){
      const full=strokeLength(pts),limit=Math.min(full*.105,diagonal*.17);
      if(!loop&&limit>=6){pts=clipTail(pts,true,limit);pts=clipTail(pts,false,limit);}
      // Periodic smoothing treats every point in a closed outline identically.
      if(pts.length>4){
        if(loop&&hypot(pts[0].x-pts.at(-1).x,pts[0].y-pts.at(-1).y)<1e-6)pts.pop();
        const n=pts.length;
        pts=pts.map((p,i)=>{
          if(!loop&&(i===0||i===n-1))return p;
          const a=pts[(i+n-1)%n],b=pts[(i+1)%n];return {x:p.x*.83+(a.x+b.x)*.085,y:p.y*.83+(a.y+b.y)*.085};
        });
      }
      if(loop)pts.push({...pts[0]});
    }
    return pts.map(p=>({x:p.x/scale+cx,y:p.y/scale+cy}));
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
    const stride=Math.max(3,Math.round(12/3.3)),count=closed?points.length-1:points.length;
    for(let i=closed?0:stride;i<(closed?count:count-stride);i++){const p0=points[(i-stride+count)%count],p1=points[i],p2=points[(i+stride)%count];
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
    const {width:w,height:h}=areaCanvas,box=strokeBounds(points),pad=DRAWING_STATS.penWidth*2;
    const viewW=Math.max(DRAWING_STATS.width,box.width+pad),viewH=Math.max(DRAWING_STATS.height,box.height+pad);
    const sx=w/viewW,sy=h/viewH,cx=(box.minX+box.maxX)/2,cy=(box.minY+box.maxY)/2;
    areaCtx.setTransform(1,0,0,1,0,0);areaCtx.clearRect(0,0,w,h);
    // Fit oversized strokes and translate every stroke to the same raster origin; never clip at screen edges.
    areaCtx.setTransform(sx,0,0,sy,w/2,h/2);
    areaCtx.beginPath();points.forEach((p,i)=>{i?areaCtx.lineTo(p.x-cx,p.y-cy):areaCtx.moveTo(p.x-cx,p.y-cy);});
    if(closed){areaCtx.closePath();areaCtx.fillStyle='#fff';areaCtx.fill('evenodd');}
    let inside=0;
    if(closed){const rgba=areaCtx.getImageData(0,0,w,h).data;for(let i=3;i<rgba.length;i+=4)inside+=rgba[i]/255;}
    // Stroke is measured separately with actual fixed pen width, never bounding-box area.
    areaCtx.save();areaCtx.setTransform(1,0,0,1,0,0);areaCtx.clearRect(0,0,w,h);areaCtx.restore();areaCtx.beginPath();points.forEach((p,i)=>{i?areaCtx.lineTo(p.x-cx,p.y-cy):areaCtx.moveTo(p.x-cx,p.y-cy);});
    areaCtx.lineWidth=DRAWING_STATS.penWidth;areaCtx.lineCap='round';areaCtx.lineJoin='round';areaCtx.strokeStyle='#fff';areaCtx.stroke();
    const rgba=areaCtx.getImageData(0,0,w,h).data;let ink=0;for(let i=3;i<rgba.length;i+=4)ink+=rgba[i]/255;
    const areaPx2=(inside+ink*.08)*(viewW*viewH)/(w*h);
    const comparisonArea=Math.PI*Math.pow(Math.min(DRAWING_STATS.width,DRAWING_STATS.height)*.5,2);
    // The original 280×150 balance baseline is fixed, independent of layout or device pixels.
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
  const LOOP_REFERENCE_CLASSES=new Set(['circle','triangle','square','water','star','shuriken','starcircle']);
  function normalizeStroke(raw,count=64){
    const pts=preprocessStroke(raw);if(!pts.length)return Array.from({length:count},()=>({x:0,y:0}));
    const gap=hypot(pts[0].x-pts.at(-1).x,pts[0].y-pts.at(-1).y);
    const periodic=pts.length>8&&gap<Math.max(1e-6,strokeLength(pts)*.035);
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
    const spec=summonSpecOf(kind),baseDamage=spec.damage(geo.areaPower);
    const midX=(geo.box.minX+geo.box.maxX)/2,midY=(geo.box.minY+geo.box.maxY)/2;
    const size=clamp(23+19*Math.sqrt(geo.areaPower),23,55),factor=size/Math.max(1,geo.width,geo.height);
    const shape=geo.points.map(p=>({x:(p.x-midX)*factor,y:(p.y-midY)*factor}));
    const topRefKind=Object.entries(ref).sort((a,b)=>b[1]-a[1])[0][0];
    const color=art[kind]||art.normal;
    return {geo,cnn:result,kind,name:spec.name,color,shape,pen:geo.pointiness,impact:geo.impact,mass:geo.mass,
      areaPx2:geo.area,areaPower:geo.areaPower,baseDamage,element:0,
      reference:{scores:ref,topRefKind,approval,selected,topClass},refSimilarity:approval.similarity};
  }

  // One-stroke references and the learned classifier share the same canonical stroke templates.
  function samplePoints(kind,width=DRAWING_STATS.width,height=DRAWING_STATS.height){
    const path=glyphReferences.paths[kind];if(!path)return [];
    const centerX=width*.5,centerY=height*.51,scale=Math.min(width*.30,height*.39);
    return path.map(([x,y])=>({x:centerX+x*scale,y:centerY+y*scale}));
  }
  function shapeSvg(kind){const pts=normalizeStroke(samplePoints(kind,320,180)),d=pts.map((p,i)=>(i?'L':'M')+(48+p.x*28).toFixed(1)+' '+(42+p.y*28).toFixed(1)).join(' '),first=pts[0];return `<svg viewBox="0 0 96 84" aria-hidden="true"><path d="${d}"/><circle cx="${(48+first.x*28).toFixed(1)}" cy="${(42+first.y*28).toFixed(1)}" r="3"/></svg>`;}
  const glyphKinds=['line','circle','triangle','square','flame','water','lightning','star','shuriken','starcircle'];
  // The manual 'pressed shape' recognition assist is gone: live ghost recognition shows the best match while drawing.
  const selectedGlyph=null;
  // Easy reference faces shown while the face step is open (neutral is the no-face fallback, not a guide).
  function faceGuideSvg(e){
    const at=(x,y)=>`${(48+x*30).toFixed(1)} ${(42+y*30).toFixed(1)}`;
    return `<svg viewBox="0 0 96 84" aria-hidden="true">${e.guide.map(s=>s.length===1?`<circle cx="${(48+s[0][0]*30).toFixed(1)}" cy="${(42+s[0][1]*30).toFixed(1)}" r="2.6"/>`:`<path d="${s.map((q,i)=>(i?'L':'M')+at(q[0],q[1])).join(' ')}"/>`).join('')}</svg>`;
  }
  $('helpFaceGuides').innerHTML=EXPRESSIONS.filter(e=>e.id!=='neutral').map(e=>`<div class="face-guide" title="${e.name} · ${e.temperament.summary()}">${faceGuideSvg(e)}<b>${e.name}</b><span>${e.temperament.summary()}</span></div>`).join('')+`<div class="face-guide">${faceGuideSvg({guide:[[[-.42,-.1],[-.18,-.1]],[[.18,-.1],[.42,-.1]]]})}<b>무표정</b><span>어느 표정과도 맞지 않으면 · 특성 없음</span></div>`;
  $('helpExpressions').innerHTML=EXPRESSIONS.map(e=>`<li><b>${e.name}</b> · ${e.temperament.summary()}</li>`).join('');
  $('helpReferences').innerHTML=glyphKinds.map(k=>`<div class="help-ref">${shapeSvg(k)}<div>${shapeNames[k]}</div></div>`).join('');

