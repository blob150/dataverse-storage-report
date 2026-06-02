# Power Platform packaging

This folder is the source of truth for everything that lives in the Dataverse
solution: tables, environment variable definitions, the cloud flow, and the
canvas-app reference for the React code app.

## Layout

```
power-platform/
├── code-app/
│   └── power.config.json              # `pac code` metadata (envId, appId, …)
├── flows/
│   └── dsr-ingest-capacity/
│       └── flow-definition.json       # canonical flow JSON (workflow.clientdata)
└── solution/
    ├── DataverseStorageReport.zip     # exported solution (gitignored)
    └── src/                           # `pac solution unpack` output, committed
        ├── CanvasApps/                # canvas-app metadata (bundle gitignored)
        ├── Entities/                  # dsr_Environment, dsr_StorageSnapshot, …
        ├── Workflows/                 # workflow XML (clientdata mirrors flow JSON)
        ├── environmentvariabledefinitions/
        ├── Other/Solution.xml
        └── Other/Customizations.xml
```

The exported `.zip` is gitignored — rebuild it from `src/` with
`pac solution pack` whenever you need an importable artifact.

## Dataverse tables

All tables use the `dsr` (Dataverse Storage Report) publisher prefix.

| Table              | Entity set              | Key columns                                                                                                             |
|--------------------|-------------------------|-------------------------------------------------------------------------------------------------------------------------|
| Environment        | `dsr_environments`      | `dsr_environmentguid` (alt key), `dsr_displayname`, `dsr_type`, `dsr_region`, `dsr_owneremail`, `dsr_ownername`, `dsr_billingmodel`, `dsr_paygosubscriptionid`, `dsr_url` |
| Storage snapshot   | `dsr_storagesnapshots`  | lookup `dsr_environment`, `dsr_capturedat`, `dsr_db{allocated,used}gb`, `dsr_file{allocated,used}gb`, `dsr_log{allocated,used}gb`, `dsr_paygoenabled`, `dsr_paygoconsumptiongb`, `dsr_overagegb` |
| Tenant pool        | `dsr_tenantpools`       | `dsr_capturedat`, per-dimension `dsr_total{allocated,used}gb`, `dsr_availablegb`, `dsr_paygoaccrualgb`                  |
| Setting            | `dsr_settings`          | `dsr_warnpercent`, `dsr_criticalpercent`, `dsr_defaultenvironmenttypes` (CSV)                                           |

## Environment variables

All five live in the solution under `environmentvariabledefinitions/`. The
display name is what shows in dynamic-content pickers; the schema name is what
appears in `parameters('Display Name (schema_name)')` references.

| Display name                | Schema name              | Type    | Notes                                                              |
|-----------------------------|--------------------------|---------|--------------------------------------------------------------------|
| DSR Tenant ID               | `dsr_TenantId`           | String  | Entra tenant GUID                                                  |
| DSR Admin Client ID         | `dsr_AdminClientId`      | String  | App registration ID for the flow's service principal              |
| DSR Admin Client Secret     | `dsr_AdminClientSecret`  | Secret  | Read at runtime via `RetrieveEnvironmentVariableSecretValue` action |
| DSR BAP API Version         | `dsr_BapApiVersion`      | String  | e.g. `2022-05-01`                                                  |
| DSR History Retention Days  | `dsr_HistoryRetentionDays` | Number | How many days of `dsr_storagesnapshot` rows to retain              |

> **Secret env vars do not appear in the dynamic-content picker.** The flow uses
> a Dataverse "Perform an unbound action" → `RetrieveEnvironmentVariableSecretValue`
> action to fetch the secret at runtime, then references its output in every
> downstream HTTP action's secret field.

## Cloud flow

`flows/dsr-ingest-capacity/flow-definition.json` is the canonical workflow
clientdata. The flow:

1. **Recurrence trigger** — runs daily.
2. **Get_admin_secret** — Dataverse "Perform an unbound action"
   `RetrieveEnvironmentVariableSecretValue` for `dsr_AdminClientSecret`.
3. **List environments** — BAP `listEnvironments` (admin scope) using AAD client
   credentials with audience `https://api.bap.microsoft.com`.
4. **Tenant entitlements** — three calls to
   `licensing.bap.microsoft.com/.../entitlements/{Database|File|Log}`,
   upserted into `dsr_tenantpool`.
5. **Per-environment** (foreach, concurrency 20):
   - Three licensing calls per dimension (Database / File / Log) for that env.
   - Owner resolution: if `createdBy.id` is present, GET
     `https://graph.microsoft.com/v1.0/users/{id}?$select=displayName,mail,userPrincipalName`
     (returns 404 → falls back to `'System'`).
   - Upsert `dsr_environment` keyed by `dsr_environmentguid`.
   - Insert `dsr_storagesnapshot`.

Total: **8 HTTP actions + 1 Dataverse action**, all sharing the secret pulled in
step 2.

> **Authoring rule:** edit the flow either inside Power Automate (then run
> `tools/FlowProvisioner --pull` to capture the change back into source) or via
> `tools/flow-refactor.cjs` for deterministic shape changes — never both at once.

## Code app

`code-app/power.config.json` holds the per-environment binding (target environment
ID, canvas-app GUID, Dataverse instance URL, table data sources). Source for the
React app is `src/` at the repo root; build output (`dist/`) is what
`pac code push` packages.

## Tooling (`tools/` at repo root)

| Folder                       | Purpose                                                                                          |
|------------------------------|--------------------------------------------------------------------------------------------------|
| `DataverseProvisioner`       | One-time: creates `dsr` publisher, `DataverseStorageReport` solution, and the four tables.       |
| `EnvVarProvisioner`          | One-time: creates / updates the five env var definitions in the solution.                        |
| `FlowProvisioner`            | Pushes `flow-definition.json` as a solution-aware draft workflow. `--update` patches in place; `--pull` captures the live flow back to JSON; `--list-envvars` dumps display + schema names. |
| `flow-refactor.cjs`          | Deterministic transformer that rewrites the flow JSON (AAD auth, env-var parameters, owner branch). Run, then `FlowProvisioner --update`. |
| `CapacityProbe`              | Throwaway diagnostic for BAP / licensing responses. Output is gitignored.                        |
| `DataQuery`                  | Ad-hoc Dataverse queries for debugging.                                                          |

## Test environment

| Setting              | Value                                          |
|----------------------|------------------------------------------------|
| Tenant ID            | `1557f771-4c8e-4dbd-8b80-dd00a88e833e`         |
| Environment ID       | `e0c96096-913f-eec3-8454-d21f7b956608`         |
| Dataverse URL        | `https://bprocidatest.crm.dynamics.com/`       |
| Sign-in app reg.     | `23426e2c-3cec-48de-8c53-bfe366373c1e`         |
| Flow service prin.   | `1da66a9d-9252-4dee-9ee1-9437c3eafdb1`         |

For the end-to-end install/configure walkthrough, see
[`../SETUP.md`](../SETUP.md).
