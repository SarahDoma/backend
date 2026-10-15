# Feature flags

Experimental features are controlled by environment variables and read through
the typed `FeatureFlagsService`.

| Typed flag | Environment variable | Default  |
| ---------- | -------------------- | -------- |
| `feeBump`  | `FEATURE_FEE_BUMP`   | disabled |
| `indexer`  | `FEATURE_INDEXER`    | disabled |

Only the case-insensitive value `true` enables a flag. Missing values and
all other values are disabled. Inject `FeatureFlagsService` and call
`isEnabled('feeBump')` or `isEnabled('indexer')`; invalid names are rejected
by TypeScript.
