import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const functionsRoot = join(root, 'supabase', 'functions');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (stat.isFile() && path.endsWith('.ts')) out.push(path);
  }
  return out;
}

const files = walk(functionsRoot);
if (files.length === 0) {
  console.error('edge-syntax-check: no Edge Function TypeScript files found');
  process.exit(1);
}

const args = [
  '--noEmit',
  '--noCheck',
  '--allowImportingTsExtensions',
  '--module', 'esnext',
  '--moduleResolution', 'bundler',
  '--target', 'es2022',
  ...files,
];
const result = spawnSync('tsc', args, { cwd: root, stdio: 'inherit' });
if (result.error) {
  console.error(`edge-syntax-check: failed to start tsc: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`edge-syntax-check: ${files.length} Edge/shared TypeScript files PASS`);
