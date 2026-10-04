import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

const root=process.cwd();
function scriptFilesSafe(base){const dir=path.join(base,'scripts');if(!fs.existsSync(dir))return[];return fs.readdirSync(dir,{withFileTypes:true}).filter(entry=>entry.isFile()&&/\.(?:mjs|js|cjs)$/.test(entry.name)).map(entry=>path.join(dir,entry.name));}

const bannedExact=[
  'AUDIT_PROGRESS.md',
  'TAILMANCE_R8_CURRENT_EXACT_HANDOFF_2026-09-29.md',
  'TAILMANCE_R8_CONTINUATION_HANDOFF_2026-09-29.md',
  'V15_CHANGE_MANIFEST.md','V16_CHANGE_MANIFEST.md','V17_CHANGE_MANIFEST.md','V18_CHANGE_MANIFEST.md','V19_CHANGE_MANIFEST.md',
  'src/components/Badge.tsx','src/services/measurementPreference.ts',
  'scripts/apply-locale-patch.mjs','scripts/apply-locale-patch.py','scripts/extract-legal-source-pack.mjs',
  'scripts/legal-locale-from-en-array.mjs','scripts/legal-locale-from-string-map.mjs','scripts/legal-source-from-en-array.mjs','scripts/legal-source-to-locale.mjs',
  'docs/ASEMA2_AUDIT_REPORT.md','docs/ASEMA3_CHANGE_MANIFEST.md','docs/ASEMA4_SELF_AUDIT.md','docs/ASEMA5_DEVICE_RELEASE_CHECKLIST.md','docs/ASEMA5_V14_RELEASE_STATUS.md',
  'docs/PUBLIC_LEGAL_COPY_RELEASE_BOUNDARY_R7.md','docs/TUR2_CONTINUATION_AUDIT_2026-09-24.md','docs/V13_CHANGE_MANIFEST.md','docs/V14_CHANGE_MANIFEST.md','docs/V14_SELF_AUDIT.md',
  'docs/V19_LEGAL_FINAL_HARDENING_R5_2026-09-29.md','docs/V19_LEGAL_FINAL_HARDENING_R7_2026-09-29.md','docs/V19_LEGAL_LANGUAGE_FINAL_HARDENING_R8_2026-09-29.md',
  'docs/V19_LEGAL_LOCALIZATION_R8_DELIVERY_2026-09-29.md','docs/V19_LEGAL_LOCALIZATION_R8_FINAL_2026-09-29.md','docs/V19_LEGAL_REAUDIT_FINAL_2026-09-29.md',
  'docs/SECURITY_PRIVACY_HARDENING_2026.md',
  'web/legal-locales/translations','web/legal-source/translations'
];
for(const rel of bannedExact) assert.ok(!fs.existsSync(path.join(root,rel)),`superseded/orphan file reintroduced: ${rel}`);

const rootNames=fs.readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>entry.name);
const supersededRootArtifactPatterns=[
  /^TAILMANCE_R8_.*HANDOFF_2026-09-30\.md$/,
  /^Tailmance-v19-R8-.*VERIFICATION-2026-09-30\.txt$/
];
for(const name of rootNames)for(const pattern of supersededRootArtifactPatterns)assert.ok(!pattern.test(name),`superseded root audit artifact reintroduced: ${name}`);

const bannedDirs=new Set(['node_modules','.expo','dist','coverage','__pycache__','.pytest_cache','.mypy_cache','.cache']);
const bannedNames=new Set(['.DS_Store']);
const bannedSuffixes=['.pyc','.pyo','.log','.tmp','.bak','.swp','~'];
const problems=[];
function walk(dir){
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    if(ent.name==='.git')continue;
    const full=path.join(dir,ent.name); const rel=path.relative(root,full).replaceAll('\\','/');
    if(ent.isDirectory()){
      if(bannedDirs.has(ent.name))problems.push(rel+'/'); else walk(full);
    }else if(bannedNames.has(ent.name)||bannedSuffixes.some(s=>ent.name.endsWith(s))) problems.push(rel);
  }
}
walk(root);
assert.deepEqual(problems,[],`repository hygiene artifacts found: ${problems.join(', ')}`);

