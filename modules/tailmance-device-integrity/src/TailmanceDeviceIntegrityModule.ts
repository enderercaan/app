import { requireOptionalNativeModule } from 'expo-modules-core';

type NativeIntegrityModule={
  isAppAttestSupportedAsync():Promise<boolean>;
  generateAppAttestKeyAsync():Promise<string>;
  attestAppAttestKeyAsync(keyId:string,clientDataUtf8:string):Promise<string>;
  generateAppAttestAssertionAsync(keyId:string,clientDataUtf8:string):Promise<string>;
  preparePlayIntegrityAsync(cloudProjectNumber:string):Promise<boolean>;
  requestPlayIntegrityTokenAsync(clientDataUtf8:string):Promise<string>;
  getLocalRiskSignalsAsync():Promise<{debuggerAttached:boolean;emulatorOrSimulator:boolean;rootOrJailbreakHeuristic:boolean;debugBuild:boolean}>;
  generateSecureRandomBase64UrlAsync(byteLength:number):Promise<string>;
};

export default requireOptionalNativeModule<NativeIntegrityModule>('TailmanceDeviceIntegrity');
