# SVG renderer benchmark for Sketch Town 0.16.0

This report compares the exact main-branch 0.16.0 bundle with the SVG candidate built from the same game state. It is a controlled fixed scene, not a gameplay trace: simulation is paused after setup, with the player, five fixed enemies, and repeated static map props visible. Both versions use Edge 155, a 4-second sample after a 1-second settle, and the same viewport/DPR. The graphics-path numbers are single-run observations, so use them to identify the repeatable direction and work performed, not as a hardware-wide FPS guarantee.

The candidate embeds the official GameKit 0.6.1 distribution. Its checksums and source commit are recorded in `source/gamekit/0.6.1/provenance.json`.

## Desktop, 1024×768 at DPR 1

| Renderer | Observed FPS | App FPS | Draw calls | Submitted vertex/index references | Upload bytes/frame |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline, NVIDIA D3D11 | 113.24 | 60 | 1 | 28,848 vertices | 923,136 |
| SVG, NVIDIA D3D11 | 119.99 | 60 | 22 | 94,167 index references | 183,680 |
| Baseline, SwiftShader | 24.65 | 25 | 1 | 28,848 vertices | 923,136 |
| SVG, SwiftShader | 19.25 | 19 | 22 | 94,167 index references | 183,680 |

The D3D11 runs both held the game's 60 FPS target; the observed rate is above that target and is not evidence that the SVG version is faster. SwiftShader lost 21.9% observed FPS (24.65 to 19.25). Upload traffic fell by 80.1%, but the indexed SVG scene submitted 3.27× as many vertex references and 21 additional draw calls.

## Mobile landscape, 844×390 at DPR 2

| Renderer | Observed FPS | App FPS | Draw calls | Submitted vertex/index references | Upload bytes/frame |
| --- | ---: | ---: | ---: | ---: | ---: |
| Baseline, NVIDIA D3D11 | 119.99 | 60 | 1 | 19,332 vertices | 618,624 |
| SVG, NVIDIA D3D11 | 119.99 | 60 | 20 | 62,586 index references | 182,208 |
| Baseline, SwiftShader | 20.04 | 20 | 1 | 19,332 vertices | 618,624 |
| SVG, SwiftShader | 15.40 | 15 | 20 | 62,586 index references | 182,208 |

The mobile SwiftShader run lost 23.2% observed FPS (20.04 to 15.40). D3D11 held the 60 FPS app target in both cases. Mobile upload traffic fell by 70.6%, while submitted index references were 3.24× the baseline.

## Renderer attribution

In the desktop SVG frame, GameKit reported 16 ordered mesh batches for 56 instances; the rest of the 22 total calls were dynamic canvas/vector draws. The repeated one-part environment props share retained meshes and batch when adjacent in painter order. Player and enemy SVGs each use a single mesh submission, but actors with distinct multipart clip/expression poses cannot share an instance batch. No draw sorting or game-specific mesh combining was added.

An independent actor scale check submitted 100 distinct chaser poses as 100 mesh draws, and 400 distinct poses as 400 draws. Both ran without per-frame geometry uploads, with deterministic pose rollback and no WebGL errors. Submission CPU time was 2.7 ms warm at 100 actors and 14.3 ms warm at 400 actors. This confirms that the remaining cost is in mesh submissions and indexed geometry work, not repeated mesh uploads.

GameKit 0.6.1 indexed bit-identical complete vertex records. Across the 17 authored SVGs this stores 11,862 unique vertices plus indices and retains roughly 589 KB of geometry, compared with 33,669 vertices and roughly 1.48 MB in the previous compiler output. That reduces storage but does not reduce the current frame's index count enough to preserve SwiftShader performance.

## Acceptance status

Visual inspection confirmed that the game retains its own silhouettes, line-art style, map composition, and hand-drawn live-stroke behavior. The desktop/mobile input and save-roundtrip checks passed. The isolated progression flow passed 15 checks, and real two-browser Nostr/WebRTC rollback and reconnect passed 6 checks. The combined E2E entrypoint hit its 180-second global limit after 53 passes; splitting flows allowed progression and P2P to complete. The UX flow still fails its 390px growth-panel visibility assertion; the exact 0.16.0 baseline E2E had the same assertion fail, so it is not attributed to this renderer change.

The build and runtime checks pass, but this candidate is not performance-neutral on SwiftShader. The common module needs a further ordered batching or geometry-submission improvement before the migration can be considered free of regressions across both rendering paths.
