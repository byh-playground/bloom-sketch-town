# SVG renderer benchmark for Sketch Town 0.16.0

This report records the official GameKit Vector Assets v0.6.5 candidate and the renderer measurements for its runtime bundle. The v0.6.5 `rendering.js` and `vector-assets.js` bytes match v0.6.4 exactly, so the measurements below characterize the same renderer code; the GPU samples were not repeated during the v0.6.5 pin verification. The older v0.6.1 run remains below as historical context.

## Current candidate: GameKit Vector Assets 0.6.5, curveSegments 8

The controlled scene uses the same main baseline and candidate HTML, Edge 155, 1024×768 DPR1 or 844×390 DPR2, a 1-second settle and 4-second sample. Setup fixes the player at (475,735), five enemies, HP 120, zero projectiles/casts, and pauses simulation before sampling; reported actual TPS was 0. Two uninstrumented SwiftShader samples were run for each viewport. D3D11 results are one sample per viewport. These are this host's measurements, not hardware-wide guarantees.

| Graphics path / viewport | Baseline observed FPS | SVG observed FPS | App FPS baseline → SVG | Draw calls baseline → SVG | Vertices baseline → SVG | Upload bytes/frame baseline → SVG |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| SwiftShader, 1024×768 DPR1 | 26.14, 26.50 | 21.84, 21.50 | 26 → 22 | 1 → 22 | 28,848 → 56,130 | 923,136 → 183,680 |
| SwiftShader, 844×390 DPR2 | 20.46, 21.79 | 17.11, 17.25 | 20/22 → 17 | 1 → 20 | 19,332 → 37,677 | 618,624 → 182,208 |
| NVIDIA D3D11, 1024×768 DPR1 | 119.991 | 119.985 | 60 → 60 | 1 → 22 | 28,848 → 56,130 | 923,136 → 183,680 |
| NVIDIA D3D11, 844×390 DPR2 | 119.991 | 119.988 | 60 → 60 | 1 → 20 | 19,332 → 37,677 | 618,624 → 182,208 |

The paired SwiftShader samples show a 16.4–18.9% desktop FPS loss and a 16.4–20.9% mobile-landscape loss. D3D11 holds the 60 app FPS target in both builds. Per-frame upload bytes fall 80.1% at desktop and 70.5% at mobile, while the ordered draw count remains 22/20. No per-frame SVG geometry upload was observed; GameKit submitted 16 mesh draws for 56 instances at desktop and 14 for 33 at mobile. Runtime retained mesh bytes were 432,456 desktop and 418,632 mobile.

The game's smoothed render-callback EMA varied by run and is not a GPU timer; it does not establish a stable CPU improvement. The persistent SwiftShader FPS regression alongside the increased draw count is the unresolved acceptance issue. A follow-up caches the already evaluated pose for the `static` clip, avoiding repeat pose seeks while the clip and expression are unchanged. It does not change the painter-ordered mesh submissions or submitted index count, so it is not treated as resolving this FPS regression.

For the 17 authored Sketch Town SVGs, the supplied same-asset measurement reports retained geometry of 443,720 bytes at 16 segments and 278,940 bytes at 8 segments (-37.1%). The same-state 1024×768 pixel comparison differed in 44,877 of 2,359,296 RGBA channel values (1.90%), with mean absolute difference 0.168 and maximum 73; differences were chiefly small leaf and curve edges. At the game's fixed scale, no clear silhouette, outline, or expression loss was observed. These results validate `curveSegments: 8` for these Sketch Town assets; they do not establish a CPU or FPS improvement.

The canonical `python source/build_rpg.py` passed with the official v0.6.5 source and dist pins and compiled all 17 authored SVGs with `compilerOptions.curveSegments=8`. The final generated `index.html` is 2,014,231 bytes (SHA-256 `3dd3a9802e56fd5d82874231b65892ec8dea23f5c6ea99465bbf99882286eb31`). These SVGs are static, predefined assets; user-created freehand strokes remain dynamic point geometry and are not serialized or recompiled as SVG. The previously recorded Edge 155 baseline/candidate measurements describe an earlier source state. The final full non-network E2E passed 64 checks with one public-network-only check not run; that report is from the final bundle and current source.

On 2026-10-18, a fresh final-bundle `python source/e2e.py --flow online --live-p2p` run passed actual public Nostr/WebRTC admission, start-before-join investments, and simultaneous PC/mobile gate completion with exactly one 25-ink cost. The strict leave/rejoin check then failed because the host roster stayed at two players and its progress reported `membership deadline exceeded`. A diagnostic run of the same application protocol observed both peers reach the leave transition's prepared, reached, and installed states; the host sent commit but received no `committed` acknowledgement before the peer link closed.

