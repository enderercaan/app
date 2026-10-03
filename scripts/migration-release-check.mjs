import { existsSync, readFileSync, readdirSync } from 'node:fs';

const migrationDir='supabase/migrations';
const minimumHead=24;
const issues=[];
let highest=0;
if(!existsSync(migrationDir)){
  issues.push('supabase/migrations is missing');
}else{
  const files=readdirSync(migrationDir).filter(name=>name.endsWith('.sql')).sort();
  const byNumber=new Map();
  for(const name of files){
    const match=/^(\d{3})_/.exec(name);
    if(!match){issues.push(`Migration filename is not canonical NNN_name.sql: ${name}`);continue;}
    const number=Number(match[1]);
    highest=Math.max(highest,number);
    const existing=byNumber.get(number)??[];
    existing.push(name); byNumber.set(number,existing);
  }
  if(highest<minimumHead)issues.push(`Canonical migration head ${String(highest).padStart(3,'0')} is below required ${String(minimumHead).padStart(3,'0')}`);
  for(let number=1;number<=highest;number++){
    const matches=byNumber.get(number)??[];
    if(matches.length===0)issues.push(`Missing canonical migration ${String(number).padStart(3,'0')}`);
    if(matches.length>1)issues.push(`Duplicate canonical migration ${String(number).padStart(3,'0')}: ${matches.join(', ')}`);
  }
}

const pendingPath='supabase/patches/PENDING_CANONICAL_SECURITY_HARDENING.sql';
if(existsSync(pendingPath)){
  const executable=readFileSync(pendingPath,'utf8')
    .replace(/\/\*[\s\S]*?\*\//g,'')
    .replace(/^\s*--.*$/gm,'')
    .trim();
  if(executable)issues.push('Pending canonical security hardening SQL still contains executable statements and must be rebased into the canonical migration chain');
}

if(issues.length){
  console.error(`migration-release-check: BLOCKED (${issues.length} issue${issues.length===1?'':'s'})`);
  for(const issue of issues)console.error(`- ${issue}`);
  process.exit(1);
}
console.log(`migration-release-check: canonical migrations 001-${String(highest).padStart(3,'0')} contiguous; no pending executable SQL`);
