// Facade over one GameKit VectorContext. The gameplay calls keep the old
// Renderer2D boundary; SVG actors and transient paths share one WebGL device and
// the context orders their submissions.
const CLEAR = Object.freeze([0, 0, 0, 0]);
const UNIT_SQUARE = Object.freeze([Object.freeze([-1,-1]),Object.freeze([1,-1]),Object.freeze([1,1]),Object.freeze([-1,1])]);
const UNIT_POLYGONS = new Map();
function finite(value, name) { if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`); }
function positive(value, name) { finite(value, name); if (value <= 0) throw new RangeError(`${name} must be positive`); }
function unitPolygon(segments) {
  let points = UNIT_POLYGONS.get(segments);
  if (!points) { points = Object.freeze(Array.from({length:segments},(_,i)=>Object.freeze([Math.cos(i*Math.PI*2/segments),Math.sin(i*Math.PI*2/segments)]))); UNIT_POLYGONS.set(segments,points); }
  return points;
}
class Renderer2D {
  constructor(canvas, { antialias = true, preserveDrawingBuffer = false, initialVertices = 4096, maxVertices = 262144 } = {}) {
    if (!canvas?.getContext || !canvas?.addEventListener) throw new TypeError('canvas is required');
    if (!Number.isSafeInteger(initialVertices) || initialVertices < 6 || !Number.isSafeInteger(maxVertices) || maxVertices < initialVertices) throw new RangeError('invalid GameKit vector vertex capacity');
    this.canvas = canvas;
    this.device = new WebGLDevice(canvas, { alpha: true, antialias, depth: false, stencil: false, preserveDrawingBuffer });
    this.context = new VectorContext(this.device, { initialVertices, maxVertices });
    this.gl = this.device.gl;
    this.width = canvas.clientWidth || canvas.width || 1;
    this.height = canvas.clientHeight || canvas.height || 1;
    this.dpr = 1;
    this.camera = { x: this.width / 2, y: this.height / 2, zoom: 1, rotation: 0 };
    this.cameraMatrix = [1, 0, 0, 1, 0, 0];
    this.active = false;
    this.frame = 0;
    this._stats = { backend: 'webgl1', frame: 0, drawCalls: 0, vertices: 0, uploadedBytes: 0, textureUploads: 0, textureCount: 0, stagingBytes: this.context.vector.vertices.byteLength, bufferAllocations: this.device.stats.bufferAllocations };
    this._applyCamera();
  }
  get state() { return this.context.state; }
  get failure() { return this.device.failure ?? null; }
  get stats() { return { ...this._stats, textureCount: this.device.stats.textureCount ?? 0, stagingBytes: this.context.vector.vertices.byteLength, bufferAllocations: this.device.stats.bufferAllocations ?? 0 }; }
  resize(width, height, dpr = 1) {
    positive(width, 'width'); positive(height, 'height'); positive(dpr, 'dpr');
    if (this.active) throw new Error('resize must be outside beginFrame/endFrame');
    const px = Math.max(1, Math.round(width*dpr)), py = Math.max(1, Math.round(height*dpr));
    const limit = this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS);
    if (px > limit[0] || py > limit[1]) throw new RangeError('viewport exceeds WebGL limits');
    this.width = width; this.height = height; this.dpr = dpr;
    this._applyCamera();
  }
  setCamera({ x = this.camera.x, y = this.camera.y, zoom = this.camera.zoom, rotation = this.camera.rotation } = {}) {
    finite(x, 'x'); finite(y, 'y'); positive(zoom, 'zoom'); finite(rotation, 'rotation');
    if (this.active) this.context.flush();
    Object.assign(this.camera, { x, y, zoom, rotation });
    this._applyCamera();
  }
  _applyCamera() {
    const { x, y, zoom, rotation } = this.camera, c = Math.cos(rotation)*zoom, s = Math.sin(rotation)*zoom, d = this.dpr;
    const a = c*d, b = -s*d, cc = s*d, dd = c*d;
    this.cameraMatrix = [a,b,cc,dd,(this.width/2-c*x-s*y)*d,(this.height/2+s*x-c*y)*d];
    if (this.active) this.context.setTransform(...this.cameraMatrix);
  }
  worldToScreenInto(x, y, out) {
    finite(x, 'x'); finite(y, 'y'); const { rotation, zoom } = this.camera, c = Math.cos(rotation), s = Math.sin(rotation), dx = x-this.camera.x, dy = y-this.camera.y;
    out.x = (c*dx+s*dy)*zoom+this.width/2; out.y = (-s*dx+c*dy)*zoom+this.height/2; return out;
  }
  screenToWorldInto(x, y, out) {
    finite(x, 'x'); finite(y, 'y'); const { rotation, zoom } = this.camera, c = Math.cos(rotation), s = Math.sin(rotation), dx = (x-this.width/2)/zoom, dy = (y-this.height/2)/zoom;
    out.x = c*dx-s*dy+this.camera.x; out.y = s*dx+c*dy+this.camera.y; return out;
  }
  beginFrame(clear = CLEAR) {
    if (this.active) throw new Error('endFrame is required');
    if (clear.length !== 4 || Array.from(clear).some(n => !Number.isFinite(n) || n < 0 || n > 1)) throw new TypeError('clear must be normalized RGBA');
    const width = Math.max(1, Math.round(this.width*this.dpr)), height = Math.max(1, Math.round(this.height*this.dpr));
    try {
      if (!this.context.beginFrame({ width, height, clearColor: Array.from(clear) })) return false;
    } catch (error) {
      // The WebGL loss event may arrive after the browser has already made
      // context queries return null. Skip that boundary frame and let the
      // pinned device's loss/restore handlers reinitialize retained resources.
      if (this.gl.isContextLost()) return false;
      throw error;
    }
    this.active = true; this.frame++;
    this._applyCamera();
    return true;
  }
  _frame() { if (!this.active) throw new Error('beginFrame is required'); }
  _fill(tint) { this.context.fillStyle = tint; this.context.globalAlpha = 1; }
  _stroke(tint, width) { this.context.strokeStyle = tint; this.context.globalAlpha = 1; this.context.lineWidth = width; this.context.lineCap = 'butt'; this.context.lineJoin = 'round'; }
  triangle(x0,y0,x1,y1,x2,y2,tint=[1,1,1,1]) {
    this._frame(); [x0,y0,x1,y1,x2,y2].forEach((n,i)=>finite(n,`triangle[${i}]`));
    this.context.fillTriangleFan([[x0,y0],[x1,y1],[x2,y2]],tint);
  }
  rect(x,y,width,height,tint=[1,1,1,1],angle=0) {
    this._frame(); finite(x,'x'); finite(y,'y'); positive(width,'width'); positive(height,'height'); finite(angle,'angle');
    const c=this.context, prior=c.getTransform();
    try { c.translate(x,y); c.rotate(angle); c.scale(width/2,height/2); c.fillTriangleFan(UNIT_SQUARE,tint); }
    finally { c.setTransform(prior.a,prior.b,prior.c,prior.d,prior.e,prior.f); }
  }
  ellipse(x,y,rx,ry,tint=[1,1,1,1],segments=24) {
    this._frame(); finite(x,'x'); finite(y,'y'); positive(rx,'radiusX'); positive(ry,'radiusY');
    if (!Number.isSafeInteger(segments) || segments < 3 || segments > 256) throw new RangeError('segments must be 3..256');
    const c=this.context, prior=c.getTransform();
    try { c.translate(x,y); c.scale(rx,ry); c.fillTriangleFan(unitPolygon(segments),tint); }
    finally { c.setTransform(prior.a,prior.b,prior.c,prior.d,prior.e,prior.f); }
  }
  line(x0,y0,x1,y1,width,tint=[1,1,1,1]) {
    this._frame(); [x0,y0,x1,y1].forEach((n,i)=>finite(n,`line[${i}]`)); positive(width,'width');
    if (x0===x1 && y0===y1) return;
    const dx=x1-x0,dy=y1-y0,len=Math.hypot(dx,dy),nx=-dy/len*width/2,ny=dx/len*width/2;
    this.context.fillTriangleFan([[x0+nx,y0+ny],[x1+nx,y1+ny],[x1-nx,y1-ny],[x0-nx,y0-ny]],tint);
  }
  flush() { this._frame(); this.context.flush(); }
  drawVector(actor, localMatrix = [1,0,0,1,0,0], alpha = 1) {
    this._frame();
    if (!actor?.draw || localMatrix.length !== 6 || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new TypeError('GameKit vector actor, affine transform and alpha are required');
    this.context.drawVectorActor(actor, { matrix: localMatrix, alpha });
  }
  endFrame() {
    this._frame();
    const stats = this.context.endFrame();
    this.active = false;
    this._stats = { backend: 'webgl1', frame: this.frame, drawCalls: stats.drawCalls ?? 0, vertices: stats.vertices ?? 0, uploadedBytes: stats.uploadedBytes ?? 0,
      textureUploads: stats.textureUploads ?? 0, textureCount: stats.textureCount ?? 0, stagingBytes: stats.stagingBytes ?? 0, bufferAllocations: stats.bufferAllocations ?? 0,
      paths: stats.paths ?? 0, mesh: stats.mesh ?? null };
    return this.stats;
  }
  dispose() {
    if (this.context.state === 'disposed') return;
    if (this.active) { try { this.context.endFrame(); } catch {} this.active = false; }
    this.context.dispose(); this.device.dispose();
  }
}
