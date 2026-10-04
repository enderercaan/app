import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';

// Regression guard for Kotlin compile errors found by the first real Android release build:
//  - suspend helpers (awaitResult) may only be called from `AsyncFunction(...) Coroutine { }` bodies
//  - an AsyncFunction lambda must never be a bare `throw` (reified type becomes Nothing)
const files=globSync('modules/*/android/src/main/**/*.kt');
assert.ok(files.length>0,'expected Kotlin Expo modules under modules/');
for(const file of files){
  const source=readFileSync(file,'utf8');
  const blocks=[...source.matchAll(/AsyncFunction\("([^"]+)"\)\s*(Coroutine\s*)?\{([\s\S]*?)\n    \}/g)];
  for(const [,name,coroutine,body] of blocks){
    if(/\.awaitResult\(\)|\.await\(\)/.test(body))assert.ok(coroutine,`${file}: ${name} calls a suspend helper and must use AsyncFunction("${name}") Coroutine { }`);
    const statements=body.replace(/^[^>]*->/,'').trim();
    assert.ok(!/^throw\s/.test(statements),`${file}: ${name} must not be a bare throw (returns Nothing); route through a helper that returns a concrete type`);
    assert.ok(!(coroutine&&/return@AsyncFunction/.test(body)),`${file}: ${name} is a Coroutine body and must use return@Coroutine`);
  }
}
console.log(`android-native-module-checks: ${files.length} Kotlin Expo module file(s) checked for suspend/Nothing compile hazards; PASS`);