The guest failure is reproducible in the local pinned `source/gamekit/rollback.js`: while processing the leave commit, `RoomSession._commit()` removes the departing local player and sets `_departing`. The same in-progress `poll()` then continues into its no-core join-deadline check and fails the session before the next poll can run the departure path and flush the final acknowledgement. The latest public `byh-playground/bloom-gamekit` main revision checked for this run has the same ordering in [`modules/rollback/room-session.js`](https://github.com/byh-playground/bloom-gamekit/blob/15be3ce7678a18922b68a362756213e73de27ea2/modules/rollback/room-session.js). This requires a fix in the shared GameKit dependency; Sketch Town does not patch its internal SDK state or add a disconnect/rejoin fallback.

**Status:** keep PR #12 as a draft. Do not merge or deploy while the measured SwiftShader regression and GameKit graceful-leave/reconnect defect remain. The three passing online checks do not clear the leave/rejoin blocker, and the earlier independent reconnect result does not substitute for this fresh failed run.

## Historical v0.6.1 candidate measurements

The candidate embeds the official GameKit 0.6.1 distribution. Its checksums and source commit are recorded in `source/gamekit/0.6.1/provenance.json`.

### Desktop, 1024×768 at DPR 1

| Renderer | Observed FPS | App FPS | Render callback EMA (ms) | Draw calls | Submitted vertex/index references | Upload bytes/frame |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline, NVIDIA D3D11 | 119.99 | 60 | 2.66 | 1 | 28,848 vertices | 923,136 |
| SVG, NVIDIA D3D11 | 119.99 | 60 | 2.13 | 22 | 94,167 index references | 183,680 |
| Baseline, SwiftShader | 24.20 | 24 | 10.94 | 1 | 28,848 vertices | 923,136 |
| SVG, SwiftShader | 19.17 | 19 | 9.41 | 22 | 94,167 index references | 183,680 |

The D3D11 runs both held the game's 60 FPS target; the observed rate is above that target and is not evidence that the SVG version is faster. SwiftShader lost 20.8% observed FPS (24.20 to 19.17). Upload traffic fell by 80.1%, but the indexed SVG scene submitted 3.27× as many vertex references and 21 additional draw calls.

### Mobile landscape, 844×390 at DPR 2

| Renderer | Observed FPS | App FPS | Render callback EMA (ms) | Draw calls | Submitted vertex/index references | Upload bytes/frame |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline, NVIDIA D3D11 | 119.99 | 60 | 1.73 | 1 | 19,332 vertices | 618,624 |
| SVG, NVIDIA D3D11 | 119.99 | 60 | 2.02 | 20 | 62,586 index references | 182,208 |
| Baseline, SwiftShader | 21.70 | 22 | 4.54 | 1 | 19,332 vertices | 618,624 |
| SVG, SwiftShader | 16.03 | 16 | 17.55 | 20 | 62,586 index references | 182,208 |

The mobile SwiftShader run lost 26.1% observed FPS (21.70 to 16.03). D3D11 held the 60 FPS app target in both cases. Mobile upload traffic fell by 70.6%, while submitted index references were 3.24× the baseline.

The render callback EMA is the game's smoothed CPU time around its presentation callback; it is not a GPU timer. The browser did not expose a reliable per-frame GPU duration here, so observed FPS and the submitted draw/index/upload counts are the GPU-path evidence. These remain single 4-second samples.

### Renderer attribution

In the desktop SVG frame, GameKit reported 16 ordered mesh batches for 56 instances; the rest of the 22 total calls were dynamic canvas/vector draws. The repeated one-part environment props share retained meshes and batch when adjacent in painter order. Player and enemy SVGs each use a single mesh submission, but actors with distinct multipart clip/expression poses cannot share an instance batch. No draw sorting or game-specific mesh combining was added.

An independent actor scale check submitted 100 distinct chaser poses as 100 mesh draws, and 400 distinct poses as 400 draws. Both ran without per-frame geometry uploads, with deterministic pose rollback and no WebGL errors. Submission CPU time was 2.7 ms warm at 100 actors and 14.3 ms warm at 400 actors. This confirms that the remaining cost is in mesh submissions and indexed geometry work, not repeated mesh uploads.

GameKit 0.6.1 indexed bit-identical complete vertex records. Across the 17 authored SVGs this stores 11,862 unique vertices plus indices and retains roughly 589 KB of geometry, compared with 33,669 vertices and roughly 1.48 MB in the previous compiler output. That reduces storage but does not reduce the current frame's index count enough to preserve SwiftShader performance.

### Historical acceptance status

Visual inspection confirmed that the game retains its own silhouettes, line-art style, map composition, and hand-drawn live-stroke behavior. The final paired desktop/mobile Edge/WebGL flow passed 34 checks, including bfcache suspend/resume, actual WebGL context loss and restore, multi-touch input, drawing, and save-roundtrip. The isolated progression flow passed 15 checks, and real two-browser Nostr/WebRTC rollback and reconnect passed 6 checks. The combined E2E entrypoint hit its 180-second global limit after 53 passes; splitting flows allowed desktop/mobile, progression, and P2P to complete. The UX flow still fails its 390px growth-panel visibility assertion; the exact 0.16.0 baseline E2E had the same assertion fail, so it is not attributed to this renderer change.

The build and runtime checks pass, but this candidate is not performance-neutral on SwiftShader. The common module needs a further ordered batching or geometry-submission improvement before the migration can be considered free of regressions across both rendering paths.
