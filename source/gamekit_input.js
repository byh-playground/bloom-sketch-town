function actionName(action) {
if (typeof action !== 'string' || !action.length) throw new TypeError('action must be a nonempty string');
}
function sourceId(source) {
if ((typeof source !== 'string' || !source.length) && typeof source !== 'symbol') {
throw new TypeError('source must be a nonempty string or symbol');
}
}
class ActionState {
#actions = new Map();
#sources = new Map();
#entry(action) {
let entry = this.#actions.get(action);
if (!entry) {
entry = { sources: new Set(), pressed: false, released: false };
this.#actions.set(action, entry);
}
return entry;
}
set(action, source, down) {
actionName(action); sourceId(source);
if (typeof down !== 'boolean') throw new TypeError('down must be boolean');
const entry = down ? this.#entry(action) : this.#actions.get(action);
if (!entry || entry.sources.has(source) === down) return;
if (down) {
if (!entry.sources.size) entry.pressed = true;
entry.sources.add(source);
let actions = this.#sources.get(source);
if (!actions) this.#sources.set(source, actions = new Set());
actions.add(action);
} else {
entry.sources.delete(source);
if (!entry.sources.size) entry.released = true;
const actions = this.#sources.get(source);
actions.delete(action);
if (!actions.size) this.#sources.delete(source);
}
}
pulse(action) {
actionName(action);
const entry = this.#entry(action);
entry.pressed = true; entry.released = true;
}
releaseSource(source) {
sourceId(source);
const actions = this.#sources.get(source);
if (!actions) return;
for (const action of actions) {
const entry = this.#actions.get(action);
entry.sources.delete(source);
if (!entry.sources.size) entry.released = true;
}
this.#sources.delete(source);
}
releaseAll() {
for (const source of this.#sources.keys()) this.releaseSource(source);
}
sampleInto(action, out) {
actionName(action);
if (!out || typeof out !== 'object') throw new TypeError('out must be a writable object');
const entry = this.#actions.get(action);
out.held = !!entry?.sources.size;
out.pressed = entry?.pressed ?? false;
out.released = entry?.released ?? false;
return out;
}
sample(action) { return this.sampleInto(action, {}); }
consume() {
for (const entry of this.#actions.values()) {
entry.pressed = false; entry.released = false;
}
}
}
