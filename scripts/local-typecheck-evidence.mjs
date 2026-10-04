import {createHash} from 'node:crypto';
import {existsSync, globSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';

const recordPath='release/local-typecheck-evidence.json';
const logPath='release/local-validation/typecheck.txt';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function inputHashes(){
  const inputs=[...new Set([
    'App.tsx','app.config.ts','brand.ts','brand.json','tsconfig.json','package.json','package-lock.json',
    ...globSync('src/**/*.{ts,tsx,json}'),...globSync('modules/**/*.{ts,tsx,json}'),
    ...globSync('*.d.ts'),
  ])].sort();
  return Object.fromEntries(inputs.map(path=>[path,sha(readFileSync(path))]));
}
export function readTypecheckEvidenceStatus(){
  if(!existsSync(recordPath))return 'DOĞRULANAMADI';
  const record=JSON.parse(readFileSync(recordPath,'utf8'));
  if(record.schema_version!==1||record.command!=='npm run typecheck'||record.exit_code!==0||record.log_path!==logPath)throw new Error('local_typecheck_evidence_invalid');
  if(JSON.stringify(record.input_hashes)!==JSON.stringify(inputHashes()))throw new Error('local_typecheck_evidence_source_drift');
  if(record.log_sha256!==sha(readFileSync(logPath)))throw new Error('local_typecheck_evidence_log_drift');
  if(!Number.isFinite(Date.parse(record.completed_at))||Date.parse(record.completed_at)>Date.now())throw new Error('local_typecheck_evidence_time_invalid');
  return 'PASS_LOCAL_EXECUTION_SOURCE_AND_LOG_HASH_BOUND';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.includes('--check')){
    const status=readTypecheckEvidenceStatus();
    if(!status.startsWith('PASS'))throw new Error('local_typecheck_evidence_missing');
    console.log(`local-typecheck-evidence: ${status}`);
  }else{
    const before=inputHashes();
    const startedAt=new Date().toISOString();
    const result=spawnSync('npm',['run','typecheck'],{encoding:'utf8',maxBuffer:16*1024*1024});
    const output=`${result.stdout??''}${result.stderr??''}`;
    mkdirSync('release/local-validation',{recursive:true});
    writeFileSync(logPath,output);
    if(result.status!==0){
      // Never leave an earlier green record after a failed execution.
      writeFileSync(recordPath,JSON.stringify({schema_version:1,command:'npm run typecheck',exit_code:result.status??1,completed_at:new Date().toISOString(),log_path:logPath,log_sha256:sha(output),input_hashes:before},null,2)+'\n');
      process.stderr.write(output);
      process.exitCode=result.status??1;
    }else{
      if(JSON.stringify(before)!==JSON.stringify(inputHashes()))throw new Error('typecheck_inputs_changed_during_execution');
      writeFileSync(recordPath,JSON.stringify({schema_version:1,command:'npm run typecheck',exit_code:0,node_version:process.version,typescript_version:JSON.parse(readFileSync('node_modules/typescript/package.json','utf8')).version,started_at:startedAt,completed_at:new Date().toISOString(),log_path:logPath,log_sha256:sha(output),input_hashes:before,scope:'Dependency-resolved TypeScript only; no native compilation, device or live-service execution.'},null,2)+'\n');
      console.log(`local-typecheck-evidence: ${readTypecheckEvidenceStatus()}`);
    }
  }
}
