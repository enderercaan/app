const encoder=new TextEncoder();

export function constantTimeEqualText(a:string,b:string){
  const aa=encoder.encode(a);
  const bb=encoder.encode(b);
  const n=Math.max(aa.length,bb.length);
  let diff=aa.length^bb.length;
  for(let i=0;i<n;i++)diff|=(aa[i]??0)^(bb[i]??0);
  return diff===0;
}

export function verifyBearerSecret(header:string|null,secret:string|undefined|null,minSecretLength=20){
  if(typeof secret!=='string'||secret.length<minSecretLength)return false;
  return constantTimeEqualText(header??'',`Bearer ${secret}`);
}
