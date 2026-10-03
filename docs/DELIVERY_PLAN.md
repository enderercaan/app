# Delivery Plan

## MVP
Core/auth/18+ gate; onboarding; pet profile; document verification; discovery deck; matches; chat + unlock/quota; block/report/moderation; RevenueCat paywall; all 19 existing runtime locales; privacy/export/deletion; accessibility; crash reporting; legal/store gates; support tooling.

## v1.1
Grid/social polish; Stories; Pati Radar; Universal/App Links; Edge AI; image optimization pipeline; advanced filters; referral/share; device-matrix polish and growth instrumentation.

## v2
Reels (already implemented in the authoritative code and therefore retained rather than removed); matched-pet WebRTC/LiveKit calls (already implemented and retained); deeper multi-region DR, KEDA, chaos engineering and FinOps dashboards. Version labels describe rollout policy, not permission to delete already-built working capability.

## Migration rule
The new prompt's Flutter/BLoC/NestJS stack is not applied as an in-place rewrite because it conflicts with the authoritative React Native/Expo/Supabase source and would discard proven security/legal/product history. Equivalent clean-architecture goals are enforced in the real stack. Any future framework migration must run as a separate parity project with dual-run data/API compatibility and no feature regression.
