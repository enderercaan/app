import {readFileSync,writeFileSync} from 'node:fs';

const required=['TAILMANCE_WEB_DELETION_ENDPOINT','TAILMANCE_WEB_TURNSTILE_SITE_KEY','TAILMANCE_WEB_AUTH_TURNSTILE_SITE_KEY'];
const value=name=>(process.env[name]??'').trim();
const placeholder=/YOUR_|REPLACE_|xxxxx|example\.com/i;
const failures=[];
for(const name of required){const v=value(name);if(!v)failures.push(`${name}: missing`);else if(placeholder.test(v))failures.push(`${name}: placeholder value`);}
const endpoint=value('TAILMANCE_WEB_DELETION_ENDPOINT');
if(endpoint){
  try{const u=new URL(endpoint);if(u.protocol!=='https:')failures.push('TAILMANCE_WEB_DELETION_ENDPOINT: must use HTTPS');if(['localhost','127.0.0.1','::1'].includes(u.hostname))failures.push('TAILMANCE_WEB_DELETION_ENDPOINT: localhost is not a production endpoint');if(u.username||u.password)failures.push('TAILMANCE_WEB_DELETION_ENDPOINT: embedded credentials are forbidden');}
  catch{failures.push('TAILMANCE_WEB_DELETION_ENDPOINT: invalid URL');}
}
for(const name of ['TAILMANCE_WEB_TURNSTILE_SITE_KEY','TAILMANCE_WEB_AUTH_TURNSTILE_SITE_KEY']){
  const v=value(name);if(v&&!/^[A-Za-z0-9_-]{10,200}$/.test(v))failures.push(`${name}: implausible Cloudflare Turnstile site key`);
}
if(failures.length)throw new Error(`Web runtime production config failed (${failures.length} issues):\n- ${failures.join('\n- ')}`);
const generated=`window.TAILMANCE_WEB_CONFIG = Object.freeze(${JSON.stringify({deletionRequestEndpoint:endpoint,turnstileSiteKey:value('TAILMANCE_WEB_TURNSTILE_SITE_KEY'),authTurnstileSiteKey:value('TAILMANCE_WEB_AUTH_TURNSTILE_SITE_KEY')},null,2)});\n`;
if(process.argv.includes('--check-file')){
  const current=readFileSync('web/config.js','utf8');
  if(current!==generated)throw new Error('web/config.js does not match the validated production web runtime environment; run npm run web-config:generate in the release workspace before deploying the web artifact');
  console.log('web-runtime-config: validated environment + generated file match PASS');
}else if(process.argv.includes('--check-env')){
  console.log('web-runtime-config: production environment values validated PASS');
}else{
  writeFileSync('web/config.js',generated);
  console.log('web-runtime-config: generated web/config.js from validated production environment');
}
