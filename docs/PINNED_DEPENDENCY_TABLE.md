# Pinned Dependency Table — Source Baseline

This table records the **declared source constraints** in the authoritative repository. A genuine `package-lock.json` is not present, so resolved transitive versions are **not** claimed reproducible yet. Do not silently upgrade packages. `VERIFY` each platform-compatible current version through the official package/Expo compatibility tooling when the lockfile is generated in controlled CI.

| Package | Source constraint | Role | Verification posture |
|---|---:|---|---|
| expo | `~57.0.23` | mobile runtime/toolchain | VERIFY official Expo compatibility before release lock |
| react | `19.2.3` | UI runtime | source exact |
| react-native | `0.86.3` | native runtime | source exact |
| @supabase/supabase-js | `^2.111.0` | auth/data/realtime client | VERIFY resolved version when lock generated |
| @react-navigation/native | `^7.4.1` | navigation | VERIFY resolved version |
| @react-navigation/native-stack | `^7.3.28` | stack navigation | VERIFY resolved version |
| @react-navigation/bottom-tabs | `^7.4.7` | tab navigation | VERIFY resolved version |
| expo-secure-store | `~57.0.4` | device-only secure auth storage | VERIFY Expo compatibility |
| expo-sqlite | `~57.0.3` | SQLCipher/offline queue | VERIFY Expo compatibility |
| expo-video | `~57.0.5` | Reels/video | VERIFY Expo compatibility |
| expo-notifications | `~57.0.20` | push | VERIFY Expo compatibility |
| expo-location | `~57.0.18` | approximate foreground location | VERIFY Expo compatibility |
| react-native-purchases | `^10.9.1` | RevenueCat | VERIFY resolved version + store SDK compatibility |
| @sentry/react-native | `8.28.0` | observability | source exact; VERIFY symbol pipeline |
| livekit-client | `2.22.3` | calls | source exact |
| @livekit/react-native | `3.0.0` | RN LiveKit bridge | source exact |
| typescript | `~5.9.2` | strict static analysis | VERIFY resolved patch |
| Node.js | `>=22.13.0` | scripts/CI runtime | release CI must pin an exact image/version |
| npm | `10.9.2` | package manager | source-declared exact; lockfile still required |

## Reproducibility gate

`VERIFY: npm registry / Expo official compatibility tooling` before generating the production lock. The project must not fabricate a lockfile offline. Production release remains fail-closed until a genuine dependency resolution, SBOM, scan and signed build are evidenced.
