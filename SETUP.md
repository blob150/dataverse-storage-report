# Setup guide

End-to-end walkthrough for installing the Dataverse Storage Report into a new
target environment.

## Prerequisites

| Tool / role                                 | Why                                                                |
|---------------------------------------------|--------------------------------------------------------------------|
| **Power Platform Admin** role               | Register a service principal as a Power Platform management app.   |
| **Application Administrator** (Entra)       | Create the admin app registration and grant admin consent.        |
| **Dataverse System Administrator** in the target env | Import the solution and assign security roles.            |
| Node.js ≥ 20 + npm                          | Build the React code app.                                          |
| .NET 10 SDK                                 | Run the `tools/*` provisioners.                                    |
| Power Platform CLI (`pac`) ≥ latest         | `pac auth`, `pac solution`.                                        |
| PowerShell 7+ with `Microsoft.PowerApps.Administration.PowerShell` | Register the management app. |

## Step 1 — Create the admin app registration

You need **one** Entra (Azure AD) app registration. The React code app itself
does **not** need its own app registration — it runs inside the Power Apps
host (`apps.powerapps.com`) and authenticates to Dataverse using the
signed-in user's identity (`VITE_AUTH_MODE=powerapps`). The single app reg
below is only used by the ingest flow's service principal.

### DSR Admin App (used by the ingest flow as a service principal)

This identity makes the BAP / licensing / Microsoft Graph calls inside the flow.

1. Entra portal → **App registrations → New registration** → name
   `DSR Admin App`. No redirect URI needed.
2. Note the **Application (client) ID** → this is `dsr_AdminClientId`.
3. **Certificates & secrets → New client secret**. Copy the **Value** — this is
   `dsr_AdminClientSecret`. You'll paste it into Dataverse in Step 4.
4. **API permissions**:
   - **Microsoft Graph** → *Application permissions* → **`User.Read.All`**
     (or the narrower `User.ReadBasic.All`).
   - Click **Grant admin consent**.

   > **What about BAP and Power Platform Licensing?** The flow also calls
   > `api.bap.microsoft.com` and `licensing.powerplatform.microsoft.com`.
   > These are first-party tenant-admin APIs that **do not appear in the
   > Entra "Add API permissions" picker**. Access is granted by the
   > management-app registration in step 5 below — not by adding API
   > permissions here.

5. **Register it as a Power Platform management app** so the BAP and
   licensing endpoints accept its tokens. From an elevated PowerShell window,
   signed in as a Power Platform admin:

   ```powershell
   Install-Module -Name Microsoft.PowerApps.Administration.PowerShell -Scope CurrentUser
   Add-PowerAppsAccount
   New-PowerAppManagementApp -ApplicationId <DSR Admin App client ID>
   ```

   This is **the** step people miss. Without it, every BAP and licensing
   call returns 401.

> **Does the service principal need a Dataverse application user / role?**
> No. The flow uses the SP only for outbound HTTP calls to BAP, Licensing,
> and Graph. All Dataverse reads/writes go through the `shared_commondataserviceforapps`
> connection (a user-authorized connection — see Step 4). You do **not**
> need to create an application user or assign a Dataverse security role
> for the SP in the target environment.

## Step 2 — Import the solution

Two paths — pick one:

### 2a. Quick install (download from Releases)

For users who just want to install without building from source:

1. Go to the repo's **Releases** page:
   - https://github.com/blob150/dataverse-storage-report/releases
2. Download the latest `DataverseStorageReport_unmanaged.zip`.
3. Import it:

   ```powershell
   pac auth select --name <profile pointing at target env>
   pac solution import `
     --path .\DataverseStorageReport_unmanaged.zip `
     --activate-plugins `
     --publish-changes
   ```

> **Want a managed zip?** The release pipeline ships only the unmanaged
> solution because the canonical source under `power-platform/solution/src/`
> is unmanaged. To produce a managed zip, import the unmanaged zip into a
> dedicated **build environment** and export it from there as managed —
> this matches Microsoft's recommended ALM flow.

### 2b. Build from source

For developers iterating on the solution shape. Source is in
`power-platform/solution/src/` — pack it, then import.

```powershell
cd <repo root>
pac auth select --name <profile pointing at target env>
pac solution pack `
  --zipfile DataverseStorageReport_unmanaged.zip `
  --folder  power-platform\solution\src `
  --packagetype Unmanaged
pac solution import `
  --path .\DataverseStorageReport_unmanaged.zip `
  --activate-plugins `
  --publish-changes
