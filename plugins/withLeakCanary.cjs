const { withAppBuildGradle } = require('expo/config-plugins');

const LEAKCANARY = "debugImplementation 'com.squareup.leakcanary:leakcanary-android:2.14'";

module.exports = function withLeakCanary(config) {
  return withAppBuildGradle(config, (cfg) => {
    const source = cfg.modResults.contents;
    if (source.includes('com.squareup.leakcanary:leakcanary-android:')) return cfg;
    if (!/dependencies\s*\{/.test(source)) throw new Error('Unable to locate Android app dependencies block for LeakCanary debug instrumentation.');
    cfg.modResults.contents = source.replace(/dependencies\s*\{/, (match) => `${match}\n    // Tailmance development-only memory leak detection. Never ship this dependency in release builds.\n    ${LEAKCANARY}`);
    return cfg;
  });
};
