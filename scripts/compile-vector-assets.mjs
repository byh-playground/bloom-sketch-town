import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileVectorAssetFile, compiledAssetModuleSource } from '../source/gamekit/0.26.2/upstream-source/modules/vector-assets/compiler.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, 'source/assets');
const curveSegments = 4;
const strokeArcDivisions = 2;
const names = (await readdir(directory)).filter(name => name.endsWith('.svg')).sort();
if (!names.length) throw new Error('No SVG source assets found in source/assets');
const assets = [];
for (const name of names) {
  const file = path.join(directory, name);
  const sourceBytes = await readFile(file);
  if (sourceBytes.includes(0x0d)) throw new Error(`${name} must use LF line endings for a stable source hash`);
  const svg = sourceBytes.toString('utf8');
  const match = svg.match(/<metadata id="vector-asset">\s*([\s\S]*?)\s*<\/metadata>/);
  if (!match) throw new Error(`${name} has no GameKit vector metadata`);
  const metadata = JSON.parse(match[1]);
  const asset = await compileVectorAssetFile(file, `source/assets/${name}`, { curveSegments, strokeArcDivisions });
  if (asset.compilerOptions?.curveSegments !== curveSegments) {
    throw new Error(`${name} did not record curveSegments=${curveSegments}`);
  }
  if (asset.compilerOptions?.strokeArcDivisions !== strokeArcDivisions) {
    throw new Error(`${name} did not record strokeArcDivisions=${strokeArcDivisions}`);
  }
  assets.push({ name: metadata.id, variable: `asset${assets.length}`, asset });
}
if (new Set(assets.map(entry => entry.name)).size !== assets.length) throw new Error('SVG metadata asset ids must be unique');
const declarations = [];
for (const entry of assets) {
  const { sourcePaths, ...runtimeAsset } = entry.asset;
  declarations.push((await compiledAssetModuleSource(runtimeAsset, entry.variable)).trim().replace(/^export\s+/, ''));
}
const registry = assets.map(entry => `${JSON.stringify(entry.name)}:${entry.variable}`).join(',');
const report = assets.map(({ name, asset }) => ({
  id: name,
  sourcePath: asset.sourcePath,
  sourceSha256: asset.sourceSha256,
  compilerVersion: asset.compilerVersion,
  compilerOptions: asset.compilerOptions,
  parts: asset.geometry.partCount,
  vertices: asset.geometry.vertices.length / asset.geometry.strideFloats,
  clips: Object.keys(asset.metadata.clips),
  expressions: Object.keys(asset.metadata.expressions),
}));
const output = [
  '// Generated from source/assets/*.svg by the pinned GameKit vector-assets compiler. Do not edit.',
  ...declarations,
  `const BLOOM_VECTOR_ASSETS=Object.freeze({${registry}});`,
  '',
].join('\n');
await writeFile(path.join(root, 'source/vector_assets.generated.js'), output, 'utf8');
console.log(JSON.stringify({ count: assets.length, assets: report, output: 'source/vector_assets.generated.js' }, null, 2));
