import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const runtimeRoots=['App.tsx','index.js','app.config.ts','metro.config.cjs','src','plugins','modules'];
const sourceExts=new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.json']);
const files=[];
function collect(target){
  const abs=path.join(root,target);
  if(!fs.existsSync(abs))return;
  const stat=fs.statSync(abs);
  if(stat.isFile()){files.push(abs);return}
  for(const entry of fs.readdirSync(abs,{withFileTypes:true})){
    const child=path.join(abs,entry.name);
    if(entry.isDirectory())collect(path.relative(root,child));
    else if(sourceExts.has(path.extname(entry.name)))files.push(child);
  }
}
for(const target of runtimeRoots)collect(target);
const runtimeText=files.map(file=>fs.readFileSync(file,'utf8')).join('\n');

// These are required native runtime/peer dependencies even when application TS imports
// only the higher-level package. Their necessity is documented by their upstream install guides.
const infrastructureDependencies=new Map([
  ['react-native-screens','required by React Navigation native-stack'],
  ['@livekit/react-native-webrtc','required native WebRTC layer for @livekit/react-native'],
  ['react-native-nitro-modules','required Nitro runtime for Nitro-based native modules']
]);

const unexplained=[];
for(const name of Object.keys(pkg.dependencies??{})){
  if(runtimeText.includes(name)||infrastructureDependencies.has(name))continue;
  unexplained.push(name);
}
assert.deepEqual(unexplained,[],`dependencies without runtime/build evidence: ${unexplained.join(', ')}`);

const forbiddenSpecs=[];
for(const [name,spec] of Object.entries({...pkg.dependencies,...pkg.devDependencies})){
  if(typeof spec!=='string'||!spec.trim()||spec==='*'||/^latest$/i.test(spec)||/^(?:git\+|https?:|file:|link:)/i.test(spec))forbiddenSpecs.push(`${name}@${spec}`);
}
assert.deepEqual(forbiddenSpecs,[],`non-production dependency specs found: ${forbiddenSpecs.join(', ')}`);

const expectedDevDependencies=new Set(['@types/react','typescript']);
const unexplainedDev=Object.keys(pkg.devDependencies??{}).filter(name=>!expectedDevDependencies.has(name));
assert.deepEqual(unexplainedDev,[],`unexpected devDependencies require justification: ${unexplainedDev.join(', ')}`);

console.log(`dependency-purity-checks: ${Object.keys(pkg.dependencies??{}).length} production dependencies accounted for; ${infrastructureDependencies.size} documented native infrastructure dependencies retained; PASS`);
