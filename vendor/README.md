# Vendored security patches

These tarballs replace dependencies whose published releases still carry a known advisory and have no fixed upstream version. They are wired in through `optionalDependencies` plus `overrides` (`$name`) in `package.json` and pinned with integrity hashes in `package-lock.json`.

| Package | Patched build | Advisory | Change |
|---|---|---|---|
| `node-forge` | `1.4.1-tailmance.1` | GHSA-86w9-cpqp-85rv | RSASSA-PKCS1-v1_5 verification now rejects a DigestAlgorithm SEQUENCE that has members beyond the OID and an empty NULL. Unused `dist/` bundles and Flash files are not shipped. |
| `braces` | `3.0.4-tailmance.1` | GHSA-vfj7-8cjw-p6xm | Brace nesting deeper than 128 raises `SyntaxError` instead of exhausting the call stack. |

Both packages are used only by the Expo / Metro build toolchain, not by the shipped app.

Maintenance rules:
1. `npm run test:vendored-security-patches` proves the patches still apply and behave.
2. When upstream publishes a fixed release, delete the entry from `optionalDependencies` and `overrides`, remove the tarball, run `npm install --package-lock-only`, and drop the matching block from `scripts/vendored-security-patch-checks.mjs`.
3. Never edit a tarball in place. Rebuild it from the upstream package, bump the `-tailmance.N` suffix and refresh the lockfile.
