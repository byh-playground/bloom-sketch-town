#!/usr/bin/env python3
"""Face (expression) recognizer for Sketch Town summons.

Six classes: neutral + five expressions. A drawing is any number of strokes; they are rasterized together the same
way the game does (bounding box of ALL strokes fitted into a 32x32 image) and classified by a small MLP.
Training data are synthetic (generated below with random omissions, jitter, rotation and skew); no human-drawn
faces were available, so the reported accuracy is synthetic-held-out only.

Outputs source/face-model.js (loaded by the game as a classic script) and source/face_report.json.
Only numpy and Pillow are required. Run: python source/train_face.py
"""
from __future__ import annotations
import base64, json, math, random
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
LABELS = ['neutral', 'joy', 'anger', 'sleepy', 'surprise', 'sad']
SEED = 20261027
HIDDEN = 128
MIN_CONFIDENCE = 0.62   # below this the game draws a neutral face with no traits


def arc(cx, cy, rx, ry, a0, a1, n=14):
    return [(cx + rx * math.cos(a0 + (a1 - a0) * i / n), cy + ry * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def ring(cx, cy, r, n=18):
    return arc(cx, cy, r, r, 0, math.tau, n)


def dot(cx, cy):
    return [(cx, cy), (cx + 0.001, cy)]


def eye(rng, side, style):
    cx = side * rng.uniform(.34, .5)
    cy = rng.uniform(-.38, -.2)
    r = rng.uniform(.07, .13)
    if style == 'dot':
        return ring(cx, cy, rng.uniform(.045, .08), 8) if rng.random() < .4 else dot(cx, cy)
    if style == 'round':
        return ring(cx, cy, rng.uniform(.14, .22))
    if style == 'happy':       # ^ ^
        return arc(cx, cy + .08, rng.uniform(.12, .2), rng.uniform(.1, .18), math.pi, math.tau, 8)
    if style == 'closed':      # - -
        w = rng.uniform(.12, .22)
        return [(cx - w, cy), (cx + w, cy + rng.uniform(-.02, .03))]
    if style == 'droop':       # outer end lower
        w = rng.uniform(.1, .2)
        return [(cx - side * w * .6, cy - .04), (cx + side * w, cy + rng.uniform(.04, .1))]
    if style == 'sharp':       # inner end lower
        w = rng.uniform(.1, .2)
        return [(cx - side * w, cy - .02), (cx + side * w * .8, cy + rng.uniform(.03, .08))]
    return dot(cx, cy)


def brow(rng, side, tilt):
    # tilt > 0: inner end lower (angry); tilt < 0: inner end higher (sad)
    cx = side * rng.uniform(.38, .5)
    cy = rng.uniform(-.66, -.52)
    w = rng.uniform(.17, .27)
    outer = (cx + side * w, cy - tilt * w * .5)
    inner = (cx - side * w, cy + tilt * w * .5)
    return [inner, outer]


def mouth(rng, style):
    cy = rng.uniform(.34, .58)
    w = rng.uniform(.26, .5)
    if style == 'smile':
        return arc(0, cy - .12, w, rng.uniform(.14, .3), .12 * math.pi, .88 * math.pi, 12)
    if style == 'grin':
        return arc(0, cy - .2, w * 1.15, rng.uniform(.28, .4), .05 * math.pi, .95 * math.pi, 12) + [(-w * 1.1, cy - .17)]
    if style == 'frown':
        return arc(0, cy + .22, w, rng.uniform(.12, .28), 1.12 * math.pi, 1.88 * math.pi, 12)
    if style == 'flat':
        return [(-w, cy + rng.uniform(-.03, .03)), (w, cy + rng.uniform(-.03, .03))]
    if style == 'zigzag':
        n = rng.randint(4, 6)
        return [(-w + 2 * w * i / n, cy + (.07 if i % 2 else -.07)) for i in range(n + 1)]
    if style == 'small':
        return [(-w * .45, cy), (w * .45, cy + rng.uniform(-.02, .02))]
    if style == 'o':
        return ring(0, cy + .04, rng.uniform(.14, .26))
    if style == 'wave':
        return [(-w + 2 * w * i / 10, cy + .05 * math.sin(i * 1.3)) for i in range(11)]
    return [(-w, cy), (w, cy)]


def pick(rng, items):
    return items[rng.randrange(len(items))]


def slash_eyes(rng):
    """Angry eyes: two slanted strokes, inner ends lower (\\ /)."""
    out = []
    for side in (-1, 1):
        cx = side * rng.uniform(.34, .5)
        w = rng.uniform(.17, .27)
        out.append([(cx + side * w * 1.0, -.3 - rng.uniform(.12, .24)), (cx - side * w * .8, -.3 + rng.uniform(.0, .08))])
    return out


def dash_eyes(rng):
    """Sleepy eyes: two short horizontal strokes."""
    out = []
    for side in (-1, 1):
        cx = side * rng.uniform(.34, .5)
        w = rng.uniform(.13, .24)
        out.append([(cx - w, -.3 + rng.uniform(-.02, .02)), (cx + w, -.3 + rng.uniform(-.02, .04))])
    return out


def face(rng, label):
    """Easy faces: two eyes and (usually) a mouth, at most three strokes. Mouth and eye cues:
    joy = smile, sad = frown, surprise = round mouth (dot or round eyes), anger = slanted eyes, sleepy = flat dash eyes."""
    omit_mouth = rng.random() < .1
    if label == 'neutral':
        mode = rng.random()
        if mode < .5:           # calm: dot eyes + flat mouth
            return [eye(rng, -1, pick(rng, ['dot', 'dot', 'round'])), eye(rng, 1, pick(rng, ['dot', 'dot', 'round'])), mouth(rng, pick(rng, ['flat', 'flat', 'small']))]
        if mode < .6:           # eyes only / mouth only
            return [eye(rng, -1, 'dot'), eye(rng, 1, 'dot')] if rng.random() < .5 else [mouth(rng, 'flat')]
        strokes = []            # scribbles and unrelated marks
        for _ in range(rng.randint(1, 6)):
            x, y = rng.uniform(-.8, .8), rng.uniform(-.8, .8)
            pts = [(x, y)]
            for _ in range(rng.randint(2, 9)):
                x = max(-1, min(1, x + rng.uniform(-.7, .7)))
                y = max(-1, min(1, y + rng.uniform(-.7, .7)))
                pts.append((x, y))
            strokes.append(pts)
        return strokes
    if label == 'joy':
        style = pick(rng, ['dot', 'dot', 'dot', 'happy'])
        strokes = [eye(rng, -1, style), eye(rng, 1, style)]
        if not omit_mouth:
            strokes.append(mouth(rng, pick(rng, ['smile', 'smile', 'grin'])))
        return strokes
    if label == 'anger':
        strokes = slash_eyes(rng)
        if not omit_mouth:
            strokes.append(mouth(rng, pick(rng, ['flat', 'flat', 'frown', 'zigzag'])))
        return strokes
    if label == 'sleepy':
        strokes = dash_eyes(rng)
        if not omit_mouth:
            strokes.append(mouth(rng, pick(rng, ['small', 'small', 'flat'])))
        return strokes
    if label == 'surprise':
        style = pick(rng, ['dot', 'dot', 'round'])
        return [eye(rng, -1, style), eye(rng, 1, style), mouth(rng, 'o')]
    if label == 'sad':
        style = pick(rng, ['dot', 'dot', 'droop'])
        strokes = [eye(rng, -1, style), eye(rng, 1, style)]
        if not omit_mouth:
            strokes.append(mouth(rng, pick(rng, ['frown', 'frown', 'wave'])))
        return strokes
    raise ValueError(label)


def transform(rng, strokes):
    ang = rng.uniform(-.22, .22)
    sx, sy = rng.uniform(.85, 1.2), rng.uniform(.85, 1.2)
    shear = rng.uniform(-.12, .12)
    c, s = math.cos(ang), math.sin(ang)
    jitter = rng.uniform(0, .035)
    out = []
    for st in strokes:
        pts = []
        for x, y in st:
            x, y = x * sx + shear * y, y * sy
            x, y = x * c - y * s, x * s + y * c
            pts.append((x + rng.gauss(0, jitter), y + rng.gauss(0, jitter)))
        out.append(pts)
    return out


def raster(strokes) -> np.ndarray:
    """Same fit as the game's imageOf(): all strokes share one bounding box, longest side 23.5 of 32 (x3 on 96)."""
    xs = [p[0] for st in strokes for p in st]
    ys = [p[1] for st in strokes for p in st]
    if not xs:
        return np.zeros(1024, np.float32)
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    scale = 23.5 / max(1e-4, maxx - minx, maxy - miny)
    mx, my = (minx + maxx) / 2, (miny + maxy) / 2
    img = Image.new('L', (96, 96), 0)
    d = ImageDraw.Draw(img)
    for st in strokes:
        pts = [(48 + 3 * (x - mx) * scale, 48 + 3 * (y - my) * scale) for x, y in st]
        d.line(pts, fill=255, width=7, joint='curve')
        for x, y in (pts[0], pts[-1]):
            d.ellipse((x - 3.5, y - 3.5, x + 3.5, y + 3.5), fill=255)
    small = img.resize((32, 32), Image.BOX)
    return (np.asarray(small, np.float32) / 255.0).reshape(-1)


def make(rng, per_class):
    X, y = [], []
    for ci, label in enumerate(LABELS):
        for _ in range(per_class):
            X.append(raster(transform(rng, face(rng, label))))
            y.append(ci)
    X = np.stack(X)
    y = np.array(y)
    order = np.random.RandomState(rng.randrange(1 << 30)).permutation(len(y))
    return X[order], y[order]


def softmax(z):
    z = z - z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)


def train():
    rng = random.Random(SEED)
    np.random.seed(SEED)
    Xtr, ytr = make(rng, 2600)
    Xva, yva = make(rng, 500)
    n_in, n_out = 1024, len(LABELS)
    W1 = np.random.randn(n_in, HIDDEN).astype(np.float32) * math.sqrt(2 / n_in)
    b1 = np.zeros(HIDDEN, np.float32)
    W2 = np.random.randn(HIDDEN, n_out).astype(np.float32) * math.sqrt(2 / HIDDEN)
    b2 = np.zeros(n_out, np.float32)
    params = [W1, b1, W2, b2]
    m = [np.zeros_like(p) for p in params]
    v = [np.zeros_like(p) for p in params]
    lr, step, batch, epochs = 2e-3, 0, 128, 60
    best = (0, None)
    for epoch in range(epochs):
        perm = np.random.permutation(len(ytr))
        for i in range(0, len(perm), batch):
            idx = perm[i:i + batch]
            x, t = Xtr[idx], ytr[idx]
            x = x * (np.random.rand(len(idx), 1) * .3 + .85)          # brightness jitter
            h = np.maximum(0, x @ W1 + b1)
            h *= (np.random.rand(*h.shape) > .15) / .85              # dropout
            p = softmax(h @ W2 + b2)
            g = p.copy()
            g[np.arange(len(t)), t] -= 1
            g /= len(t)
            gW2, gb2 = h.T @ g, g.sum(0)
            gh = (g @ W2.T) * (h > 0)
            gW1, gb1 = x.T @ gh, gh.sum(0)
            step += 1
            for k, (pa, gr) in enumerate(zip(params, [gW1 + 1e-4 * W1, gb1, gW2 + 1e-4 * W2, gb2])):
                m[k] = .9 * m[k] + .1 * gr
                v[k] = .999 * v[k] + .001 * gr * gr
                pa -= lr * (m[k] / (1 - .9 ** step)) / (np.sqrt(v[k] / (1 - .999 ** step)) + 1e-8)
        if epoch == 40:
            lr = 7e-4
        pv = softmax(np.maximum(0, Xva @ W1 + b1) @ W2 + b2)
        acc = float((pv.argmax(1) == yva).mean())
        if acc >= best[0]:
            best = (acc, [p.copy() for p in params])
    W1, b1, W2, b2 = best[1]
    pv = softmax(np.maximum(0, Xva @ W1 + b1) @ W2 + b2)
    pred = pv.argmax(1)
    conf = pv.max(1)
    shown = np.where(conf >= MIN_CONFIDENCE, pred, 0)   # what the game shows: low confidence -> neutral
    per_class = {l: float((shown[yva == i] == i).mean()) for i, l in enumerate(LABELS)}
    wrong_expression = float(((shown != yva) & (shown != 0)).mean())
    report = {
        'version': '0.18.0', 'seed': SEED, 'labels': LABELS, 'hidden': HIDDEN, 'min_confidence': MIN_CONFIDENCE,
        'data': 'synthetic faces only (no human-drawn faces were available)', 'train_count': int(len(ytr)), 'validation_count': int(len(yva)),
        'validation_accuracy_raw': float((pred == yva).mean()), 'validation_accuracy_as_shown': float((shown == yva).mean()),
        'class_accuracy_as_shown': per_class, 'wrongly_shown_as_another_expression': wrong_expression,
    }
    return (W1, b1, W2, b2), report


def b64(a):
    return base64.b64encode(np.ascontiguousarray(a, dtype='<f4').tobytes()).decode()


def main():
    (W1, b1, W2, b2), report = train()
    # Row-major [out][in] like the game's denseRelu expects: weight[j*in + k].
    model = {'labels': LABELS, 'hidden': HIDDEN, 'minConfidence': MIN_CONFIDENCE,
             'w1': b64(W1.T), 'b1': b64(b1), 'w2': b64(W2.T), 'b2': b64(b2)}
    (ROOT / 'face-model.js').write_text(
        '  // Generated by source/train_face.py - do not edit by hand.\n  const FACE_MODEL=' + json.dumps(model, separators=(',', ':')) + ';\n', encoding='utf-8')
    (ROOT / 'face_report.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
