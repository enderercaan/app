const OPERATIONAL_CODE=/^[a-z0-9][a-z0-9_.-]{2,79}$/;

export function recordEdgeOperationalIssue(code:string){
  const normalized=code.trim().toLowerCase();
  if(!OPERATIONAL_CODE.test(normalized))return;
  // Fixed codes only: never log raw exceptions, request bodies, tokens, user identifiers or provider payloads.
  // Keep production console output constant. The validated operation code is deliberately
  // not emitted because console sinks are outside Tailmance's structured privacy boundary.
  void normalized;
  console.warn('tailmance_operational_warning');
}

export async function edgeBestEffort<T>(code:string,work:()=>Promise<T>):Promise<T|undefined>{
  try{return await work()}catch(error){recordEdgeOperationalIssue(code);void error;return undefined}
}
