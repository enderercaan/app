# Tailmance v19 External Legal / Store Release Evidence

Source controls can prove fail-closed behavior, but they cannot prove facts that exist only in production, a store console, a deployed website, a provider dashboard, a physical device, or a professional legal review. `release/external-legal-evidence.json` therefore starts all such items as `not_verified`, and `npm run release:external-legal` fails until each item has attributable evidence.

Required external evidence includes:

- counsel approval for every enabled country and the exact production provider/data-flow configuration;
- final professional legal localization for all enabled languages/markets;
- a live web account-deletion flow with production endpoint and independent identity verification;
- deployed support contact plus real operating-entity/business/address/tax details where required;
- App Store Connect age-rating questionnaire result and Apple App Privacy declaration;
- Google Play/IARC content-rating result and Data Safety declaration;
- DSA classification/required reporting analysis, UK Online Safety scope/children’s-access assessment, and Australia social-media-minimum-age scope/reasonable-steps evidence where applicable;
- international-transfer mechanism and any required local filings/notifications;
- live moderation provider plus human-review staffing/SLA;
- Google Play Target audience/content configured consistently with the 18+ product policy, plus any required Restrict Minor Access state;
- Google Play Data Safety account-deletion URL/questions pointing to the real live deletion flow;
- App Store Connect auto-renewable subscription multiseat purchase-option configuration reviewed against Tailmance's account-bound Premium entitlement model.

Evidence references must point to a real artifact such as counsel memo/version, console export/screenshot with date, production URL/run ID, provider dashboard event, signed filing/notification, or operational test record. Placeholder text, source-code presence, or a manually changed `verified` string without evidence is not sufficient.

Tailmance v19 is intentionally **NO-GO for production distribution** while any required external item remains unverified.
