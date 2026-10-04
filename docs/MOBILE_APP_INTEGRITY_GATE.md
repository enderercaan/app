# Tailmance Mobile App Integrity Gate

Status: **RELEASE BLOCKER UNTIL PLATFORM ATTESTATION IS VERIFIED END TO END**

Tailmance does not treat local root, jailbreak, debugger, or emulator heuristics as an authorization boundary. Those signals are easy to bypass, create false positives on legitimate devices, and can lock out accessibility/testing environments. The release trust boundary is server-verified platform attestation:

- **Android:** Google Play Integrity, Standard request flow. The app obtains an integrity token for sensitive server interactions; the backend verifies the verdict and applies policy to high-risk actions.
- **iOS:** Apple App Attest. A per-installation/device key is generated, attested using a server challenge, persisted by identifier, and then used to sign fresh server challenges. The backend validates the attestation/assertion and replay properties.

## Required production evidence

Before a market release, `release/external-security-evidence.json` must contain dated evidence for both platforms. Evidence must show the production package/bundle identity, expected signing/distribution path, a valid verdict from a genuine physical device, rejected/tightly limited invalid or replayed assertions, and safe fallback behavior for genuinely unsupported App Attest devices.

## Enforcement strategy

Attestation is **risk based**, not a blanket “device purity” ban. Login/account recovery must not become unrecoverable merely because an integrity service is temporarily unavailable. High-risk write operations, abuse-prone automation paths, privileged moderation/admin access, and anomalous sessions should receive the strictest integrity policy. Server-side authorization, RLS, MFA, rate limiting and audit logs remain mandatory even after attestation is enabled.

## Explicit non-solutions

Tailmance will not claim security merely because it detects common root/jailbreak files, checks a debugger flag, or blocks emulators. Such checks may be used only as secondary telemetry after privacy review; they must never replace cryptographically verified server-side authorization.
