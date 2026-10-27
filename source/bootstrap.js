// Source-first startup: load immutable GameKit ESM and existing authored scripts; no bundling.
const SOURCES = [
  'source/gamekit_renderer.js',
  'source/gamekit_input.js',
  'source/gamekit_dom.js',
  'source/gamekit_audio.js',
  'source/vector-assets-compiled.js',
  'source/face-model.js',
  'source/expressions.js',
  'source/summons.js',
  'source/face-recognizer.js',
  'source/seeded-random.js',
  'source/world-map.js',
  'source/game_part1.js',
  'source/bosses.js',
  'source/progression.js',
  'source/region-map.js',
  'source/game_part2.js',
  'source/game_part3.js',
  'source/progression-ui.js',
  'source/game_part4.js',
  'source/game_part5.js',
  'source/game_part6.js',
];
async function loadOriginalScript(path) {
  const url = new URL(path, document.baseURI).href;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error('소스 스크립트 로딩 실패: ' + path));
    document.body.append(script);
  });
}
// Startup progress: the loading overlay (#boot) is driven by this file's SOURCES list; boot steps before it count as 0..STEP_BEFORE_SOURCES.
const BOOT_LABEL = Object.freeze({ 'source/game_part2.js': '맵 만드는 중…' });
const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
function bootProgress(done, total, label) {
  const fill = document.getElementById('bootFill'), text = document.getElementById('bootText');
  if (fill) fill.style.width = Math.round(done / total * 100) + '%';
  if (text && label) text.textContent = label;
}
async function boot() {
  const [rendering, vectorAssets, simloop, interpolation] = await Promise.all([
    import('./gamekit/0.19.5/rendering.js'),
    import('./gamekit/0.6.5/vector-assets.js'),
    import('./gamekit/simloop.js'),
    import('./gamekit/interpolation.js'),
  ]);
  for (const [name, value] of Object.entries({
    WebGLDevice: rendering.WebGLDevice,
    VectorContext: rendering.VectorContext,
    MeshBuilder: rendering.MeshBuilder,
    MeshRenderer: rendering.MeshRenderer,
    createVectorAsset: vectorAssets.createVectorAsset,
    createLoop: simloop.createLoop,
    createDeadlineScheduler: simloop.createDeadlineScheduler,
    InterpolationTimeline: interpolation.InterpolationTimeline,
    gamekitRendering: rendering,
    gamekitVectorAssets: vectorAssets,
    gamekitSimloop: simloop,
    gamekitInterpolation: interpolation,
  })) {
    if (value == null) throw new Error('GameKit API가 없습니다: ' + name);
    globalThis[name] = value;
  }
  globalThis.GAMEKIT_URLS = Object.freeze(Object.fromEntries(
    ['simloop','interpolation','rollback','transport'].map(name => [
      name, new URL('./gamekit/' + name + '.js', import.meta.url).href
    ])
  ));
  const [cnn, glyphs] = await Promise.all(
    ['cnn_weights.json','glyph_references.json'].map(async name => {
      const response = await fetch(new URL('./' + name, import.meta.url));
      if (!response.ok) throw new Error(name + ' 불러오기 실패: ' + response.status);
      return response.text();
    })
  );
  document.getElementById('sketchCNN').textContent = cnn;
  document.getElementById('glyphReferences').textContent = glyphs;
  const total = SOURCES.length + 1;
  bootProgress(1, total, '게임 불러오는 중…');
  for (let i = 0; i < SOURCES.length; i++) {
    const path = SOURCES[i];
    if (BOOT_LABEL[path]) { bootProgress(i + 1, total, BOOT_LABEL[path]); await nextPaint(); }
    await loadOriginalScript(path);
    bootProgress(i + 2, total);
  }
  await nextPaint();
  document.getElementById('boot')?.classList.add('done');
}
boot().catch(error => {
  console.error(error);
  document.getElementById('boot')?.classList.add('done');
  const output = document.getElementById('error');
  if (output) {
    output.style.display = 'block';
    output.textContent = '게임 초기화 오류: ' + (error.message || String(error));
  }
});
