# SVG renderer benchmark for Sketch Town 0.16.0

This report contains separate renderer datasets. The earlier fixed-scene measurements below are for the GameKit Vector Assets v0.6.5 candidate; its `rendering.js` and `vector-assets.js` bytes match v0.6.4, and the two 4-second SwiftShader samples were not repeated during the v0.6.5 pin verification. The later six-round comparison below measures the official GameKit renderer v0.15.1 candidate against legacy WebGL1 L. Do not attribute the older 16.4–20.9% sample results to v0.15.1. The older v0.6.1 run remains below as historical context.

## Earlier fixed-scene candidate: GameKit Vector Assets 0.6.5, curveSegments 8

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

The canonical `python source/build_rpg.py` passed with the official GameKit Vector Assets v0.6.5 source/dist pins and the four multiplayer ESM modules from GameKit v0.14.3. It compiled all 17 authored SVGs with `compilerOptions.curveSegments=8`. The regenerated `index.html` is 2,080,671 bytes (SHA-256 `cbd59e38e3b559a5fcdd15097096ae6cafc75fc8f55e03f9ed3e5d841d43b3d3`). These SVGs are static, predefined assets; user-created freehand strokes remain dynamic point geometry and are not serialized or recompiled as SVG. The fixed-scene Edge 155 FPS/draw/upload measurements below predate the v0.14.3 multiplayer-module refresh; the vector renderer and compiled SVG bytes were unchanged, but the full updated bundle has not had a new paired SwiftShader performance run.

Before the GameKit update, a fresh final-bundle `python source/e2e.py --flow online --live-p2p` run passed public Nostr/WebRTC admission, start-before-join investments, and simultaneous PC/mobile gate completion with one 25-ink cost. The guest leave then failed: the host roster stayed at two players and progress showed `membership deadline exceeded`. A diagnostic showed both peers reached the leave transition's prepared, reached, and installed states; the host sent commit but received no `committed` acknowledgement before the link closed.

The defect was in the previously pinned GameKit `RoomSession._commit()` path: it removed the departing local player and set `_departing`, then the same `poll()` continued into the no-core join-deadline check and failed before a later poll could flush the final acknowledgement. GameKit PR #99 fixed this by flushing and returning from the departing branch after message processing. The merged source commit is `dd59a57fcf66409cef16632ffb433c0b760324fa`; the official v0.14.3 dist commit is `418e17c455db56d6ed073d82d115191d9dd8bf04` with manifest SHA-256 `20244c2beeee33719f407a9baa92c55a4bd55a0e4eb9f094590bb0eed652296e`. Sketch Town now pins the four used ESM modules to that dist; the rollback bundle SHA-256 is `071fb0f82521d212d00f112abd90fc149616d80b79d4628db0008637ce102596`.

After the pin update, `python source/e2e.py --flow online --live-p2p` passed all 7 checks in 58.48 seconds in Edge 155.0.4283.62 on this Windows host with WebGL1/ANGLE SwiftShader, real public Nostr signaling and WebRTC, two separate host/guest browser contexts, and no mock transport: the guest leave committed to a one-player host roster; joining the same room restored the shared gate and personal investment; both peers ended with matching confirmed state hashes; and neither browser logged JavaScript errors. The final-bundle full `python source/e2e.py` run passed all 64 offline checks in 154.25 seconds; its single `NOT_RUN` was the explicitly unrequested public-network RTC check. A broader `--flow progression --live-p2p` run passed its 51 gameplay, delayed/duplicated-input rollback, cast replication, and gate assertions, then hit the E2E harness 1-second click timeout while reopening the multiplayer modal before its leave steps; the focused online run above completed leave/rejoin on the same bundle. These runs use mobile viewport emulation, not a mobile device, and do not cover peers behind a shared public NAT.

**Status:** the guest leave/rejoin blocker is resolved by the pinned SDK and the current online E2E. Keep PR #12 as a draft because the measured SwiftShader performance regression remains unresolved. This CPU software renderer evidence is not a claim about actual mobile hardware performance.

## Official GameKit 0.15.1 non-radial pipeline candidate (2026-10-19)

The renderer now imports only the official GameKit 0.15.1 `rendering.js` module from dist commit `50f835a801a8fae3c982e051290a26555ac031df` (module SHA-256 `1a3790c3281de93ff361a8720eccfb03b60018b09937a84a8d4da02b3f73c9ba`; official manifest SHA-256 `7540662fda050f8f2fcfdb6cc21818a136c0f8d3df93a53dcde68175f70c65b0`). The previous GameKit Vector Assets 0.6.5 runtime/compiler, compiled geometry, SVG inputs, facade, simulation time/seed, and multiplayer module pins remain unchanged. Candidate N selects the new plain pipeline for non-radial submissions while retaining the full radial pipeline.

