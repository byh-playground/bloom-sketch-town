from pathlib import Path
import base64, hashlib, json, subprocess
root=Path(__file__).resolve().parent
subprocess.run(['node', str(root.parent/'scripts'/'compile-vector-assets.mjs')], check=True)
cnn=(root/'cnn_weights.json').read_text(encoding='utf-8')
refs=(root/'glyph_references.json').read_text(encoding='utf-8')
modules=['renderer','input','dom','audio']
sdk='\n'.join('/* bloom-gamekit · '+name+' · vendored module runtime (source origin: byh-playground/bloom-gamekit) */\n'+(root/f'gamekit_{name}.js').read_text(encoding='utf-8') for name in modules)+'\n'
gk_root=root/'gamekit'/'0.6.5'
gk_pin=json.loads((gk_root/'provenance.json').read_text(encoding='utf-8'))
assert gk_pin['version']=='0.6.5', 'Unexpected pinned GameKit vector renderer version'
dist_manifest=(gk_root/'manifest.json').read_bytes()
assert hashlib.sha256(dist_manifest).hexdigest()==gk_pin['manifestSha256'], 'GameKit 0.6.5 dist manifest hash mismatch'
dist=json.loads(dist_manifest)
for rel,expected in gk_pin['sha256'].items():
 data=(gk_root/rel).read_bytes()
 assert hashlib.sha256(data).hexdigest()==expected, 'Pinned GameKit 0.6.5 checksum mismatch: '+rel
 if rel in gk_pin['runtimeModules'].values():
  manifest_hash=next((module['sha256'] for module in dist['modules'] if module['file']==rel),None)
  assert manifest_hash==expected, 'GameKit 0.6.5 manifest module checksum mismatch: '+rel
renderer_root=root/'gamekit'/'0.15.1'
renderer_pin=json.loads((renderer_root/'provenance.json').read_text(encoding='utf-8'))
assert renderer_pin['version']=='0.15.1', 'Unexpected pinned GameKit renderer version'
renderer_manifest_data=(renderer_root/renderer_pin['manifest']).read_bytes()
assert hashlib.sha256(renderer_manifest_data).hexdigest()==renderer_pin['manifestSha256'], 'GameKit 0.15.1 dist manifest hash mismatch'
renderer_manifest=json.loads(renderer_manifest_data)
renderer_file=renderer_root/renderer_pin['runtimeModule']
renderer_data=renderer_file.read_bytes()
assert hashlib.sha256(renderer_data).hexdigest()==renderer_pin['sha256'], 'GameKit 0.15.1 rendering.js checksum mismatch'
renderer_dist_hash=next((module['sha256'] for module in renderer_manifest['modules'] if module['file']==renderer_pin['runtimeModule']),None)
assert renderer_dist_hash==renderer_pin['sha256'], 'GameKit 0.15.1 manifest rendering.js checksum mismatch'
vector_assets_file=gk_root/gk_pin['runtimeModules']['vectorAssets']
gk_urls={
 'rendering':'data:text/javascript;base64,'+base64.b64encode(renderer_data).decode(),
 'vectorAssets':'data:text/javascript;base64,'+base64.b64encode(vector_assets_file.read_bytes()).decode()
}
sdk='const GAMEKIT_VECTOR_URLS='+json.dumps(gk_urls)+';\nconst [gamekitRendering,gamekitVectorAssets]=await Promise.all([import(GAMEKIT_VECTOR_URLS.rendering),import(GAMEKIT_VECTOR_URLS.vectorAssets)]);\nconst {WebGLDevice,VectorContext,MeshBuilder,MeshRenderer}=gamekitRendering;\nconst {createVectorAsset}=gamekitVectorAssets;\n'+sdk
manifest_data=(root/'gamekit/manifest.json').read_bytes()
assert hashlib.sha256(manifest_data).hexdigest()=='20244c2beeee33719f407a9baa92c55a4bd55a0e4eb9f094590bb0eed652296e', 'GameKit manifest hash mismatch'
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
print('built',path,'bytes',path.stat().st_size,'renderer GameKit 0.15.1','vector-assets/compiler GameKit 0.6.5')
