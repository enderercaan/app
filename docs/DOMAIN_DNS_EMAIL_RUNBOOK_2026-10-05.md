# Tailmance domain, app links, legal pages and e-mail reputation (2026-10-05)

Operator: Yekta Özel. Replace `<domain>` with the registered domain (for example `tailmance.com`). Nothing here is deployed yet; the domain name and every account step below belong to the operator.

## 1. What already exists in the repository
| Item | Where |
|---|---|
| Static site (legal pages, delete-account, support, auth challenge) | `web/` |
| Security headers (CSP, HSTS, nosniff, no-store for `config.js`) and JSON content type for the two `.well-known` files | `web/_headers` (Cloudflare Pages / Netlify format) |
| Landing page for `/` | `web/index.html` |
| Universal Links / App Links paths `/pet/*`, `/reel/*`, `/story/*`, scheme `tailmance` | `app.config.ts` |
| Association files generator (needs real Team ID and signing fingerprints) | `npm run generate:app-links`, checked by `npm run release:app-links` |
| Account deletion without a third-party form service | `web/delete-account.html` plus the `request-account-deletion` Edge Function |
| Read-only live check of all of the above | `scripts/verify-domain-setup.sh <domain> [dkim-selector]` |

## 2. Choose and register the domain
- Recommended: `<name>.com` (store reviewers, users and mail providers trust it most). `.app` is a good second choice (HTTPS-only by design). `.com.tr` only if a Turkish presence is wanted in addition.
- Register at a registrar whose DNS you will use (Cloudflare Registrar is the simplest because hosting and DNS are in the same place). Turn on registrar lock and two-factor sign-in.
- The domain must be a bare host name. It is the value of `EXPO_PUBLIC_APP_LINK_HOST` (no `https://`, no path, no `www.`).

## 3. Hosting: Cloudflare Pages (not GitHub Pages)
`web/_headers` is a Cloudflare Pages / Netlify file. GitHub Pages ignores it and cannot set the CSP, HSTS and content-type headers that `scripts/security-checks.mjs` requires, so use Cloudflare Pages.
1. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repository, build command empty, output directory `web`.
2. Build command (Node 22, no dependencies needed): `node scripts/generate-web-runtime-config.mjs && node scripts/generate-app-link-associations.mjs`. Set these as build environment variables in the Pages project, never in the repository: `TAILMANCE_WEB_DELETION_ENDPOINT` (the `request-account-deletion` Edge Function URL), `TAILMANCE_WEB_TURNSTILE_SITE_KEY`, `TAILMANCE_WEB_AUTH_TURNSTILE_SITE_KEY`, `EXPO_PUBLIC_APP_LINK_HOST`, `APPLE_TEAM_ID`, `ANDROID_APP_LINK_CERT_SHA256`. Both scripts refuse placeholder or malformed values, so a wrong value fails the build instead of shipping a broken site. The committed `web/config.js` is intentionally empty; the build overwrites it.
3. Pages project → Custom domains → add `<domain>` and `www.<domain>`. If DNS is on Cloudflare the records are created for you.

