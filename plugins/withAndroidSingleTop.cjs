const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withAndroidSingleTop(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    const activities = application?.activity ?? [];
    const mainActivity = activities.find((activity) =>
      (activity['intent-filter'] ?? []).some((filter) =>
        (filter.action ?? []).some((action) => action.$?.['android:name'] === 'android.intent.action.MAIN')
      )
    );
    if (!mainActivity) throw new Error('Unable to find Android MAIN activity for launchMode hardening.');
    mainActivity.$ = { ...(mainActivity.$ ?? {}), 'android:launchMode': 'singleTop' };
    return config;
  });
};
