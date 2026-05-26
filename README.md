# Dataverse Storage Report

A React + TypeScript code app, packaged as a Power Platform code-app asset, that
delivers a usable replacement for the **Power Platform admin center Dataverse
capacity** page.

The built-in admin page has three problems this tool fixes:

1. It marks an environment "Within capacity" if **Database** storage is OK, even when
   **File** or **Log** storage is over allocation.
2. It marks PayGo (pay-as-you-go capacity) environments "Within capacity" even when
   they are accruing overage charges and the tenant has unallocated pool capacity that
   could be used instead.
3. It is not exportable and clutters the list with Teams and Developer environments.

## What this app shows

- One row per environment: Database, File, and Log usage with **per-cell color
  coding** (green below the warning threshold, yellow above it, red at over capacity)
  so it is obvious *which* storage dimension is the problem.
- A separate **PayGo** flag for any environment with non-zero PayGo Dataverse
  consumption, so you can decide whether to allocate from the tenant pool in a
  controlled way.
- A **Status** column rolling up "OK / Warning / Over capacity" using configurable
  thresholds (defaults 80% / 100%, and PayGo always escalates to Over).
- A **Triggered by** column listing which dimensions caused the status.
- A tenant-pool summary card with total allocated, available to allocate, and PayGo
  accruing across the tenant.
- **Default filter**: Production + Sandbox only. Teams, Developer, Default, Trial, and
  Unknown environment types are hidden by default but toggleable.
- **CSV export** of the currently filtered/sorted view.
- **Refresh now** button that triggers the ingest flow on demand.

## Architecture

```
┌─────────────────────────────┐      ┌──────────────────────────────────────────┐
│ Power Automate ingest flow  │ ───▶ │ Dataverse (dsr_environment,              │
│ (nightly + HTTP-triggered)  │      │            dsr_storagesnapshot,          │
│ calls api.bap.microsoft.com │      │            dsr_tenantpool, dsr_setting)  │
└─────────────────────────────┘      └──────────────────────────────────────────┘
              ▲                                          ▲
              │ POST (Refresh now)                       │ OData via MSAL token
              │                                          │
              └────────── React code app (this repo) ────┘
```

The flow does the BAP API calls (which need a Power Platform management app
registration). The app reads the Dataverse cache so end users do not need admin API
access.

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
VITE_DATAVERSE_URL=https://bprocidatest.crm.dynamics.com
VITE_ENTRA_CLIENT_ID=23426e2c-3cec-48de-8c53-bfe366373c1e
VITE_ENTRA_TENANT_ID=1557f771-4c8e-4dbd-8b80-dd00a88e833e
VITE_REFRESH_FLOW_URL=<HTTP-trigger URL of the ingest flow>
```

## Scripts

- `npm run dev` — Vite dev server
- `npm run build` — type-check + production build
- `npm run lint` — ESLint

## Power Platform packaging

See [`power-platform/README.md`](./power-platform/README.md) for solution setup,
required app-registration permissions, deploy steps, and the cloud-flow blueprint.

## Status logic

Per environment, against the latest snapshot:

| Condition | Status |
|---|---|
| Any of DB / File / Log usage ≥ `criticalPercent` (default 100%) | **Over** (red) |
| PayGo enabled AND any non-zero PayGo Dataverse consumption | **Over** (red) |
| Any of DB / File / Log usage ≥ `warnPercent` (default 80%) | **Warn** (yellow) |
| Otherwise | **OK** (green) |

Thresholds are editable in the in-app Settings tab and persisted to `dsr_setting`.