DNS records that matter (other records are created by the Pages wizard):
| Type | Host | Value | Purpose |
|---|---|---|---|
| CNAME (flattened) | `@` | `<project>.pages.dev` | site |
| CNAME | `www` | `<project>.pages.dev` | site |
| TXT | `@` | `v=spf1 include:<sending-provider> -all` | SPF; one record only, value comes from the provider that sends your mail (section 4) |
| TXT | `<selector>._domainkey` | value given by the sending provider | DKIM |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@<domain>; adkim=s; aspf=s` | DMARC, monitoring first |
| MX | `@` | per inbound mail provider | support inbox |

The GitHub Pages A records and the `deferred-deep-link` Worker CNAME from the generic guide are not used.

## 4. E-mail
- Receiving `support@<domain>`: Cloudflare Email Routing (free) forwards to the operator's inbox. After it works, replace the personal address in `web/support.html`, the privacy pages and the store forms with the support address, then regenerate the legal evidence chain.
- Sending (sign-up, OTP, password reset from Supabase Auth): configure custom SMTP in the Supabase dashboard (Authentication → SMTP) with a transactional provider; the provider's own DKIM and SPF values go into the table above. The generic guide's `include:_spf.mx.cloudflare.net` only covers Cloudflare Email Routing, which does not send mail.
- DMARC: start at `p=none`, read the aggregate reports for two to four weeks, then `p=quarantine; pct=25`, then `pct=100`, then `p=reject`. Going straight to `reject` before every sender is aligned drops legitimate mail.
- Add Google Search Console / Play Console ownership TXT records when those consoles ask for them.

## 5. Association files and app configuration
Inputs (all from the operator's accounts):
- `EXPO_PUBLIC_APP_LINK_HOST=<domain>`
- `APPLE_TEAM_ID` (Apple Developer → Membership, 10 characters)
- `ANDROID_APP_LINK_CERT_SHA256` (Play Console → Setup → App signing → "App signing key certificate" SHA-256; add the upload key too if testing sideloaded builds; at most five, comma separated)

Commands: `npm run generate:app-links`, then `npm run release:app-links`. The generated AASA contains `<TeamID>.tailmanceapp.wordpress.com` with `/pet/*`, `/reel/*`, `/story/*`; assetlinks contains package `tailmanceapp.wordpress.com`. Neither file may be redirected, and both must be served as `application/json` (the `_headers` rules do this). Apple caches AASA on its CDN, so a first publish can take hours to show up.

Store entries:
- App Store Connect → App Privacy → Privacy Policy URL: `https://<domain>/privacy.html`; Support URL: `https://<domain>/support.html`.
- Play Console → App content → Privacy policy: `https://<domain>/privacy.html`; Data safety → Account deletion URL: `https://<domain>/delete-account.html`.
- Supabase Auth → URL configuration: Site URL and redirect allow-list use `https://<domain>` and the `tailmance://` scheme; Cloudflare Turnstile site key hostnames include `<domain>`.

## 6. Verify
`scripts/verify-domain-setup.sh <domain> [dkim-selector]` checks DNS, TLS and headers, the six store-required pages, `config.js`, AASA and assetlinks (status, content type, no redirect, Team ID, paths, fingerprint, Apple CDN, Google Digital Asset Links API), SPF, DKIM, DMARC and MX. It makes only GET, HEAD and DNS requests. On a device: `adb shell pm get-app-links tailmanceapp.wordpress.com` (Android) and an Associated Domains test link from Notes (iOS).

## 7. Deliberately not adopted from the generic guide
| Item | Reason |
|---|---|
| Firebase, AppsFlyer, Adjust, AdMob, SKAdNetwork, Install Referrer SDK | Tailmance contains none of them and its privacy texts, store privacy answers and tests assume no advertising or attribution SDK. Adding one would require new consent flows, ATT, store privacy updates and legal text in 22 languages. |
| Deferred deep link by IP + user-agent fingerprint in a Worker | Probabilistic tracking of people before they have an account; needs consent under KVKK and GDPR and is not disclosed in the privacy notice. Install → open already lands on the home screen; invite links can be added later with a code the user types or a Play referrer without fingerprinting. |
| Writing link data to the clipboard from a web page | iOS shows a paste warning on every read and it looks like hidden tracking. |
| Third-party form service for deletion (Formspree) | Sends identifiers to another processor and bypasses identity checks; the Edge Function flow already exists. |
| Third-party QR image service (`api.qrserver.com`) | Leaks the page URL to a third party and breaks the page's CSP. |
| Click-injection rules, MMP contract clauses, BigQuery fraud query | Only meaningful with paid acquisition through a mobile measurement partner; revisit if ads are bought later. |
| Native Swift/Kotlin snippets | The app is Expo/React Native; link handling is configured in `app.config.ts` and the router. |
