const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// Use Sentry's Expo-aware Metro config so production JavaScript source maps are
// generated in the shape expected by the native crash reporting pipeline.
// Upload credentials are supplied only by the build environment.
module.exports = getSentryExpoConfig(__dirname, {
  annotateReactComponents: false,
  includeWebReplay: false,
  includeWebFeedback: false
});
