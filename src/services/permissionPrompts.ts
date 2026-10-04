import { Alert } from 'react-native';
import { getRuntimeLocale, translate } from '../i18n';

type TailmancePermissionKind='camera'|'location'|'notifications'|'calls';

/** App-owned rationale shown before any OS permission sheet. A cancel resolves false and the OS prompt is never opened. */
export function confirmPrePermission(kind:TailmancePermissionKind):Promise<boolean>{
  const locale=getRuntimeLocale();
  const title=translate(locale,`permissions.${kind}.title`);
  const body=translate(locale,`permissions.${kind}.body`);
  return new Promise(resolve=>{
    Alert.alert(title,body,[
      {text:translate(locale,'permissions.notNow'),style:'cancel',onPress:()=>resolve(false)},
      {text:translate(locale,'permissions.continue'),onPress:()=>resolve(true)}
    ],{cancelable:true,onDismiss:()=>resolve(false)});
  });
}
