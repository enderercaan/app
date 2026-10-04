import { requireOptionalNativeModule } from 'expo-modules-core';

export type SystemCallType='audio'|'video';
export type SystemCallAction={
  type:'answer'|'end'|'incoming_reported'|'incoming_failed'|'voip_token_updated'|'voip_token_invalidated'|'provider_reset';
  callId?:string;
  recipientPetId?:string;
  userId?:string;
  token?:string;
  error?:string;
};

type NativeSystemCallsModule={
  configureAsync():Promise<boolean>;
  drainActionsAsync():Promise<SystemCallAction[]>;
  getVoipPushTokenAsync():Promise<string|null>;
  reportIncomingCallAsync(callId:string,callerName:string,callType:SystemCallType,recipientPetId:string,userId:string):Promise<boolean>;
  reportOutgoingCallAsync(callId:string,calleeName:string,callType:SystemCallType):Promise<boolean>;
  reportCallConnectedAsync(callId:string):Promise<boolean>;
  reportCallEndedAsync(callId:string,reason:'ended'|'declined'|'failed'|'unanswered'):Promise<boolean>;
};

export default requireOptionalNativeModule<NativeSystemCallsModule>('TailmanceSystemCalls');
