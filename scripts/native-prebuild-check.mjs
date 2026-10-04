import assert from 'node:assert/strict';
import {readFileSync,globSync} from 'node:fs';
import {join,resolve} from 'node:path';

const directory=process.env.TAILMANCE_PREBUILD_DIR;
assert.ok(directory,'TAILMANCE_PREBUILD_DIR must point to a genuinely generated Expo native project');
const root=resolve(directory);
const read=path=>readFileSync(join(root,path),'utf8');
const manifest=read('android/app/src/main/AndroidManifest.xml');
const permissions=[...manifest.matchAll(/<uses-permission\b[^>]*>/g)].map(match=>match[0]);
for(const name of ['ACCESS_COARSE_LOCATION','CAMERA','RECORD_AUDIO','MANAGE_OWN_CALLS']){
  const node=permissions.find(value=>value.includes(`android:name="android.permission.${name}"`));
  assert.ok(node,`generated Android permission missing: ${name}`);
  assert.doesNotMatch(node,/tools:node="remove"/,`generated Android permission removed by a config plugin: ${name}`);
}
for(const name of ['ACCESS_FINE_LOCATION','READ_MEDIA_IMAGES','READ_MEDIA_VIDEO','READ_EXTERNAL_STORAGE']){
  const nodes=permissions.filter(value=>value.includes(`android:name="android.permission.${name}"`));
  assert.ok(nodes.every(value=>value.includes('tools:node="remove"')),`generated Android broad permission exposed: ${name}`);
}
const activity=manifest.match(/<activity\b[^>]*android:name="\.MainActivity"[^>]*>/)?.[0];
assert.ok(activity,'generated MainActivity missing');
assert.match(activity,/android:launchMode="singleTop"/);
const application=manifest.match(/<application\b[^>]*>/)?.[0];
assert.match(application??'',/android:usesCleartextTraffic="false"/);
assert.match(application??'',/android:allowBackup="false"/);
assert.match(application??'',/android:supportsRtl="true"/);
assert.match(manifest,/TailmanceConnectionService/);
const network=read('android/app/src/main/res/xml/network_security_config.xml');
assert.match(network,/cleartextTrafficPermitted="false"/);
assert.match(network,/<certificates src="system"/);
const gradle=read('android/gradle.properties');
assert.match(gradle,/expo\.sqlite\.useSQLCipher=true/);
assert.match(gradle,/android\.enableMinifyInReleaseBuilds=true/);
assert.match(gradle,/android\.enableShrinkResourcesInReleaseBuilds=true/);
const plists=globSync(join(root,'ios/*/Info.plist'));
assert.equal(plists.length,1,'exactly one main iOS Info.plist expected');
const plist=readFileSync(plists[0],'utf8');
for(const key of ['NSAllowsArbitraryLoads','NSAllowsArbitraryLoadsForMedia','NSAllowsArbitraryLoadsInWebContent','NSAllowsLocalNetworking'])assert.match(plist,new RegExp(`<key>${key}</key>\\s*<false\\s*/>`),`iOS ATS changed: ${key}`);
assert.match(plist,/<key>NSMicrophoneUsageDescription<\/key>\s*<string>[^<]*matched-pet audio or video call/);
assert.match(plist,/<string>remote-notification<\/string>/);
assert.match(plist,/<string>voip<\/string>/);
assert.match(plist,/<string>audio<\/string>/,'answered calls must stay audible in the background');
assert.doesNotMatch(plist,/<key>UIBackgroundModes<\/key>\s*<array>[\s\S]*?<string>location<\/string>[\s\S]*?<\/array>/,'no background location mode');
const styles=read('android/app/src/main/res/values/styles.xml');
assert.match(styles,/<item name="android:forceDarkAllowed">false<\/item>/,'custom dark palette must not be force-darkened');
assert.match(read('android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'),/<monochrome android:drawable="@mipmap\/ic_launcher_monochrome"\/>/,'Android 13+ themed icon layer missing');
const pods=JSON.parse(read('ios/Podfile.properties.json'));
assert.equal(pods['expo.sqlite.useSQLCipher'],'true');
console.log('native-prebuild-check: generated Android permissions/activity/security/SQLCipher and iOS ATS/microphone/background modes/SQLCipher PASS; no native compilation or device execution claimed');
