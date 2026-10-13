from pathlib import Path
root=Path(__file__).resolve().parent
cnn=(root/'cnn_weights.json').read_text(encoding='utf-8')
refs=(root/'glyph_references.json').read_text(encoding='utf-8')
modules=['renderer','input','dom','audio','simloop','interpolation']
sdk='\n'.join('/* bloom-gamekit · '+name+' · vendored module runtime (source origin: byh-playground/bloom-gamekit) */\n'+(root/f'gamekit_{name}.js').read_text(encoding='utf-8') for name in modules)+'\n'
parts=''.join((root/f'game_part{i}.js').read_text(encoding='utf-8') for i in range(1,7))
out=(root/'layout.html').read_text(encoding='utf-8').replace('__CNN_DATA__',cnn).replace('__GLYPH_REFS__',refs).replace('__GAME_JS__',sdk+parts)
path=root.parent/'index.html'
path.write_text(out,encoding='utf-8',newline='')
(root/'standalone.js').write_text(sdk+parts,encoding='utf-8',newline='')
print('built',path,'bytes',path.stat().st_size)
