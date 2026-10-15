# SVG renderer migration

Sketch Town keeps its own hand drawn art and uses the pinned GameKit vector asset pipeline for character and static environment resources. This migration does not change simulation rules, movement, collision, save data, input sampling, or multiplayer state.

## Source and build flow

- `source/assets/*.svg` is the authored source for the player, enemies, houses, trees, and individual environment props. Part pivots, sockets, expressions, and animation clips live in each file's `vector-asset` metadata.
- `scripts/compile-vector-assets.mjs` invokes the pinned GameKit Vector Assets 0.6.5 compiler with `curveSegments: 8` and writes the ignored `source/vector_assets.generated.js` registry. The browser never compiles SVG at runtime.
- `source/build_rpg.py` verifies the SDK manifests and checksums, embeds the exact official ESM module bytes, compiles the source bundle, and regenerates the root `index.html`.
- Rebuild with Node.js 22+, `npm ci`, and Python 3.10+: `python source/build_rpg.py`.

The vector renderer pin is `byh-playground/bloom-gamekit` v0.6.5, source commit `71b368bd85eaa1aa17fb841573da7fd9ffe0c9de`, distribution commit `b1bd32a1876fb8b096f483a93d1079da49e4fc74`. `source/gamekit/0.6.5/provenance.json` records the manifest and exact module/compiler hashes; the committed files retain the LF bytes used by those checksums. The compiler dependencies remain pinned in `package-lock.json`. Existing simulation, transport, and rollback modules remain on the game's prior GameKit pin.

## Runtime boundary

`game_part3.js` maps the current game state to an SVG clip and expression. Poses, enemy expressions, house variants, and plant sway are authored in SVG metadata. SVG meshes and runtime geometry share one GameKit WebGL device. The renderer flushes vector geometry before each mesh boundary so painter order, alpha blending, clipping, and depth ordering stay in the same order as the game calls; it does not globally reorder draws.

User drawn strokes remain sampled runtime input and dynamic game geometry. They are not converted into SVG files or recompiled on each frame. Transient effects such as projectile trails, impacts, rings, and cast sparks also remain runtime geometry. Static player/enemy bodies and repeated environment objects are compiled once at build time and their GPU meshes are cached until disposal. A non-persisted `pagehide` releases every vector asset, the context, its device, and input resources. A persisted bfcache `pagehide` pauses the game loops while keeping those resources alive; persisted `pageshow` resumes them.

Each environment item has its own SVG mesh. This avoids submitting hidden geometry for every tree or house when the shared environment art sheet is used repeatedly. Repeated instances may be instanced when adjacent in painter order, but the renderer preserves ordering boundaries and does not promise one draw per SVG asset or a fixed draw count.

## Supported SVG

The compiler accepts the SVG elements `svg`, `metadata`, `defs`, `linearGradient`, `stop`, `g`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, and `polygon`. It supports solid fills/strokes and restricted linear gradients: direct root `defs`, explicit stops, `pad` spread, object-bounding-box or unitless user-space coordinates, and internal `fill="url(#id)"` references. Gradient stops are compiled to flat-colored triangles; there is no runtime gradient texture. See `source/gamekit/0.6.5/upstream-source/modules/vector-assets/compiler.js` for the complete contract.

The compiler rejects unsupported tags, attributes, namespaces, event handlers, external references, doctypes, and entities with an error; a build fails rather than silently dropping them. It does not support raster `<image>`, `foreignObject`, scripts, CSS stylesheets or `style`/`class`, radial gradients, gradient inheritance/transforms, `<use>`, filters, masks, or clipping paths. Clip paths remain unsupported. The 17 authored Sketch Town SVGs contain no gradients or `clipPath` elements and use none of these unsupported features.

## Runtime notes

- SVG meshes use the GameKit MeshRenderer and are uploaded once. GameKit 0.6.5 indexes bit-identical complete vertex records into a 16-bit index buffer while preserving triangle order; seeking a clip only updates part transforms and does not rebuild geometry.
- The retained mesh renderer batches consecutive instances only when mesh, multipart poses, projection, clip planes, and depth state match. One-part static props can reuse a retained mesh across different transforms. Independently animated multipart actors have different per-part poses and stay in separate draws; the renderer does not sort them or cross painter boundaries. `MeshBuilder.combine` remains available for explicitly compatible groups up to 16 total parts, but it duplicates geometry into a combined mesh and is not used as a per-frame workaround here.
- The existing world and live drawing effects use GameKit's vector context on the same WebGL1 context. The vector path and SVG mesh queues are flushed at their painter boundary to preserve source draw order.
- SVG `opacity`, fill opacity, and stroke opacity are compiled into per-vertex alpha. No raster textures are introduced by the migrated assets.
- The runtime device tracks context loss/restoration and owns the white vector texture and GPU buffers. The renderer also skips a boundary frame if WebGL queries go unavailable just before the browser's loss event, then reuses retained meshes after restoration. The asset cache is disposed on final page hide, while bfcache suspend/resume keeps it intact. Resize continues through the existing renderer boundary.

## Benchmark

See [the fixed-scene benchmark](svg-renderer-benchmark-v0.16.0.md) for the v0.6.5/curveSegments 8 comparison, draw/upload counts, runtime interaction checks, and verification limits. The current fixed SwiftShader samples still lose roughly 16–21% observed FPS at desktop and mobile landscape; D3D11 holds the 60 FPS app target. The candidate stays unmerged until the SwiftShader regression and remaining full-suite verification are resolved.
