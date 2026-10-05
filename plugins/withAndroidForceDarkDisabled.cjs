const { withAndroidStyles, AndroidConfig } = require('expo/config-plugins');

// Tailmance ships its own semantic light and dark palettes (src/theme.ts). Android 10+ "force dark" can
// recolor views a second time and break contrast-checked tokens, so it is disabled on the app theme.
module.exports = function withAndroidForceDarkDisabled(config) {
  return withAndroidStyles(config, (config) => {
    config.modResults = AndroidConfig.Styles.assignStylesValue(config.modResults, {
      add: true,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
      name: 'android:forceDarkAllowed',
      value: 'false'
    });
    return config;
  });
};