// Runtime source must not carry silent empty catches, TODO/FIXME debt markers, or explicit implementation stubs.
const runtimeQualityRoots=['src','supabase/functions','plugins','modules'];
const runtimeQualityProblems=[];
const emptyCatchRe=/catch\s*\{\s*\}/g;
const debtMarkerRe=/(?:\/\/|\/\*)\s*(?:TODO|FIXME|HACK|XXX)\b/gi;
const notImplementedRe=/(?:not[_ -]?implemented|implementation[_ -]?pending)/gi;
for(const rel of runtimeQualityRoots){
  const abs=path.join(root,rel);
  if(!fs.existsSync(abs))continue;
  const scan=(target)=>{for(const ent of fs.readdirSync(target,{withFileTypes:true})){
    const full=path.join(target,ent.name);
    if(ent.isDirectory())scan(full);
    else if(['.ts','.tsx','.js','.jsx','.mjs','.cjs'].includes(path.extname(ent.name))){
      const text=fs.readFileSync(full,'utf8');
      const file=path.relative(root,full).replaceAll('\\','/');
      if(emptyCatchRe.test(text))runtimeQualityProblems.push(`${file}:empty-catch`); emptyCatchRe.lastIndex=0;
      if(debtMarkerRe.test(text))runtimeQualityProblems.push(`${file}:debt-marker`); debtMarkerRe.lastIndex=0;
      if(notImplementedRe.test(text))runtimeQualityProblems.push(`${file}:implementation-stub`); notImplementedRe.lastIndex=0;
    }
  }};
  const stat=fs.statSync(abs);
  if(stat.isDirectory())scan(abs);
  else {
    const text=fs.readFileSync(abs,'utf8');
    if(emptyCatchRe.test(text))runtimeQualityProblems.push(`${rel}:empty-catch`); emptyCatchRe.lastIndex=0;
    if(debtMarkerRe.test(text))runtimeQualityProblems.push(`${rel}:debt-marker`); debtMarkerRe.lastIndex=0;
    if(notImplementedRe.test(text))runtimeQualityProblems.push(`${rel}:implementation-stub`); notImplementedRe.lastIndex=0;
  }
}
assert.deepEqual(runtimeQualityProblems,[],`runtime quality debt found: ${runtimeQualityProblems.join(', ')}`);

