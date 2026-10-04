import {recordOperationalIssue} from './crashReporting';

export async function runBestEffort<T>(code:string,work:()=>Promise<T>):Promise<T|undefined>{
  try{return await work()}catch(error){recordOperationalIssue(code);void error;return undefined}
}

export function runBestEffortSync<T>(code:string,work:()=>T):T|undefined{
  try{return work()}catch(error){recordOperationalIssue(code);void error;return undefined}
}
