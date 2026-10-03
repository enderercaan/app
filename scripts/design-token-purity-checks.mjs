import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const srcRoot=path.join(root,'src');
const rawColor=/(?:#[0-9A-Fa-f]{3,8}\b|rgba?\([^\n'\"]+\))/g;
const offenders=[];

function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) walk(full);
    else if(/\.tsx$/.test(entry.name)){
      const lines=fs.readFileSync(full,'utf8').split(/\r?\n/);
      lines.forEach((line,index)=>{
        const matches=[...line.matchAll(rawColor)].map(match=>match[0]);
        if(matches.length) offenders.push(`${path.relative(root,full).replaceAll('\\','/')}:${index+1}: ${matches.join(', ')}`);
      });
    }
  }
}
walk(srcRoot);
assert.deepEqual(offenders,[],`raw UI color literals must live in src/theme.ts semantic tokens only:\n${offenders.join('\n')}`);

const theme=fs.readFileSync(path.join(srcRoot,'theme.ts'),'utf8');
for(const token of [
  'modalBackdrop','glassTint','glassSurface','mediaIndicatorInactive','mediaActionSurface','chatMediaOverlay',
  'petCardBadgeSurface','petCardScrim','swipeStampSurface','callBackground','callSurface','callBorder',
  'callTextMuted','callControlSoft','callControlOff','reelScrim','reelBackdropFaint','reelOverlaySoft',
  'reelOverlayStrong','reelControlSurface'
]) assert.match(theme,new RegExp(`\\b${token}\\s*:`),`missing semantic design token: ${token}`);

console.log('design-token-purity-checks: PASS — 0 raw TSX colors; semantic media/glass/call/modal tokens centralized');
