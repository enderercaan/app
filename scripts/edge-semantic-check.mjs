import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files=globSync('supabase/functions/**/*.ts').sort();
const args=[
  '--noEmit','--strict','--skipLibCheck','--allowImportingTsExtensions','--noUnusedLocals','--noUnusedParameters',
  '--module','esnext','--moduleResolution','bundler','--target','es2022','--lib','es2022,dom',
  'scripts/edge-semantic-globals.d.ts',...files
];
const result=spawnSync('npx',['--no-install','tsc',...args],{stdio:'inherit',shell:false});
if(result.error){console.error(`edge-semantic-check: ${result.error.message}`);process.exit(1)}
if(result.status!==0)process.exit(result.status??1);
console.log(`edge-semantic-check: ${files.length} Edge/shared TypeScript files PASS`);
