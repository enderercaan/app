# Pinned Dependency Baseline

These are the versions pinned by the authoritative repository. This table does **not** claim they are the latest upstream releases. Upstream-current status is `VERIFY` during each release train.

| Package | Repository constraint | Role | Upstream-current status |
|---|---:|---|---|
| expo | `~57.0.23` | Mobile runtime/toolchain | VERIFY official Expo release notes |
| react | `19.2.3` | UI runtime | VERIFY upstream before upgrade |
| react-native | `0.86.3` | Native mobile framework | VERIFY Expo SDK compatibility before upgrade |
| typescript | `~5.9.2` | Strict typing/tooling | VERIFY before upgrade |
| @supabase/supabase-js | `^2.111.0` | Auth/database/storage/Edge client | VERIFY before upgrade |
| expo-secure-store | `~57.0.4` | Secure local secrets/session material | Expo-SDK-coupled |
| expo-sqlite | `~57.0.3` | SQLCipher-backed offline queue/cache | Expo-SDK-coupled |
| expo-background-task | `~57.0.16` | Background replay | Expo-SDK-coupled |
| expo-network | `~57.0.2` | Connectivity replay trigger | Expo-SDK-coupled |
| expo-video | `~57.0.5` | Reels/video playback | Expo-SDK-coupled |
| expo-image | `~57.0.5` | Bounded/cache-aware images | Expo-SDK-coupled |
| react-native-purchases | `^10.9.1` | RevenueCat | VERIFY RevenueCat compatibility before upgrade |
| @sentry/react-native | `8.28.0` | Crash/APM | VERIFY before upgrade |
| react-native-maps | `1.27.2` | Maps | VERIFY Expo/native compatibility |
| @livekit/react-native | `3.0.0` | Audio/video calls | VERIFY with native plugin before upgrade |
| livekit-client | `2.22.3` | Call/session client | VERIFY with RN adapter |

## Reproducibility boundary
A genuine `package-lock.json` is absent. Reproducible dependency resolution remains fail-closed until a real online npm resolution creates and validates the lockfile. No synthetic lockfile is permitted.
