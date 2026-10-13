function createLoop({ session, getInput = () => new Uint8Array(session.inputSize), render = () => {}, inputPreview,
backlogPolicy = 'drop', beforeFrame = () => {}, canAdvance = () => true, canObserveInput = () => true, onAdvance = () => {}, onPreviewError = () => {},
onError = error => { throw error; }, onInputRelease = () => {}, onBacklogDrop = () => {}, maxBacklogTicks = 8,
requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) } = {}) {
if (!session || typeof session.poll !== 'function' || typeof session.advance !== 'function') throw new TypeError('session capability');
for (const callback of [getInput, render, beforeFrame, canAdvance, canObserveInput, onAdvance, onPreviewError, onError, onInputRelease, onBacklogDrop]) {
if (typeof callback !== 'function') throw new TypeError('loop callback');
}
if (backlogPolicy !== 'drop' && backlogPolicy !== 'retain') throw new RangeError('backlogPolicy');
if (!Number.isInteger(maxBacklogTicks) || maxBacklogTicks < 1 || maxBacklogTicks > 8192) throw new RangeError('maxBacklogTicks');
const quantum = 1000 / session.profile.tickRate;
const maxBacklogMs = quantum * maxBacklogTicks;
let running = false, handle, last, accumulator = 0, generation = 0, timingGeneration = 0;
if (inputPreview && typeof inputPreview.observe !== 'function') throw new TypeError('inputPreview observation capability');
let inputSequence = 0, commandObservation=0, observedAt=-Infinity, cached=null, captureKey=''; const observedCommands=[];
const observeInput = timestamp => {
if (!Number.isFinite(timestamp)) throw new TypeError('input observation timestamp');
if (!canObserveInput()) { cached=null;inputPreview?.clear?.();return null; }
if(timestamp===observedAt && cached)return cached;
const sampled=getInput(),packet=sampled&&typeof sampled==='object'&&!ArrayBuffer.isView(sampled)&&Object.hasOwn(sampled,'input');
const input=packet?sampled.input:sampled,commands=packet?(sampled.commands??[]):[];
if(!Array.isArray(commands))throw new TypeError('input packet commands');
const held=observedCommands;
if(held.length+commands.length>64)throw new RangeError('unsubmitted input command capacity');
for(const command of commands){if(!command||command.payload===undefined)throw new TypeError('command payload required');held.push({observationId:++commandObservation,sequence:null,payload:command.payload.slice?.()??structuredClone(command.payload)});}
cached={input:input.slice?.()??structuredClone(input),commands:held,predict:!packet||sampled.predict!==false||held.length>0,continuationKey:packet?sampled.continuationKey:undefined,sequence:++inputSequence};observedAt=timestamp;
if(inputPreview&&packet&&sampled.predict===false&&!held.length)inputPreview.cancelObservation?.(Math.max(timestamp,performance.now()));
else if(inputPreview?.enabled!==false && inputPreview)try{inputPreview.observe(cached.input,{sequence:cached.sequence,tick:session.tick,epoch:session.epoch??0,continuationKey:cached.continuationKey,
timeMs:Math.max(timestamp,globalThis.performance?.now?.()??timestamp),commands:cached.commands});}catch(error){inputPreview.clear?.();onPreviewError(error);}
return cached;
};
const resetTiming = (clearPreview = true) => { timingGeneration++; last = undefined; accumulator = 0; if (clearPreview) {cached=null;observedAt=-Infinity;inputPreview?.clear?.();} };
const release = () => {
try { onInputRelease(); session.releaseInput(); cached=null;observedAt=-Infinity;inputPreview?.clear?.(); }
catch (error) { stop(); onError(error); }
};
const hidden = () => { if (globalThis.document?.hidden) { release(); resetTiming(); } };
const stop = () => {
generation++; running = false; if (handle !== undefined) cancelFrame?.(handle); handle = undefined;
inputPreview?.clear?.();
globalThis.removeEventListener?.('blur', release);
globalThis.document?.removeEventListener('visibilitychange', hidden);
};
const renderFrame = () => render({ session, alpha: Math.min(1, accumulator / quantum), resimulating: session.resimulating });
const pulse = (timestamp, { render: shouldRender = true } = {}) => {
const current = generation;
try {
if (!Number.isFinite(timestamp)) throw new TypeError('frame timestamp');
if (backlogPolicy === 'retain' && last !== undefined && timestamp < last) throw new RangeError('retained loop timestamp cannot regress');
beforeFrame(timestamp);
if (current !== generation) return;
const timing = timingGeneration;
if (last === undefined) last = timestamp;
const elapsed = Math.max(0, timestamp - last);
if (elapsed > maxBacklogMs) {
accumulator = 0;
last = timestamp;
if (typeof inputPreview?.clockGap === 'function') inputPreview.clockGap(); else inputPreview?.clear?.();
onBacklogDrop({ elapsedMs: elapsed, droppedTicks: Math.floor(elapsed / quantum), timestamp });
} else {
accumulator = backlogPolicy === 'retain' ? accumulator + elapsed :
Math.min(accumulator + Math.min(250, elapsed), quantum * session.profile.maxCatchupSteps);
last = timestamp;
}
if (!Number.isFinite(accumulator) || accumulator > Number.MAX_SAFE_INTEGER) throw new RangeError('loop backlog exceeds safe milliseconds');
session.poll();
if (current !== generation || timing !== timingGeneration) return;
if(inputPreview&&(!cached||timestamp-observedAt>=quantum))observeInput(timestamp);
let work = 0;
while (!session.closed && !session.resimulating && work < session.profile.maxCatchupSteps) {
const pace = session.pace ?? session.metrics.pace;
if (accumulator < quantum * pace) break;
const allowed = canAdvance();
if (current !== generation || timing !== timingGeneration) return;
if (!allowed) { if (backlogPolicy === 'drop') accumulator = Math.min(accumulator, quantum); break; }
const sampled = inputPreview ? (cached??observeInput(timestamp)) : getInput();
if(!sampled)break;
if (current !== generation || timing !== timingGeneration) return;
const packet = sampled && typeof sampled === 'object' && !ArrayBuffer.isView(sampled) && !(sampled instanceof ArrayBuffer) && Object.hasOwn(sampled, 'input');
const inputValue = packet ? sampled.input : sampled;
const input = inputPreview && inputPreview.enabled !== false && ArrayBuffer.isView(inputValue) ? new inputValue.constructor(inputValue) : inputValue;
if (packet) {
const commands = sampled.commands ?? [];
if (!Array.isArray(commands)) throw new TypeError('input packet commands must be an array');
if (commands.length && typeof session.queueCommand !== 'function') throw new TypeError('session does not support queued input commands');
for (const command of commands) {
if (!command || command.payload === undefined) throw new TypeError('input command payload required');
const payload = ArrayBuffer.isView(command.payload) ? new command.payload.constructor(command.payload) : command.payload;
if(inputPreview&&command.sequence!==null&&command.sequence!==undefined)continue;
const sequence = session.queueCommand(payload);
if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError('session command sequence');
if(inputPreview)command.sequence=sequence;
}
}
const previousTick = session.tick;
const result = session.advance(input); work++;
let submission;
if(inputPreview){
const metadata=session.localInputState,capture=metadata?.capture;
const key=capture?`${metadata.epoch}:${metadata.baseTick}:${capture.sequence}`:'';
if(capture && key!==captureKey){captureKey=key;submission={...capture,predict:cached?.predict!==false,boundaryTick:metadata.tick,epoch:metadata.epoch,timeMs:Math.max(timestamp,performance.now())};
submission.commands=capture.commands.map(command=>({...command,observationId:cached?.commands.find(c=>c.sequence===command.sequence)?.observationId}));
try{inputPreview.commit(submission,submission.timeMs)}catch(error){inputPreview.clear?.();onPreviewError(error)}
const assigned=new Set(capture.commands.map(c=>c.sequence));for(let i=observedCommands.length-1;i>=0;i--)if(assigned.has(observedCommands[i].sequence))observedCommands.splice(i,1);
}
}
if (timing !== timingGeneration) return;
if (result.status === 'advanced') accumulator = Math.max(0, accumulator - quantum * pace);
else if (backlogPolicy === 'drop') accumulator = Math.min(accumulator, quantum);
if (current !== generation) return;
onAdvance(result, submission);
if (current !== generation || timing !== timingGeneration) return;
if (result.status !== 'advanced') break;
}
if (shouldRender) renderFrame();
} catch (error) { if (current === generation) stop(); onError(error); }
};
const start = () => {
if (running) return;
if (typeof requestFrame !== 'function' || typeof cancelFrame !== 'function') throw new TypeError('frame scheduler');
running = true; resetTiming(false);
const current = ++generation;
const frame = timestamp => {
if (!running || current !== generation) return;
if(inputPreview)observeInput(timestamp);
pulse(timestamp);
if (running && current === generation) handle = requestFrame(frame);
};
globalThis.addEventListener?.('blur', release);
globalThis.document?.addEventListener('visibilitychange', hidden);
handle = requestFrame(frame);
};
const flushInput = timestamp => { accumulator=Math.max(accumulator,quantum*(session.pace??1));pulse(timestamp); };
return { start, stop, pulse, render: renderFrame, observeInput, flushInput, releaseInput:release, resetTiming, get running() { return running; } };
}

