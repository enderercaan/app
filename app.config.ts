import 'dotenv/config';
import type { ExpoConfig } from 'expo/config';
import TAILMANCE_BRAND from './brand.json';

const sentryOrg=process.env.SENTRY_ORG?.trim();
const sentryProject=process.env.SENTRY_PROJECT?.trim();
const sentryPlugins:any[]=sentryOrg&&sentryProject?[['@sentry/react-native/expo',{url:'https://sentry.io/',organization:sentryOrg,project:sentryProject,disableAutoUpload:false}]]:[];
const mapsAndroidKey=process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim();
const googleServicesFile=process.env.GOOGLE_SERVICES_JSON?.trim();
const googleServiceInfoPlist=process.env.GOOGLE_SERVICE_INFO_PLIST?.trim();
const googleIosUrlScheme=process.env.GOOGLE_IOS_URL_SCHEME?.trim();
const mapsPlugins:any[]=mapsAndroidKey?[['react-native-maps',{androidGoogleMapsApiKey:mapsAndroidKey}]]:[];
const rawAppLinkHost=process.env.EXPO_PUBLIC_APP_LINK_HOST?.trim().toLowerCase()??'';
const appLinkHostPattern=/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
if(rawAppLinkHost&&!appLinkHostPattern.test(rawAppLinkHost))throw new Error('EXPO_PUBLIC_APP_LINK_HOST must be a bare public DNS hostname without scheme, path, wildcard, port, or IP literal');
const appLinkHost=rawAppLinkHost||undefined;

const config: ExpoConfig = {
  name: TAILMANCE_BRAND.appName,
  slug: 'tailmance',
  scheme: 'tailmance',
  version: '1.0.0',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  locales: {
    en: './languages/en.json', es: './languages/es.json', 'pt-BR': './languages/pt-BR.json', fr: './languages/fr.json',
    de: './languages/de.json', it: './languages/it.json', ru: './languages/ru.json', tr: './languages/tr.json', ar: './languages/ar.json',
    hi: './languages/hi.json', id: './languages/id.json', ja: './languages/ja.json', ko: './languages/ko.json',
    'zh-Hans': './languages/zh-Hans.json', 'zh-Hant': './languages/zh-Hant.json', nl: './languages/nl.json', pl: './languages/pl.json', th: './languages/th.json', vi: './languages/vi.json'
  },
  icon: './assets/icon.png',
  ios: {
    supportsTablet: true,
    privacyManifests: {
      NSPrivacyTracking: false
    },
    bundleIdentifier: 'com.tailmance.app',
    ...(googleServiceInfoPlist ? { googleServicesFile: googleServiceInfoPlist } : {}),
    ...(appLinkHost ? { associatedDomains: [`applinks:${appLinkHost}`] } : {}),
    usesAppleSignIn: true,
    entitlements: {
      'com.apple.developer.devicecheck.appattest-environment': process.env.EXPO_PUBLIC_APP_ENV==='production'?'production':'development'
    },
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
      NSPhotoLibraryUsageDescription: 'Tailmance accesses only the photos and videos you choose for pet profiles, social posts, stories, and Reels.',
      NSCameraUsageDescription: 'Tailmance uses the camera for pet photos, stories, Reels, pet verification, and matched-pet video calls.',
      NSMicrophoneUsageDescription: 'Tailmance uses the microphone only when you start or accept a matched-pet audio or video call.',
      NSLocationWhenInUseUsageDescription: 'Tailmance uses approximate location to show nearby pets by distance.',
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSAllowsArbitraryLoadsForMedia: false,
        NSAllowsArbitraryLoadsInWebContent: false,
        NSAllowsLocalNetworking: false
      }
    }
  },
  android: {
    package: 'com.tailmance.app',
    ...(appLinkHost ? { intentFilters: [{ action: 'VIEW', autoVerify: true, data: [
      { scheme: 'https', host: appLinkHost, pathPrefix: '/pet/' },
      { scheme: 'https', host: appLinkHost, pathPrefix: '/reel/' },
      { scheme: 'https', host: appLinkHost, pathPrefix: '/story/' }
    ], category: ['BROWSABLE','DEFAULT'] }] } : {}),
    ...(googleServicesFile ? { googleServicesFile } : {}),
    permissions: ['ACCESS_COARSE_LOCATION', 'POST_NOTIFICATIONS', 'CAMERA', 'RECORD_AUDIO'],
    blockedPermissions: [
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW'
    ],
    adaptiveIcon: { foregroundImage: './assets/adaptive-foreground.png', monochromeImage: './assets/adaptive-monochrome.png', backgroundColor: '#301D31' }
  },
  web: { favicon: './assets/favicon.png' },
  plugins: [
    ...sentryPlugins,
    ...mapsPlugins,
    'expo-apple-authentication',
    ['react-native-nitro-google-signin',googleIosUrlScheme?{iosUrlScheme:googleIosUrlScheme}:{}],
    '@livekit/react-native-expo-plugin',
    '@config-plugins/react-native-webrtc',
    ['./plugins/withAndroidSingleTop.cjs'],
    ['./plugins/withAndroidForceDarkDisabled.cjs'],
    ['./plugins/withNetworkSecurity.cjs'],
    ['./plugins/withLeakCanary.cjs'],
    ['./plugins/withIosReleaseHardening.cjs'],
    ['./plugins/withSystemCalls.cjs'],
    ['expo-build-properties', { android: { compileSdkVersion: 36, targetSdkVersion: 36, enableMinifyInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true } }],
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 220, resizeMode: 'contain', backgroundColor: '#301D31', dark: { image: './assets/splash-icon.png', backgroundColor: '#0F172A' } }],
    'expo-system-ui',
    ['expo-sqlite', { useSQLCipher: true, enableFTS: false }],
    ['expo-secure-store', { configureAndroidBackup: false }],
    ['expo-image-picker', { photosPermission: 'Tailmance accesses only the photos and videos you choose for pet profiles, social posts, stories, and Reels.', cameraPermission: 'Tailmance uses the camera for pet photos, stories, and pet verification.', microphonePermission: 'Tailmance uses the microphone only when you start or accept a matched-pet audio or video call.' }],
    ['expo-location', { locationWhenInUsePermission: 'Tailmance uses approximate location to show nearby pets by distance.' }],
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#DFAA64', defaultChannel: 'default' }]
  ],
  extra: {
    owner: TAILMANCE_BRAND.owner,
    copyright: TAILMANCE_BRAND.copyrightNotice,
    trademark: TAILMANCE_BRAND.trademark,
    ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() ? { eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID.trim() } } : {})
  }
};

export default config;
