import 'react-native-gesture-handler';
import 'react-native-url-polyfill/auto';
import './src/services/offlineSyncTask';
import { registerLiveKitGlobals } from './src/services/liveKitGlobals';
import { registerRootComponent } from 'expo';
import App from './App';
registerLiveKitGlobals();
registerRootComponent(App);
