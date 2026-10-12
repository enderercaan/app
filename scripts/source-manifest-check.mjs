import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const manifestPath=path.join(root,'SOURCE_FILE_SHA256_MANIFEST.txt');
const ignoredDirs=new Set(['.git','node_modules','.expo','dist','build','.claude']);
const ignoredFiles=new Set(['SOURCE_FILE_SHA256_MANIFEST.txt','.claudeignore']);

function walk(dir,base=''){
  const out=[];
  for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.isDirectory()&&ignoredDirs.has(entry.name))continue;
    const rel=base?`${base}/${entry.name}`:entry.name;
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())out.push(...walk(full,rel));
    else if(entry.isFile()&&!ignoredFiles.has(rel))out.push(rel);
  }
  return out;
}

function digest(rel){return createHash('sha256').update(readFileSync(path.join(root,rel))).digest('hex')}
function render(){return walk(root).sort().map(rel=>`${digest(rel)}  ./${rel}`).join('\n')+'\n'}

const expected=render();
if(process.argv.includes('--generate')){
  writeFileSync(manifestPath,expected);
  console.log(`source-manifest: GENERATED ${expected.trimEnd().split('\n').length} files`);
}else{
  let current='';
  try{current=readFileSync(manifestPath,'utf8')}catch{throw new Error('SOURCE_FILE_SHA256_MANIFEST.txt missing')}
  if(current!==expected){
    const currentLines=new Map(current.trimEnd().split('\n').filter(Boolean).map(line=>{const i=line.indexOf('  ./');return i<0?[line,'']:[line.slice(i+2),line.slice(0,i)]}));
    const expectedLines=new Map(expected.trimEnd().split('\n').filter(Boolean).map(line=>{const i=line.indexOf('  ./');return [line.slice(i+2),line.slice(0,i)]}));
    const added=[...expectedLines.keys()].filter(k=>!currentLines.has(k));
    const removed=[...currentLines.keys()].filter(k=>!expectedLines.has(k));
    const changed=[...expectedLines.keys()].filter(k=>currentLines.has(k)&&currentLines.get(k)!==expectedLines.get(k));
    throw new Error(`SOURCE_FILE_SHA256_MANIFEST.txt stale (added=${added.length}, removed=${removed.length}, changed=${changed.length}); run npm run source-manifest:generate`);
  }
  console.log(`source-manifest: PASS ${expected.trimEnd().split('\n').length}/${expected.trimEnd().split('\n').length}`);
}
