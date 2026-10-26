// Source-first startup: load immutable GameKit ESM and existing authored scripts; no bundling.
const SOURCES = [
  'source/gamekit_renderer.js',
  'source/gamekit_input.js',
  'source/gamekit_dom.js',
  'source/gamekit_audio.js',
  'source/vector-assets-compiled.js',
  'source/game_part1.js',
  'source/map-generator.js',
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
async function boot() {
  const [rendering, vectorAssets, simloop, interpolation] = await Promise.all([
    import('./gamekit/0.15.1/rendering.js'),
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
  for (const path of SOURCES) await loadOriginalScript(path);
}
boot().catch(error => {
  console.error(error);
  const output = document.getElementById('error');
  if (output) {
    output.style.display = 'block';
    output.textContent = '게임 초기화 오류: ' + (error.message || String(error));
  }
});
