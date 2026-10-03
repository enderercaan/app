import { readdirSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

async function loadTypeScript(){
  try{return await import('typescript')}catch(error){void error}
  const finder=process.platform==='win32'?'where':'which';
  const found=spawnSync(finder,['tsc'],{encoding:'utf8'});
  const first=String(found.stdout||'').split(/\r?\n/).map(x=>x.trim()).find(Boolean);
  if(!first)throw new Error('typescript_compiler_unavailable');
  const tscPath=realpathSync(first);
  const modulePath=resolve(dirname(tscPath),'../lib/typescript.js');
  return await import(pathToFileURL(modulePath).href);
}

function walk(dir,out=[]){
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory())walk(path,out);
    else if(/\.(ts|tsx)$/.test(entry.name))out.push(path);
  }
  return out;
}

const tsModule=await loadTypeScript();
const ts=tsModule.default??tsModule;
const roots=['App.tsx','app.config.ts',...walk('src')];
const options={
  noEmit:true,
  skipLibCheck:true,
  strict:true,
  noUncheckedIndexedAccess:true,
  noFallthroughCasesInSwitch:true,
  noImplicitReturns:true,
  noUnusedLocals:true,
  noUnusedParameters:true,
  exactOptionalPropertyTypes:false,
  target:ts.ScriptTarget.ES2022,
  module:ts.ModuleKind.ESNext,
  moduleResolution:ts.ModuleResolutionKind.Bundler,
  jsx:ts.JsxEmit.ReactJSX,
  allowSyntheticDefaultImports:true,
  baseUrl:'.'
};
const program=ts.createProgram(roots,options);
// These diagnostics remain meaningful even when third-party package declarations are absent.
// Module-resolution/JSX/implicit-any noise is deliberately excluded; full dependency-resolved
// `npm run typecheck` remains a separate release boundary when the genuine lockfile is available.
const highSignalCodes=new Set([
  2304, // Cannot find name
  2552, // Cannot find name, did you mean
  2448, // block-scoped variable used before declaration
  2454, // variable used before assignment
  2451, // cannot redeclare block-scoped variable
  2456, // circular type alias
  2554, // wrong argument count
  2345, // incompatible argument
  2538, // invalid/undefined index
  18048,// possibly undefined
  2783, // duplicate property overwritten by spread
  2349, // expression not callable
  2722, // possibly undefined invocation
  6133, // declared but value is never read
  6192, // all imports in declaration are unused
  6196, // declared type is never used
  6198  // all destructured elements are unused
]);
const diagnostics=ts.getPreEmitDiagnostics(program).filter(d=>highSignalCodes.has(d.code)).filter(d=>{
  if(d.code!==2304||!d.file||d.start==null)return true;
  // React Native injects __DEV__ at build time; package declarations are intentionally absent offline.
  return d.file.text.slice(d.start,d.start+(d.length??0))!=='__DEV__';
});
if(diagnostics.length){
  for(const d of diagnostics){
    const file=d.file?relative(process.cwd(),d.file.fileName):'<global>';
    const pos=d.file&&d.start!=null?d.file.getLineAndCharacterOfPosition(d.start):null;
    const where=pos?`${file}:${pos.line+1}:${pos.character+1}`:file;
    console.error(`${d.code} ${where} ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`);
  }
  process.exit(1);
}
console.log(`source-semantic-local-check: ${roots.length} TypeScript source files; high-signal local semantic diagnostics 0; PASS`);