```

Either path creates the four `dsr_` tables, the five environment variable
*definitions*, the cloud flow (as a draft), and the canvas-app placeholder.

> If you'd rather provision tables imperatively the first time (e.g. when
> developing against a fresh org), `dotnet run --project tools\DataverseProvisioner`
> is equivalent.

## Step 3 — Configure environment variable values

In the maker portal → **Solutions → Dataverse Storage Report → Environment
variables**, set the **Current Value** for each:

| Display name                | Value                                                       |
|-----------------------------|-------------------------------------------------------------|
| DSR Tenant ID               | Entra tenant GUID of the target tenant                      |
| DSR Admin Client ID         | Step 1a client ID                                           |
| DSR Admin Client Secret     | Step 1a secret value (this is the Secret-typed env var)     |
| DSR BAP API Version         | `2022-05-01`                                                |
| DSR History Retention Days  | e.g. `90`                                                   |

## Step 4 — Authorize the flow's Dataverse connection reference

Every Dataverse read and write the flow performs (fetching the secret value,
listing existing snapshots, creating/updating/deleting `dsr_` records) goes
through one shared Dataverse connection. That connection runs under the
identity of whoever signs in here.

1. Solutions → Dataverse Storage Report → **Connection references** →
   `DSR Shared Dataverse`.
2. Click **+ New connection**, sign in with an account that has, in the target
   environment:
   - **Read** on `environmentvariabledefinition` and `environmentvariablevalue`
     (so the secret-fetch action works).
   - **Create / Read / Write / Delete** on the four `dsr_` tables
     (`dsr_environment`, `dsr_storagesnapshot`, `dsr_tenantpool`, `dsr_setting`).

   The **System Administrator** role covers all of this out of the box. For
   tighter scopes, create a custom role with just those privileges.
3. Save the connection reference.

## Step 5 — Turn on the flow

1. Solutions → Dataverse Storage Report → **Cloud flows** → "Ingest Dataverse
   storage capacity".
2. Confirm the recurrence trigger is set the way you want (default: every 24 h).
3. Click **Turn on**.
4. Click **Run** once to populate Dataverse immediately.

If a run fails:

- **401 from `api.bap.microsoft.com` or `licensing.powerplatform.microsoft.com`**
  → service principal is not registered as a Power Platform management app
  (Step 1, item 5).
- **403 from `graph.microsoft.com`** → `User.Read.All` permission missing or not
  admin-consented.

## Step 6 — Share the app with end users

1. Apps → **Dataverse Storage Report** → **Share**.
2. Assign a Dataverse security role that grants:
   - **Read** on `dsr_environment`, `dsr_storagesnapshot`, `dsr_tenantpool`.
   - **Read + Write** on `dsr_setting` (so admins can edit thresholds in the app's
     Settings tab).

Out-of-the-box the **System Administrator** role works; for narrower distribution
create a custom role copying just those table privileges.

## Permissions matrix (cheat sheet)

| Action                                     | Who needs what                                                                |
|--------------------------------------------|-------------------------------------------------------------------------------|
| Import solution / publish customisations   | Dataverse **System Administrator** in target env                              |
| Register management app                    | **Power Platform Administrator** (tenant role)                                |
| Grant Graph `User.Read.All` admin consent  | **Application Administrator** or **Global Administrator** (Entra)            |
| Authorize the flow's Dataverse connection  | A real user with read on env-var tables and CRUD on the four `dsr_` tables (System Admin works) |
| End-user runs the report                   | Custom Dataverse role with read on the four `dsr_` tables (write on `dsr_setting`) |

## Updating after a release

To pick up a new release, import the latest unmanaged zip from the
[Releases page](https://github.com/blob150/dataverse-storage-report/releases)
on top of the existing solution:

```powershell
pac auth select --name <profile pointing at target env>
pac solution import `
  --path .\DataverseStorageReport_unmanaged.zip `
  --force-overwrite `
  --publish-changes
```

This refreshes the canvas-app bundle, the flow definition, schema changes,
and any new env-var definitions in one step. No separate `pac code push`
is needed — the React bundle ships inside the solution zip.

For developers iterating on the flow definition locally:

```powershell
# Push the on-disk flow JSON back into Power Platform
dotnet run --project tools\FlowProvisioner -- --update
```

For developers iterating on the solution schema, pack and import from source:

```powershell
pac solution pack `
  --zipfile power-platform\solution\DataverseStorageReport.zip `
  --folder  power-platform\solution\src `
  --packagetype Unmanaged
pac solution import `
  --path power-platform\solution\DataverseStorageReport.zip `
  --force-overwrite `
  --publish-changes
```
