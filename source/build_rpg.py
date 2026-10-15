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
gk_urls={name:'data:text/javascript;base64,'+base64.b64encode((gk_root/file).read_bytes()).decode() for name,file in gk_pin['runtimeModules'].items()}
sdk='const GAMEKIT_VECTOR_URLS='+json.dumps(gk_urls)+';\nconst [gamekitRendering,gamekitVectorAssets]=await Promise.all([import(GAMEKIT_VECTOR_URLS.rendering),import(GAMEKIT_VECTOR_URLS.vectorAssets)]);\nconst {WebGLDevice,VectorContext,MeshBuilder,MeshRenderer}=gamekitRendering;\nconst {createVectorAsset}=gamekitVectorAssets;\n'+sdk
manifest_data=(root/'gamekit/manifest.json').read_bytes()
assert hashlib.sha256(manifest_data).hexdigest()=='c713809653043e8eb1d9b629c0c2734e9526217f69e04b49283d068c1b5d7da7', 'GameKit manifest hash mismatch'
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
print('built',path,'bytes',path.stat().st_size)
