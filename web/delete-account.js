const form=document.getElementById('deleteForm');
const result=document.getElementById('result');
let turnstileToken='';
const webConfig=window.TAILMANCE_WEB_CONFIG??window.PAWLINK_WEB_CONFIG??{};
const siteKey=typeof webConfig.turnstileSiteKey==='string'?webConfig.turnstileSiteKey.trim():'';
const siteKeyReady=/^[A-Za-z0-9_-]{10,200}$/.test(siteKey);
const configuredHttpsEndpoint=(value)=>{
  try{
    const url=new URL(String(value??'').trim());
    const host=url.hostname.toLowerCase();
    if(url.protocol!=='https:'||url.username||url.password||!host||host==='localhost'||host==='127.0.0.1'||host==='::1'||host.endsWith('.localhost'))return '';
    return url.toString();
  }catch{return ''}
};
const endpoint=configuredHttpsEndpoint(webConfig.deletionRequestEndpoint);
const copy=(key,fallback)=>form?.dataset?.[key]||fallback;
if(siteKeyReady&&form){
  const mount=document.createElement('div');
  mount.id='turnstileMount';
  form.insertBefore(mount,form.querySelector('button'));
  const script=document.createElement('script');
  script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async=true;
  script.defer=true;
  script.onload=()=>{window.turnstile?.render('#turnstileMount',{sitekey:siteKey,action:'account_deletion',callback:(token)=>{turnstileToken=token},'expired-callback':()=>{turnstileToken=''}})};
  document.head.appendChild(script);
}
form?.addEventListener('submit',async(e)=>{
  e.preventDefault();
  if(!endpoint||!siteKeyReady){result.className='error';result.textContent=copy('unconfigured','Deletion-request service unavailable.');return}
  if(!turnstileToken){result.className='error';result.textContent=copy('verification','Complete the security verification.');return}
  result.className='';result.textContent=copy('sending','Sending…');
  try{
    const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:form.email.value.trim(),turnstileToken})});
    if(!r.ok)throw new Error('request_failed');
    result.className='ok';result.textContent=copy('success','Request received.');
    form.reset();turnstileToken='';window.turnstile?.reset();
  }catch{
    result.className='error';result.textContent=copy('failure','The request could not be sent.');
  }
});
