const { withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

const MANAGE_OWN_CALLS='android.permission.MANAGE_OWN_CALLS';
const SERVICE='expo.modules.tailmancesystemcalls.TailmanceConnectionService';

function android(config){
  return withAndroidManifest(config,cfg=>{
    const manifest=cfg.modResults.manifest;
    manifest['uses-permission']=manifest['uses-permission']??[];
    if(!manifest['uses-permission'].some(p=>p.$?.['android:name']===MANAGE_OWN_CALLS))manifest['uses-permission'].push({$:{'android:name':MANAGE_OWN_CALLS}});
    const app=manifest.application?.[0];
    if(!app)throw new Error('Tailmance system calls: Android application node missing');
    app.service=app.service??[];
    let service=app.service.find(s=>s.$?.['android:name']===SERVICE);
    if(!service){service={$:{'android:name':SERVICE,'android:permission':'android.permission.BIND_TELECOM_CONNECTION_SERVICE','android:exported':'true'},'intent-filter':[{$:{},action:[{$:{'android:name':'android.telecom.ConnectionService'}}]}]};app.service.push(service)}
    else service.$={...(service.$??{}),'android:permission':'android.permission.BIND_TELECOM_CONNECTION_SERVICE','android:exported':'true'};
    return cfg;
  });
}

function ios(config){
  return withInfoPlist(config,cfg=>{
    const existing=Array.isArray(cfg.modResults.UIBackgroundModes)?cfg.modResults.UIBackgroundModes:[];
    // 'audio' keeps an answered CallKit/LiveKit call audible after the user leaves the app; 'voip' delivers PushKit
    // incoming calls. No location background mode is requested.
    cfg.modResults.UIBackgroundModes=[...new Set([...existing,'remote-notification','voip','audio'])];
    return cfg;
  });
}

module.exports=function withSystemCalls(config){return ios(android(config));};
