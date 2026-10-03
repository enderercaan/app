import { SymbolView } from 'expo-symbols';
import { I18nManager, type ColorValue } from 'react-native';
import { useTheme } from '../theme';

type IconName = 'moon'|'home'|'search'|'heart'|'chat'|'paw'|'bell'|'filter'|'undo'|'plus'|'close'|'star'|'spark'|'shield'|'verified'|'location'|'health'|'calendar'|'lock'|'more'|'bookmark'|'share'|'comment'|'send'|'settings'|'chevron'|'person'|'camera'|'edit'|'info'|'check'|'warning'|'privacy'|'pause'|'refresh'|'flag'|'back'|'eye'|'eyeOff'|'list'|'logout'|'play'|'microphone'|'microphoneOff'|'video'|'videoOff'|'phone'|'hangup';
const map: Record<IconName,{ios:string;android:string;web:string}> = {
  moon:{ios:'moon.fill',android:'dark_mode',web:'dark_mode'},
  home:{ios:'house.fill',android:'home',web:'home'}, search:{ios:'magnifyingglass',android:'search',web:'search'}, heart:{ios:'heart.fill',android:'favorite',web:'favorite'},
  chat:{ios:'message.fill',android:'chat_bubble',web:'chat_bubble'}, paw:{ios:'pawprint.fill',android:'pets',web:'pets'}, bell:{ios:'bell.fill',android:'notifications',web:'notifications'},
  filter:{ios:'slider.horizontal.3',android:'tune',web:'tune'}, undo:{ios:'arrow.uturn.backward',android:'undo',web:'undo'}, plus:{ios:'plus',android:'add',web:'add'},
  close:{ios:'xmark',android:'close',web:'close'}, star:{ios:'star.fill',android:'star',web:'star'}, spark:{ios:'sparkles',android:'auto_awesome',web:'auto_awesome'},
  shield:{ios:'shield.fill',android:'shield',web:'shield'}, verified:{ios:'checkmark.seal.fill',android:'verified',web:'verified'}, location:{ios:'location.fill',android:'location_on',web:'location_on'},
  health:{ios:'cross.case.fill',android:'health_and_safety',web:'health_and_safety'}, calendar:{ios:'calendar',android:'event',web:'event'}, lock:{ios:'lock.fill',android:'lock',web:'lock'},
  more:{ios:'ellipsis',android:'more_horiz',web:'more_horiz'}, bookmark:{ios:'bookmark.fill',android:'bookmark',web:'bookmark'}, share:{ios:'square.and.arrow.up',android:'share',web:'share'},
  comment:{ios:'bubble.left.fill',android:'mode_comment',web:'mode_comment'}, send:{ios:'paperplane.fill',android:'send',web:'send'}, settings:{ios:'gearshape.fill',android:'settings',web:'settings'},
  chevron:{ios:'chevron.right',android:'chevron_right',web:'chevron_right'}, person:{ios:'person.crop.circle.fill',android:'account_circle',web:'account_circle'}, camera:{ios:'camera.fill',android:'photo_camera',web:'photo_camera'},
  edit:{ios:'pencil',android:'edit',web:'edit'}, info:{ios:'info.circle.fill',android:'info',web:'info'}, check:{ios:'checkmark',android:'check',web:'check'}, warning:{ios:'exclamationmark.triangle.fill',android:'warning',web:'warning'},
  privacy:{ios:'hand.raised.fill',android:'privacy_tip',web:'privacy_tip'}, pause:{ios:'pause.fill',android:'pause',web:'pause'}, refresh:{ios:'arrow.clockwise',android:'refresh',web:'refresh'}, flag:{ios:'flag.fill',android:'flag',web:'flag'}, back:{ios:'chevron.left',android:'arrow_back',web:'arrow_back'}, eye:{ios:'eye.fill',android:'visibility',web:'visibility'}, eyeOff:{ios:'eye.slash.fill',android:'visibility_off',web:'visibility_off'}, list:{ios:'list.bullet',android:'list',web:'list'}, logout:{ios:'rectangle.portrait.and.arrow.right',android:'logout',web:'logout'}, play:{ios:'play.rectangle.fill',android:'smart_display',web:'smart_display'}, microphone:{ios:'mic.fill',android:'mic',web:'mic'}, microphoneOff:{ios:'mic.slash.fill',android:'mic_off',web:'mic_off'}, video:{ios:'video.fill',android:'videocam',web:'videocam'}, videoOff:{ios:'video.slash.fill',android:'videocam_off',web:'videocam_off'}, phone:{ios:'phone.fill',android:'call',web:'call'}, hangup:{ios:'phone.down.fill',android:'call_end',web:'call_end'}
};
export function AppIcon({name,size=22,color}:{name:IconName;size?:number;color?:ColorValue}){
  const theme=useTheme();
  const rtlDirectional=name==='chevron'?(I18nManager.isRTL?{ios:'chevron.left',android:'chevron_left',web:'chevron_left'}:map.chevron):name==='back'?(I18nManager.isRTL?{ios:'chevron.right',android:'arrow_forward',web:'arrow_forward'}:map.back):null;
  const def=rtlDirectional??map[name];
  return <SymbolView name={def as never} tintColor={color??theme.colors.text} size={size}/>;
}
