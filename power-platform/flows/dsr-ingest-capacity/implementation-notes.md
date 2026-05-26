# Ingest Dataverse storage capacity — implementation notes

This folder is the blueprint for the cloud flow that populates the `dsr_environment`,
`dsr_storagesnapshot`, and `dsr_tenantpool` tables.

## Triggers

Two:

1. **Recurrence** — daily at 03:00 UTC. Pull the full tenant on a schedule.
2. **When an HTTP request is received** — used by the "Refresh now" button in the React
   code app. Copy the URL that Power Automate returns after first save and put it in
   `VITE_REFRESH_FLOW_URL` for the deployed app. The button posts an empty body. The
   request branch should call the same downstream actions as the schedule branch.

## Required app-registration permissions

The Entra app behind `dsr_AdminClientId` / `dsr_AdminClientSecret` must be able to read
Power Platform BAP admin APIs. Grant ONE of:

- Assign the **Service Administrator** Azure RBAC role on the tenant to the service
  principal, then run (PowerShell):

  ```powershell
  Add-PowerAppsAccount
  New-PowerAppManagementApp -ApplicationId <dsr_AdminClientId>
  ```

  This registers the app as a Power Platform management app so it can call
  `api.bap.microsoft.com/.../admin/...` endpoints with client credentials.

- OR assign the **Power Platform Administrator** Entra role to a service principal
  account (less common; requires extra licensing setup).

Without either, the ingest flow's first HTTP call (or the BAP calls themselves) will
return 401/403.

## API endpoints used

All against `https://api.bap.microsoft.com` with the admin scope.

| Purpose | Method | Path |
|---|---|---|
| List environments | GET | `/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments?api-version={ver}` |
| Per-env capacity   | GET | `/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/{id}/capacityConsumption?api-version={ver}` |
| Tenant pool        | GET | `/providers/Microsoft.BusinessAppPlatform/scopes/admin/tenantCapacity?api-version={ver}` |

> The exact JSON shape of `capacityConsumption` has changed over time and varies a bit
> by tenant SKU. The blueprint uses field paths under
> `properties.dataverseCapacityConsumption.{database,file,log,payAsYouGo,overageGb}`.
> Inspect a sample response in your tenant first and adjust the `Compose` and `Add row`
> field expressions if a path differs. The flow is intentionally split so that
> changing field paths is a one-place edit.

## PayGo detection

An environment is treated as PayGo when EITHER:

- `properties.billingPolicy.billingPolicyType` equals `PayAsYouGo` on the environment
  record, OR
- `dataverseCapacityConsumption.payAsYouGo.enabled` is true on the capacity record.

The current consumption (`currentConsumptionGb`) goes into `dsr_paygoconsumptiongb`.
Any non-zero value triggers the PayGo flag in the report UI.

## Retention

Old snapshots are pruned to `dsr_HistoryRetentionDays` (default 90) at the end of each
run. The report UI uses only the latest snapshot per environment.

## Connection setup

The flow only needs the Dataverse connector. The BAP API is called via the generic HTTP
connector with a bearer token obtained inline against
`https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` using the
client-credentials grant and the app registration's client secret stored in the
`dsr_AdminClientSecret` environment-variable secret.
