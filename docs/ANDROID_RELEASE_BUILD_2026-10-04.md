# Android release build record (2026-10-04)

Environment: Ubuntu container, JDK 17, Gradle 9.3.1 (wrapper), Android SDK 36, build-tools 36.0.0, NDK 27.1.12297006, CMake 3.22.1, Node 22, `expo prebuild` output, `NODE_ENV=production`, `-Xmx2048m`.

Command: `./gradlew bundleRelease assembleRelease`. Result: BUILD SUCCESSFUL in 12 min 40 s, 990 tasks (567 executed).

| Artifact | Size | SHA-256 |
|---|---|---|
| `app-release.aab` | 153 MB | `6988c15e9b7b89a62fffbf1d34cc53a1daf4e68138aa48ec7d67fa1eceb2ce1b` |
| `app-release.apk` | 228 MB | `f0075e7c7311e616ba71a14356d3c8e8a97202fb287faaa16a6fcbf1c1a6e34f` |
| R8 `mapping.txt` | 87 MB | `5b8b411901800fd4123ebaf1c98653d2b8d7309d79cd0ec0b1365085b84d175c` |

Verified on the built APK:
- package `com.tailmance.app`, versionCode 1, versionName 1.0.0, compileSdk 36, targetSdk 36.
- ABIs: arm64-v8a, armeabi-v7a, x86, x86_64 (32 native libraries each).
- 64 of 64 64-bit `.so` files use 16 KB LOAD alignment (`readelf -l`); `zipalign -c -P 16 4` passes.
- Permissions: `SYSTEM_ALERT_WINDOW` and `WRITE_EXTERNAL_STORAGE` were pulled in by libraries; both are now blocked in `app.config.ts` and absent from the rebuilt APK (second `assembleRelease`, 13 min 28 s, successful). No `com.google.android.play:core` classes in the APK.
- Manifest: `allowBackup=false`, `usesCleartextTraffic=false`, `extractNativeLibs=false`, `dataExtractionRules` present.

Defect found by this build and fixed: `modules/tailmance-device-integrity` (Play Integrity) did not compile in Kotlin (`Nothing` reified type and suspend calls inside non-suspend lambdas). Guarded by `npm run test:android-native-module`.

Not a store-ready artifact:
- Signed with the generated debug keystore. A real upload key (or EAS-managed credentials) is required for Play.
- Built with placeholder values for Firebase / Google Maps key / Google URL scheme and staging environment. Production values come from EAS secrets.
- Not installed or run on a device or emulator (no KVM in the build container).
- iOS is not covered; it needs macOS or EAS Build.