### Pixel and submission parity

F is the existing candidate, G is the temporary old-fragment control, and N is the official new renderer module. All 4 viewport/camera combinations produced identical RGBA hashes across F/G/N:

| Viewport and camera | Exact pixel SHA-256 (F = G = N) |
| --- | --- |
| 1024×768 DPR1, zoom 1, rotation 0 | `618b753e1028caf1f39a2027cc075f7255050dcefa2900fbe0c4b36aa699f25c` |
| 1024×768 DPR1, zoom 1.23, rotation 0.17 | `69b406b552e606e1333892b0fbf9cdddb392ccc352c393bb42d528ae27890f6` |
| 844×390 DPR2, zoom 1, rotation 0 | `f397ae7c61a7746f85a8844751b9101628f4f8f6ad82beb4e1ec1480e46ce5a2` |
| 844×390 DPR2, zoom 1.23, rotation 0.17 | `e1632119dca5250551a3fc44db61aaff3a822b9e4db26b6fa143f5451f8004dc` |

F/G/N kept exact draw order and counts: desktop 22 draws (6 vector, 16 mesh), 56,703 submitted vertices and 183,680 upload bytes/frame; mobile-sized 20 draws (6 vector, 14 mesh), 38,250 vertices and 182,208 upload bytes/frame. All three reported zero static geometry uploads and zero geometry bytes uploaded. N uses no radial uniforms for these solid submissions; radial support remains in its separate full pipeline.

### Six-round paired performance comparison

Edge 155.0.4283.62 was run with the same fixed scene and camera at each viewport. Each candidate received six 3.5-second warmups and six 15-second samples, in balanced crossover order. The FPS window had no profiler, GL census, readback, `gl.finish`, or page logging. Values below are pooled median/p95 requestAnimationFrame intervals in milliseconds; lower is faster. Run-by-run medians, p95 values, ranges, frame intervals, and paired confidence intervals are in the local evidence summary.

| SwiftShader viewport | L legacy WebGL1 | S_F | F | G old fragment | N official renderer | N vs G median/p95 | N vs F median/p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1024×768 DPR1 | 41.70 / 41.80 | 50.00 / 50.10 | 58.30 / 58.40 | 50.00 / 50.10 | 41.70 / 50.10 | −16.60% / 0.00% | −28.47% / −14.21% |
| 844×390 DPR2 | 50.00 / 58.40 | 58.40 / 66.70 | 75.00 / 83.40 | 58.40 / 66.70 | 58.30 / 66.70 | −0.17% / 0.00% | −22.27% / −20.02% |

The preset N-vs-G gate passes on both viewports: median interval is not worse by +3%, p95 is not worse by +5%, and N beats F in all 6/6 paired median comparisons. N is also equal to or faster than S_F. Paired 95% t intervals for median/p95 change were desktop N-vs-G −16.57% [−16.65, −16.48] / 0.00% [−0.00, 0.00], and mobile-sized −0.17% [−0.17, −0.17] / −0.07% [−0.16, 0.01].

The overall Sketch performance gate still fails against L. Desktop N ties L median but its p95 is 19.86% worse (50.10 vs 41.80ms). On the mobile-sized viewport N is 16.60% worse at median and 14.21% worse at p95 (58.30/66.70 vs 50.00/58.40ms). L is the legacy WebGL1 renderer, not Canvas2D. This CPU software-renderer gap is not a claim about mobile hardware.

A separate six-round hardware run used ANGLE/NVIDIA GeForce GTX 1660 Ti D3D11. All candidates and viewports sampled about 119.99 FPS with 8.30ms median and 8.40–8.50ms p95 intervals. The renderer holds the game's 60 app-FPS target, but the 120Hz sampling cap masks candidate differences on this GPU.

### Final bundle validation and acceptance

The canonical `python source/build_rpg.py` generated `index.html` SHA-256 `3f4655495d2478c4c37ce07fb5594c31a42604e5e876cdd44c02ff0fa8bff1bf`; the 17-asset generated geometry remained byte-identical (SHA-256 `40929af1e099f30f9b52f491b2835653c014635e9d289dbdfe495067896cd62e`). Against that exact bundle, the existing offline E2E passed 64 checks with one public-network check `NOT_RUN` (105.08s), and the live public Nostr/WebRTC flow passed all 7 checks (44.18s), including guest leave/rejoin and matching confirmed state hashes. Both used Edge WebGL1/ANGLE SwiftShader; D3D11 measurements above are separate hardware validation.

The official N renderer and final bundle pass their isolated rendering, build, lifecycle, offline, and online checks. Keep PR #12 as a draft and do not merge or deploy yet: the final Sketch SwiftShader comparison still regresses against L. No extra batching or renderer API change was included in this candidate.

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