/* BLOOM GameKit · modules/simloop/deadline.js; vendored unchanged except ES export keyword. */
function createDeadlineScheduler({
  getIntervalMs,
  pulse,
  maxBacklogTicks = 8,
  now = () => performance.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onGap,
} = {}) {
  if (typeof getIntervalMs !== 'function') throw new TypeError('getIntervalMs must be a function');
  if (typeof pulse !== 'function') throw new TypeError('pulse must be a function');
  if (!Number.isSafeInteger(maxBacklogTicks) || maxBacklogTicks < 1) throw new RangeError('maxBacklogTicks must be a positive safe integer');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (typeof setTimer !== 'function') throw new TypeError('setTimer must be a function');
  if (typeof clearTimer !== 'function') throw new TypeError('clearTimer must be a function');
  if (onGap !== undefined && typeof onGap !== 'function') throw new TypeError('onGap must be a function');
  let active = false;
  let timerPending = false;
  let timerHandle;
  let generation = 0;
  let intervalMs;
  let deadline = null;
  let lastPulseAt = null;
  let lastNow = null;
  let dispatchingWake = false;
  const readNow = () => {
    const value = now();
    if (!Number.isFinite(value)) throw new RangeError('now() must return a finite timestamp');
    if (lastNow !== null && value < lastNow) throw new RangeError('now() must be monotonic');
    lastNow = value;
    return value;
  };
  const readInterval = () => {
    const value = getIntervalMs();
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('getIntervalMs() must return a positive finite interval');
    return value;
  };
  const clearPendingTimer = () => {
    if (!timerPending) return;
    timerPending = false;
    clearTimer(timerHandle);
    timerHandle = undefined;
  };
  let arm;
  const dispatchRegular = token => {
    if (!active || token !== generation) return;
    timerPending = false;
    timerHandle = undefined;
    const timestamp = readNow();
    if (timestamp < deadline) { arm(token); return; }
    const interval = intervalMs;
    const lateness = timestamp - deadline;
    if (!Number.isFinite(lateness)) throw new RangeError('clock gap is outside the supported range');
    const due = Math.floor(lateness / interval) + 1;
    const elapsedMs = lastPulseAt === null ? interval : timestamp - lastPulseAt;
    const maxGapMs = interval * maxBacklogTicks;
    if (elapsedMs > maxGapMs) {
      const droppedTicks = Math.max(0, due - 1);
      deadline = timestamp + interval;
      if (!Number.isFinite(deadline)) throw new RangeError('next deadline is outside the supported range');
      lastPulseAt = timestamp;
      onGap?.({ elapsedMs, droppedTicks, timestamp, scheduledAtMs: timestamp });
      if (!active || token !== generation) return;
      pulse(timestamp, { due: 1, scheduledAtMs: timestamp });
    } else {
      const scheduledAtMs = deadline;
      deadline += due * interval;
      if (!Number.isFinite(deadline)) throw new RangeError('next deadline is outside the supported range');
      lastPulseAt = timestamp;
      pulse(timestamp, { due, scheduledAtMs });
    }
    if (active && token === generation) arm(token);
  };
  arm = token => {
    if (!active || token !== generation || timerPending) return;
    const timestamp = readNow();
    const delay = Math.max(0, deadline - timestamp);
    timerPending = true;
    timerHandle = setTimer(() => dispatchRegular(token), delay);
  };
  const rebase = timestampMs => {
    const timestamp = timestampMs === undefined ? readNow() : timestampMs;
    if (!Number.isFinite(timestamp)) throw new RangeError('rebase timestamp must be finite');
    if (lastNow !== null && timestamp < lastNow) throw new RangeError('rebase timestamp must be monotonic');
    lastNow = timestamp;
    intervalMs = readInterval();
    deadline = timestamp + intervalMs;
    if (!Number.isFinite(deadline)) throw new RangeError('next deadline is outside the supported range');
    lastPulseAt = timestamp;
    generation += 1;
    clearPendingTimer();
    if (active) arm(generation);
  };
  const stop = () => {
    generation += 1;
    active = false;
    deadline = null;
    lastPulseAt = null;
    clearPendingTimer();
  };
  const start = () => {
    if (active) return;
    const timestamp = readNow();
    intervalMs = readInterval();
    deadline = timestamp + intervalMs;
    if (!Number.isFinite(deadline)) throw new RangeError('next deadline is outside the supported range');
    lastPulseAt = timestamp;
    active = true;
    generation += 1;
    arm(generation);
  };
  const wake = () => {
    if (!active || dispatchingWake) return;
    const timestamp = readNow();
    lastPulseAt = timestamp;
    dispatchingWake = true;
    try { pulse(timestamp, { due: 0, scheduledAtMs: null }); }
    finally { dispatchingWake = false; }
  };
  return {
    start,
    stop,
    wake,
    rebase,
    get running() { return active; },
    get deadlineMs() { return deadline; },
  };
}
