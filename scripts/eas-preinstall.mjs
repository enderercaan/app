const profile=process.env.EAS_BUILD_PROFILE??'';
if(profile==='production'){
  await import('./release-config-check.mjs');
}else{
  console.log(`eas-preinstall: ${profile||'local'} profile, production config gate skipped`);
}
