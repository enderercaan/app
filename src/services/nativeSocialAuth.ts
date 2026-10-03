import {Platform} from 'react-native';
import * as Crypto from 'expo-crypto';
import {env} from './config';
import {stageOAuthAuthorizationCode,stageOAuthProviderCredential,supabase} from './supabase';

type NativeSocialProvider='apple'|'google';
type NativeSocialResult={provider:NativeSocialProvider;capturedRevocationCredential:boolean};

async function signInWithAppleNative():Promise<NativeSocialResult>{
  if(Platform.OS!=='ios')throw new Error('apple_native_unavailable_on_platform');
  const AppleAuthentication=await import('expo-apple-authentication');
  if(!(await AppleAuthentication.isAvailableAsync()))throw new Error('apple_native_auth_unavailable');
  const rawNonce=Crypto.randomUUID();
  const hashedNonce=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,rawNonce);
  const state=Crypto.randomUUID();
  const credential=await AppleAuthentication.signInAsync({
    requestedScopes:[AppleAuthentication.AppleAuthenticationScope.EMAIL],
    nonce:hashedNonce,
    state
  });
  if(credential.state!==state)throw new Error('apple_native_state_mismatch');
  const identityToken=credential.identityToken?.trim()??'';
  if(!identityToken)throw new Error('apple_native_identity_token_missing');
  const {data,error}=await supabase.auth.signInWithIdToken({provider:'apple',token:identityToken,nonce:rawNonce});
  if(error)throw error;
  if(!data.session||!data.user)throw new Error('apple_native_session_missing');
  const authorizationCode=credential.authorizationCode?.trim()??'';
  if(!authorizationCode)return{provider:'apple',capturedRevocationCredential:false};
  try{
    await stageOAuthAuthorizationCode('apple',authorizationCode);
    return{provider:'apple',capturedRevocationCredential:true};
  }catch{
    // Authentication already succeeded. The short-lived code remains in encrypted SecureStore
    // when the authenticated capture request fails and AuthContext retries it on session events.
    // Account deletion still has a localized manual-revoke fallback for legacy/expired cases.
    return{provider:'apple',capturedRevocationCredential:false};
  }
}

async function googleInteractiveResponse(){
  const Google=await import('react-native-nitro-google-signin');
  const webClientId=env.googleWebClientId.trim();
  if(!webClientId||!/\.apps\.googleusercontent\.com$/.test(webClientId))throw new Error('google_native_web_client_id_missing');
  Google.GoogleOneTapSignIn.configure({webClientId,offlineAccess:true,autoSelectOnSignIn:false});
  if(Platform.OS==='android')await Google.GoogleOneTapSignIn.checkPlayServices();
  let response=await Google.GoogleOneTapSignIn.signIn();
  if(Google.isNoSavedCredentialFoundResponse(response))response=await Google.GoogleOneTapSignIn.createAccount();
  if(Google.isNoSavedCredentialFoundResponse(response))response=await Google.GoogleOneTapSignIn.presentExplicitSignIn();
  if(Google.isCancelledResponse(response))throw new Error('google_native_cancelled');
  if(!Google.isSuccessResponse(response))throw new Error('google_native_sign_in_failed');
  return{Google,data:response.data};
}

async function signInWithGoogleNative():Promise<NativeSocialResult>{
  const {Google,data}=await googleInteractiveResponse();
  const idToken=data.idToken?.trim()??'';
  if(!idToken)throw new Error('google_native_identity_token_missing');
  const {data:authData,error}=await supabase.auth.signInWithIdToken({provider:'google',token:idToken});
  if(error)throw error;
  if(!authData.session||!authData.user)throw new Error('google_native_session_missing');
  const serverAuthCode=data.serverAuthCode?.trim()??'';
  try{
    if(serverAuthCode){
      await stageOAuthAuthorizationCode('google',serverAuthCode);
      return{provider:'google',capturedRevocationCredential:true};
    }
    const tokens=await Google.GoogleOneTapSignIn.getTokens();
    const accessToken=tokens.accessToken?.trim()??'';
    if(!accessToken)throw new Error('google_native_revocation_credential_missing');
    await stageOAuthProviderCredential('google','access_token',accessToken);
    return{provider:'google',capturedRevocationCredential:true};
  }catch{
    return{provider:'google',capturedRevocationCredential:false};
  }
}

export async function signInWithNativeSocialProvider(provider:NativeSocialProvider){
  if(provider==='apple')return signInWithAppleNative();
  return signInWithGoogleNative();
}
