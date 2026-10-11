---
description: "Workflow to refresh the models page catalog (providers.json) via the sync script"
---

# Model Data Sync (Updating the Models Page Catalog)

The models page add-model list is determined by local frontend files — **not** by any remote fetch at runtime:

- `frontend/src/features/models/data/providers.json` — the model catalog (models per developer, with cost/limit/release date).
- `frontend/src/features/models/data/constants.ts` — `DEVELOPER_IDS` whitelist: which developers appear in the add-model dialog (and `DEVELOPER_ICONS` when adding a new developer).
- `frontend/src/features/models/data/providers.ts` — `useDevelopersData()` (models page) reads only the local `providers.json`.

To update the model catalog with the latest model info, run the sync script:

```bash
cd scripts/sync && HTTPS_PROXY=http://localhost:7890 node sync-model-developers.js
```

The script:
1. Fetches the latest data from the upstream catalog (`ThinkInAIXYZ/PublicProviderConf` `dev` branch `dist/all.json`).
2. Filters providers by `DEVELOPER_IDS` from `constants.ts`, applying special mappings. To add a new developer, register it in `DEVELOPER_IDS` first.
3. Merges curated models from `scripts/sync/models.json`. For models not in the upstream catalog, add them to `scripts/sync/models.json`.
4. Sorts models by release date and rewrites `frontend/src/features/models/data/providers.json`.

After syncing:
- Rebuild and deploy per the Code Verification Workflow (`make build`, then `bash restart.sh`).
