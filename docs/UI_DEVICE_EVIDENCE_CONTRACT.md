# Physical-device execution evidence

The current `release/ui-e2e-evidence-v23.json` remains `not_verified`. Do not change a status before executing the corresponding journey on an actual device. An emulator run may be useful but does not satisfy this physical-device gate.

The gate requires exactly the three canonical records, their platform and immutable `required` lists, all referenced nonempty artifact files, and their actual SHA-256 hashes. Removing the matrix, duplicating records, setting a status alone, inventing hashes, changing the required list, or using a file outside the evidence root must fail. Symlinks escaping that root are rejected.

Each verified record needs an `execution` object with `result: passed`, `runner: Maestro`, `device_kind: physical_device`, actual `app_version`, `build_number`, ISO `started_at` and `completed_at`, and `devices` entries containing `platform`, `os_version`, and `device_id_sha256`. The golden record must identify both iOS and Android. Store only a salted identifier hash, not a raw device identifier.

Every item in `required` needs an `artifacts` entry of the same name: `{path: relative/path, sha256: actual_file_sha256}`. Keys ending in `_sha256` also need the matching top-level hash. Screenshot artifacts must be PNG files. Build artifacts, review-account confirmation without credentials, logs, approved image baselines, candidate image manifests, visual-diff reports and accessibility/dark-mode/RTL matrices must come from the actual run. Do not place passwords, tokens or raw personal identifiers in these files.

File hashes establish integrity, not authenticity. Execution provenance must come from a trusted device runner and an authorized reviewer. The synthetic fixtures in `critical-journey-checks.mjs` test validation behavior only. They are never production, native-build, physical-device or live-service evidence.

For non-Firebase Google sign-in builds, inject the real `GOOGLE_IOS_URL_SCHEME` (the Google reversed iOS client identifier). Alternatively inject the real Google service configuration files. The isolated bundle/prebuild validation used a clearly synthetic scheme and did not test Google login.
