from pathlib import Path
import base64, hashlib, json
root=Path(__file__).resolve().parent
cnn=(root/'cnn_weights.json').read_text(encoding='utf-8')
refs=(root/'glyph_references.json').read_text(encoding='utf-8')
modules=['renderer','input','dom','audio']
sdk='\n'.join('/* bloom-gamekit · '+name+' · vendored module runtime (source origin: byh-playground/bloom-gamekit) */\n'+(root/f'gamekit_{name}.js').read_text(encoding='utf-8') for name in modules)+'\n'
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
out=(root/'layout.html').read_text(encoding='utf-8').replace('__CNN_DATA__',cnn).replace('__GLYPH_REFS__',refs).replace('__GAME_JS__',sdk+parts)
path=root.parent/'index.html'
path.write_text(out,encoding='utf-8',newline='')
(root/'standalone.js').write_text(sdk+parts,encoding='utf-8',newline='')
print('built',path,'bytes',path.stat().st_size)
