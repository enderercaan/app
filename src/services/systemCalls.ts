import {Platform} from 'react-native';
import NativeSystemCalls,{type SystemCallAction,type SystemCallType} from '../../modules/tailmance-system-calls';

let configured=false;
let configureFlight:Promise<boolean>|null=null;

export async function configureSystemCalls(){
  if(Platform.OS==='web'||!NativeSystemCalls)return false;
  if(configured)return true;
  if(configureFlight)return configureFlight;
  configureFlight=NativeSystemCalls.configureAsync().then(value=>{configured=value===true;return configured}).catch(()=>false).finally(()=>{configureFlight=null});
  return configureFlight;
}

export async function drainSystemCallActions():Promise<SystemCallAction[]> {
  if(!(await configureSystemCalls())||!NativeSystemCalls)return [];
  try{return await NativeSystemCalls.drainActionsAsync()}catch{return []}
}

export async function currentVoipPushToken(){
  if(Platform.OS!=='ios'||!(await configureSystemCalls())||!NativeSystemCalls)return null;
  try{return await NativeSystemCalls.getVoipPushTokenAsync()}catch{return null}
}

export async function reportIncomingSystemCall(input:{callId:string;callerName:string;callType:SystemCallType;recipientPetId:string;userId:string}){
  if(!(await configureSystemCalls())||!NativeSystemCalls)return false;
  try{return await NativeSystemCalls.reportIncomingCallAsync(input.callId,input.callerName,input.callType,input.recipientPetId,input.userId)}catch{return false}
}

export async function reportOutgoingSystemCall(input:{callId:string;calleeName:string;callType:SystemCallType}){
  if(!(await configureSystemCalls())||!NativeSystemCalls)return false;
  try{return await NativeSystemCalls.reportOutgoingCallAsync(input.callId,input.calleeName,input.callType)}catch{return false}
}

export async function reportSystemCallConnected(callId:string){
  if(!(await configureSystemCalls())||!NativeSystemCalls)return false;
  try{return await NativeSystemCalls.reportCallConnectedAsync(callId)}catch{return false}
}

export async function reportSystemCallEnded(callId:string,reason:'ended'|'declined'|'failed'|'unanswered'='ended'){
  if(!(await configureSystemCalls())||!NativeSystemCalls)return false;
  try{return await NativeSystemCalls.reportCallEndedAsync(callId,reason)}catch{return false}
}
