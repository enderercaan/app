# Repository Tree Snapshot

```text
Tailmance/
├── App.tsx
├── app.config.ts
├── brand.ts
├── NOTICE.md
├── package.json
├── eas.json
├── assets/
├── docs/
├── fastlane/
├── languages/                 # native OS locale metadata, 19 locales
├── plugins/                   # Expo/native hardening config plugins
├── release/                   # fail-closed release/legal/security evidence registries
├── scripts/                   # offline/static QA, release and regression gates
├── src/
│   ├── components/
│   ├── contexts/
│   ├── data/
│   ├── domain/
│   ├── hooks/
│   ├── i18n/locales/          # runtime strings, 19 locales
│   ├── navigation/
│   ├── screens/
│   ├── services/
│   └── types/
├── supabase/
│   ├── functions/             # Edge Functions
│   └── migrations/            # canonical schema/security/product chain
└── web/                       # legal/support/deletion/AASA-related public surfaces
```

Full file-level tree is intentionally not duplicated in documentation because it drifts; `find . -type f | sort` is the canonical executable inventory command.
