from pathlib import Path
import base64, hashlib, json, subprocess
root=Path(__file__).resolve().parent
subprocess.run(['node', str(root.parent/'scripts'/'compile-vector-assets.mjs')], check=True)
cnn=(root/'cnn_weights.json').read_text(encoding='utf-8')
refs=(root/'glyph_references.json').read_text(encoding='utf-8')
modules=['renderer','input','dom','audio']
sdk='\n'.join('/* bloom-gamekit · '+name+' · vendored module runtime (source origin: byh-playground/bloom-gamekit) */\n'+(root/f'gamekit_{name}.js').read_text(encoding='utf-8') for name in modules)+'\n'
gk_root=root/'gamekit'/'0.26.6'
gk_pin=json.loads((gk_root/'provenance.json').read_text(encoding='utf-8'))
assert gk_pin['version']=='0.26.6', 'Unexpected pinned GameKit rendering version'
dist_manifest=(gk_root/gk_pin['manifest']).read_bytes()
assert hashlib.sha256(dist_manifest).hexdigest()==gk_pin['manifestSha256'], 'GameKit 0.26.6 dist manifest hash mismatch'
dist=json.loads(dist_manifest)
for rel,expected in gk_pin['sha256'].items():
 data=(gk_root/rel).read_bytes()
 assert hashlib.sha256(data).hexdigest()==expected, 'Pinned GameKit 0.26.6 checksum mismatch: '+rel
 if rel in gk_pin['runtimeModules'].values():
  manifest_hash=next((module['sha256'] for module in dist['modules'] if module['file']==rel),None)
  assert manifest_hash==expected, 'GameKit 0.26.6 manifest module checksum mismatch: '+rel
renderer_data=(gk_root/gk_pin['runtimeModules']['rendering']).read_bytes()
vector_assets_file=gk_root/gk_pin['runtimeModules']['vectorAssets']
gk_urls={
 'rendering':'data:text/javascript;base64,'+base64.b64encode(renderer_data).decode(),
 'vectorAssets':'data:text/javascript;base64,'+base64.b64encode(vector_assets_file.read_bytes()).decode()
}
sdk='const GAMEKIT_VECTOR_URLS='+json.dumps(gk_urls)+';\nconst [gamekitRendering,gamekitVectorAssets]=await Promise.all([import(GAMEKIT_VECTOR_URLS.rendering),import(GAMEKIT_VECTOR_URLS.vectorAssets)]);\nconst {WebGLDevice,VectorContext,MeshBuilder}=gamekitRendering;\nconst {createVectorActor}=gamekitVectorAssets;\n'+sdk
manifest_data=(root/'gamekit/manifest.json').read_bytes()
assert hashlib.sha256(manifest_data).hexdigest()=='55bf76979aa99bbe377ae810ec76e9f02902f307eb48edac1b50985718efc3e7', 'GameKit manifest hash mismatch'
manifest=json.loads(manifest_data)
urls={}
for name in ['simloop','interpolation','rollback','transport']:
 data=(root/f'gamekit/{name}.js').read_bytes()
 expected=next(m['sha256'] for m in manifest['modules'] if m['file']==name+'.js')
 assert hashlib.sha256(data).hexdigest()==expected, name+' bundle hash mismatch'
 urls[name]='data:text/javascript;base64,'+base64.b64encode(data).decode()
sdk='const GAMEKIT_URLS='+json.dumps(urls)+';\nconst [gamekitSimloop,gamekitInterpolation]=await Promise.all([import(GAMEKIT_URLS.simloop),import(GAMEKIT_URLS.interpolation)]);\nconst {createLoop,createDeadlineScheduler}=gamekitSimloop;\nconst {InterpolationTimeline}=gamekitInterpolation;\n'+sdk
parts=''.join((root/name).read_text(encoding='utf-8') for name in ['game_part1.js','progression.js','region-map.js','game_part2.js','game_part3.js','progression-ui.js','game_part4.js','game_part5.js','game_part6.js'])
parts=(root/'vector_assets.generated.js').read_text(encoding='utf-8')+'\n'+parts
out=(root/'layout.html').read_text(encoding='utf-8').replace('__CNN_DATA__',cnn).replace('__GLYPH_REFS__',refs).replace('__GAME_JS__',sdk+parts)
path=root.parent/'index.html'
path.write_text(out,encoding='utf-8',newline='')
(root/'standalone.js').write_text(sdk+parts,encoding='utf-8',newline='')
print('built',path,'bytes',path.stat().st_size,'rendering/vector-assets/compiler GameKit 0.26.6')