// Reachability: every app source module must be reachable from App.tsx or index.js through relative imports.
const sourceExts=new Set(['.ts','.tsx','.js','.jsx']);
const sourceFiles=[];
function collectSource(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,ent.name);if(ent.isDirectory())collectSource(full);else if(sourceExts.has(path.extname(ent.name)))sourceFiles.push(path.resolve(full));}}
collectSource(path.join(root,'src'));
const entries=[path.resolve(root,'App.tsx'),path.resolve(root,'index.js')];
const allFiles=new Set([...sourceFiles,...entries]);
const importRe=/(?:import\s+(?:[^'\"]+?\s+from\s+)?|export\s+[^'\"]*?from\s+|require\s*\(|import\s*\()\s*['\"]([^'\"]+)['\"]/g;
function resolveRelative(base,spec){
  if(!spec.startsWith('.'))return [];
  const p=path.resolve(path.dirname(base),spec);
  if(path.extname(p))return allFiles.has(p)?[p]:[];
  const platformSuffixes=['.native','.ios','.android','.web',''];
  const candidates=[];
  for(const suffix of platformSuffixes)for(const ext of ['.ts','.tsx','.js','.jsx'])candidates.push(p+suffix+ext);
  for(const suffix of platformSuffixes)for(const ext of ['.ts','.tsx','.js','.jsx'])candidates.push(path.join(p,'index'+suffix+ext));
  return [...new Set(candidates.filter(c=>allFiles.has(c)))];
}
const graph=new Map([...allFiles].map(f=>[f,new Set()]));
for(const file of allFiles){const text=fs.readFileSync(file,'utf8');for(const m of text.matchAll(importRe)){for(const target of resolveRelative(file,m[1]))graph.get(file).add(target);}}
const reachable=new Set(); const stack=[...entries];
while(stack.length){const f=stack.pop();if(reachable.has(f)||!graph.has(f))continue;reachable.add(f);for(const t of graph.get(f))stack.push(t);}
const unreachable=sourceFiles.filter(f=>!reachable.has(f)).map(f=>path.relative(root,f).replaceAll('\\','/')).sort();
assert.deepEqual(unreachable,[],`unreachable src modules found: ${unreachable.join(', ')}`);

// Internal API purity: exported api.ts functions must be referenced by app/runtime/test source.
const apiModule=path.join(root,'src/services/api.ts');
const apiText=fs.readFileSync(apiModule,'utf8');
const apiExportNames=[...apiText.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(match=>match[1]);
const apiConsumers=[path.join(root,'App.tsx'),...sourceFiles.filter(file=>file!==apiModule),...scriptFilesSafe(root)];
const apiConsumerText=apiConsumers.filter(file=>fs.existsSync(file)).map(file=>fs.readFileSync(file,'utf8')).join('\n');
const deadApiExports=apiExportNames.filter(name=>!new RegExp(`\\b${name}\\b`).test(apiConsumerText));
assert.deepEqual(deadApiExports,[],`dead src/services/api.ts exports found: ${deadApiExports.join(', ')}`);

// Maintenance scripts must be invoked by package.json or another maintained script; no abandoned helpers.
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));

// Dependency determinism: every non-relative package imported directly by app/config-plugin/local-module code
// must be declared directly. Do not rely on npm hoisting of Expo's transitive dependencies.
const declaredPackages=new Set([
  ...Object.keys(pkg.dependencies??{}),
  ...Object.keys(pkg.devDependencies??{}),
  ...Object.keys(pkg.peerDependencies??{})
]);
const nodeBuiltins=new Set([...builtinModules,...builtinModules.map(x=>`node:${x}`)]);
const dependencyRoots=['App.tsx','index.js','app.config.ts','src','plugins','modules'];
const dependencySourceFiles=[];
for(const rel of dependencyRoots){
  const abs=path.join(root,rel);
  if(!fs.existsSync(abs))continue;
  const stat=fs.statSync(abs);
  if(stat.isFile())dependencySourceFiles.push(abs);
  else {
    const walkDeps=(dir)=>{for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
      const full=path.join(dir,ent.name);
      if(ent.isDirectory())walkDeps(full);
      else if(['.ts','.tsx','.js','.jsx','.mjs','.cjs'].includes(path.extname(ent.name)))dependencySourceFiles.push(full);
    }};
    walkDeps(abs);
  }
}
const externalImportRe=/(?:import\s+(?:[^'\"]+?\s+from\s+)?|export\s+[^'\"]*?from\s+|require\s*\(|import\s*\()\s*['\"]([^'\"]+)['\"]/g;
const missingDirectDependencies=new Map();
for(const file of dependencySourceFiles){
  const text=fs.readFileSync(file,'utf8');
  for(const match of text.matchAll(externalImportRe)){
    const spec=match[1];
    if(spec.startsWith('.')||spec.startsWith('/')||spec.startsWith('#')||nodeBuiltins.has(spec)||spec.startsWith('node:'))continue;
    const packageName=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];
    if(declaredPackages.has(packageName))continue;
    if(!missingDirectDependencies.has(packageName))missingDirectDependencies.set(packageName,new Set());
    missingDirectDependencies.get(packageName).add(path.relative(root,file).replaceAll('\\','/'));
  }
}
assert.equal(missingDirectDependencies.size,0,`direct imports missing package.json declarations: ${[...missingDirectDependencies].map(([name,files])=>`${name} (${[...files].join(', ')})`).join('; ')}`);

// Import purity: a module should be imported at most once per source file.
const duplicateImports=[];
const importDeclarationRe=/^\s*import\s+(?:type\s+)?(?:[^;]+?\s+from\s+)?['"]([^'"]+)['"]\s*;?/gm;
for(const file of dependencySourceFiles){
  const text=fs.readFileSync(file,'utf8');
  const counts=new Map();
  for(const match of text.matchAll(importDeclarationRe)){const spec=match[1];counts.set(spec,(counts.get(spec)??0)+1);}
  for(const [spec,count] of counts)if(count>1)duplicateImports.push(`${path.relative(root,file).replaceAll('\\','/')}:${spec} x${count}`);
}
assert.deepEqual(duplicateImports,[],`duplicate import declarations found: ${duplicateImports.join(', ')}`);
const packageCommands=Object.values(pkg.scripts??{}).join('\n');
const scriptsDir=path.join(root,'scripts');
const scriptFiles=fs.readdirSync(scriptsDir,{withFileTypes:true}).filter(x=>x.isFile()).map(x=>path.join(scriptsDir,x.name));
const scriptRoots=scriptFiles.filter(file=>{const rel=path.relative(root,file).replaceAll('\\','/');return packageCommands.includes(rel)||packageCommands.includes(path.basename(file));});
const scriptGraph=new Map(scriptFiles.map(file=>[file,new Set()]));
for(const file of scriptFiles){
  const text=fs.readFileSync(file,'utf8');
  for(const candidate of scriptFiles){
    if(candidate===file)continue;
    const rel=path.relative(root,candidate).replaceAll('\\','/');
    if(text.includes(rel)||text.includes(path.basename(candidate)))scriptGraph.get(file).add(candidate);
  }
}
const reachableScripts=new Set();
const scriptStack=[...scriptRoots];
while(scriptStack.length){const file=scriptStack.pop();if(reachableScripts.has(file))continue;reachableScripts.add(file);for(const next of scriptGraph.get(file)??[])scriptStack.push(next);}
const unreachableScripts=scriptFiles.filter(file=>!reachableScripts.has(file)).map(file=>path.relative(root,file).replaceAll('\\','/')).sort();
assert.deepEqual(unreachableScripts,[],`maintenance scripts unreachable from package.json commands: ${unreachableScripts.join(', ')}`);

console.log(`repository-hygiene-checks: clean tree; ${sourceFiles.length}/${sourceFiles.length} app source modules reachable; ${reachableScripts.size}/${scriptFiles.length} maintenance scripts command-reachable`);
