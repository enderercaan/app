# Tailmance Golden Master Packager

The repository-root `build_project.py` is fail-closed.

- `python3 build_project.py` is the production-source path. It requires `package-lock.json`, local offline verification, release-structure verification, secret scanning, account-deletion route integrity, deterministic ZIP creation, and SHA-256 verification.
- `python3 build_project.py --handoff` creates a verified handoff archive but explicitly labels it `HANDOFF_ONLY_NOT_PRODUCTION_READY`.
- The packager never invents production/store/provider/device evidence.
- The existing Tailmance account-deletion implementation under `web/delete-account.*` is canonical; the packager validates it rather than replacing it with a weaker standalone form.
