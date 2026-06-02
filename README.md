# Dataverse Storage Report

A React + TypeScript code app, packaged as a Power Platform code-app asset, that
delivers a usable replacement for the **Power Platform admin center → Dataverse
capacity** page.

The built-in admin page has these problems this tool fixes:

1. It marks an environment "Within capacity" if **Database** storage is OK, even when
   **File** or **Log** storage is over allocation.
2. It marks PayGo (pay-as-you-go) environments "Within capacity" even when they are
   accruing overage charges and the tenant has unallocated pool capacity that could
   be used instead.
3. It is not exportable and clutters the list with Teams and Developer environments.
4. It does not distinguish standalone-licensed environment types (Developer, Teams,
   Trial), which do **not** draw from the tenant pool, from those that do.

## What this app shows

- One row per environment: **Database**, **File**, and **Log** usage with
  per-cell color coding — green below the warning threshold, yellow at warning,
  red at over capacity — so you can see *which* dimension is the problem.
- A separate **PayGo** flag for any environment with non-zero PayGo Dataverse
  consumption, so you can decide whether to allocate from the tenant pool in a
  controlled way.
- A **Status** column rolling up "OK / Warning / Over capacity" using configurable
  thresholds (defaults: 80 % warn, 100 % critical, PayGo consumption always
  escalates to Over).
- A **Triggered by** column listing which dimensions caused the status.
- **Owner** name + email, resolved from Microsoft Graph (BAP scrubs PII so the
  flow re-hydrates these from `createdBy.id`).
- A **Standalone** badge under environment Type for Developer / Teams / Trial
  environments, which use per-license storage and do **not** consume the tenant
  pool.
- A tenant-pool summary card for **Database / File / Log** with total allocated,
  available to allocate, and PayGo accruing across the tenant.
- **Default filter:** Production + Sandbox only. Teams, Developer, Default, Trial,
  and Unknown environment types are hidden by default but toggleable.
- **Only pool-impacting** filter: hide standalone environments (default off).
- **Only triggered** filter: show only Warning + Over capacity rows.
- **CSV export** of the currently filtered/sorted view.
- A **Last updated** indicator showing the most recent snapshot timestamp.

## Architecture

```
                 ┌──────────────────────────────────────────────────┐
                 │  Microsoft Graph    /v1.0/users/{id}             │
                 │  (owner display name + email)                    │
                 └──────────────────────────────────────────────────┘
                                  ▲
                                  │ User.Read.All (App)
                                  │
   ┌──────────────────────────┐   │   ┌────────────────────────────┐
   │ Power Automate flow      │───┼──▶│ Dataverse                  │
   │ dsr_ingestdataversecap.  │   │   │   dsr_environment          │
   │ Recurrence (daily)       │   └──▶│   dsr_storagesnapshot      │
   │ Service principal +      │       │   dsr_tenantpool           │
   │ env-var secret retrieved │       │   dsr_setting              │
   │ at runtime               │       └────────────────────────────┘
   └─────┬────────────────────┘                       ▲
         │ BAP / licensing admin APIs                 │
         ▼                                            │ OData via MSAL token
   api.bap.microsoft.com                              │
   licensing.bap.microsoft.com                        │
                                                      │
                              ┌───────────────────────┴──────────────┐
                              │ React code app (this repo)           │
                              │ pac code push → CanvasApp solution   │
                              │ component                            │
                              └──────────────────────────────────────┘
```

The flow does the BAP/licensing API calls (which need a Power Platform admin
service principal). The app reads the Dataverse cache so end users do not need
admin API access — only a Dataverse role granting read on the four `dsr_` tables.

## Local development

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Default mode is `mock` and ships with seeded environments so the UI is fully
explorable offline. Switch to live Dataverse via:

```env
VITE_AUTH_MODE=msal
VITE_DATAVERSE_URL=https://<your-org>.crm.dynamics.com
VITE_ENTRA_CLIENT_ID=<sign-in app registration ID>
VITE_ENTRA_TENANT_ID=<your tenant ID>
```

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — type-check + production build
- `npm run lint` — ESLint
- `npm run preview` — preview the production build locally

## Status logic

Per environment, against the latest snapshot:

| Condition | Status |
|---|---|
| Any of DB / File / Log usage ≥ `criticalPercent` (default 100 %) | **Over** (red) |
| PayGo enabled AND any non-zero PayGo Dataverse consumption       | **Over** (red) |
| Any of DB / File / Log usage ≥ `warnPercent` (default 80 %)      | **Warn** (yellow) |
| Otherwise                                                        | **OK** (green) |

Thresholds are editable in the in-app **Settings** tab and persist to `dsr_setting`.

Standalone environment types (Developer / Teams / Trial) get the same per-cell
coloring but a **standalone** label under the dimension cells when they have no
allocated quota — they cannot draw from the tenant pool.

## Power Platform packaging

- Solution metadata (tables, env-var defs, workflows, canvas-app reference) lives
  in [`power-platform/solution/src/`](./power-platform/solution/src/) — packed
  via `pac solution pack` for import.
- Tooling and developer notes: [`power-platform/README.md`](./power-platform/README.md).
- End-to-end install / configure walkthrough: [`SETUP.md`](./SETUP.md).
