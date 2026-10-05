const fs=require('fs');
const path=require('path');
const {withAndroidManifest,withDangerousMod,AndroidConfig}=require('expo/config-plugins');

module.exports=function withNetworkSecurity(config){
  config=withAndroidManifest(config,async cfg=>{
    const app=AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$['android:usesCleartextTraffic']='false';
    app.$['android:networkSecurityConfig']='@xml/network_security_config';
    app.$['android:allowBackup']='false';
    app.$['android:fullBackupContent']='@xml/tailmance_backup_rules';
    app.$['android:dataExtractionRules']='@xml/tailmance_data_extraction_rules';
    return cfg;
  });
  config=withDangerousMod(config,['android',async cfg=>{
    const xmlDir=path.join(cfg.modRequest.platformProjectRoot,'app','src','main','res','xml');
    fs.mkdirSync(xmlDir,{recursive:true});
    fs.writeFileSync(path.join(xmlDir,'network_security_config.xml'),`<?xml version="1.0" encoding="utf-8"?>\n<network-security-config>\n  <base-config cleartextTrafficPermitted="false">\n    <trust-anchors>\n      <certificates src="system" />\n    </trust-anchors>\n    <certificateTransparency enabled="true" />\n  </base-config>\n</network-security-config>\n`);
    // Tailmance is server-authoritative and does not need Android app-data backup.
    // Explicit excludes cover pre-Android 12 cloud backup and Android 12+ cloud/D2D rules.
    fs.writeFileSync(path.join(xmlDir,'tailmance_backup_rules.xml'),`<?xml version="1.0" encoding="utf-8"?>\n<full-backup-content>\n  <exclude domain="root" path="." />\n  <exclude domain="file" path="." />\n  <exclude domain="database" path="." />\n  <exclude domain="sharedpref" path="." />\n  <exclude domain="external" path="." />\n</full-backup-content>\n`);
    fs.writeFileSync(path.join(xmlDir,'tailmance_data_extraction_rules.xml'),`<?xml version="1.0" encoding="utf-8"?>\n<data-extraction-rules>\n  <cloud-backup>\n    <exclude domain="root" path="." />\n    <exclude domain="file" path="." />\n    <exclude domain="database" path="." />\n    <exclude domain="sharedpref" path="." />\n    <exclude domain="external" path="." />\n  </cloud-backup>\n  <device-transfer>\n    <exclude domain="root" path="." />\n    <exclude domain="file" path="." />\n    <exclude domain="database" path="." />\n    <exclude domain="sharedpref" path="." />\n    <exclude domain="external" path="." />\n  </device-transfer>\n</data-extraction-rules>\n`);
    return cfg;
  }]);
  return config;
};
