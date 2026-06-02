# Setup guide

End-to-end walkthrough for installing the Dataverse Storage Report into a new
target environment.

## Prerequisites

| Tool / role                                 | Why                                                                |
|---------------------------------------------|--------------------------------------------------------------------|
| **Power Platform Admin** role               | Register a service principal as a Power Platform management app.   |
| **Application Administrator** (Entra)       | Create the two app registrations and grant admin consent.          |
| **Dataverse System Administrator** in the target env | Import the solution and assign security roles.            |
| Node.js ≥ 20 + npm                          | Build the React code app.                                          |
| .NET 10 SDK                                 | Run the `tools/*` provisioners.                                    |
| Power Platform CLI (`pac`) ≥ latest         | `pac auth`, `pac solution`, `pac code`.                            |
| PowerShell 7+ with `Microsoft.PowerApps.Administration.PowerShell` | Register the management app. |

## Step 1 — Create the two app registrations

You need **two** Entra (Azure AD) app registrations.

### 1a. DSR Admin App (used by the flow as a service principal)

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
5. **Register it as a Power Platform management app** so the BAP admin endpoints
   accept its tokens. From an elevated PowerShell window, signed in as a Power
   Platform admin:

   ```powershell
   Install-Module -Name Microsoft.PowerApps.Administration.PowerShell -Scope CurrentUser
   Add-PowerAppsAccount
   New-PowerAppManagementApp -ApplicationId <DSR Admin App client ID>
   ```

   This is **the** step people miss. Without it, every BAP call returns 401.

### 1b. DSR Sign-in App (used by the React app for end-user login)

This is the public client users sign in with so the app can read Dataverse on
their behalf.

1. Entra portal → **App registrations → New registration** → name
   `Dataverse Storage Report`.
2. **Authentication → Add a platform → Single-page application**. Add redirect
   URIs:
   - `http://localhost:3000` (local dev)
   - `https://apps.powerapps.com/play/e/<environmentId>/app/<canvas-app GUID>` —
     fill in after Step 5.
3. **API permissions → Add → Dynamics CRM →** *Delegated* →
   `user_impersonation`. Grant admin consent.
4. Note the client ID — this is `VITE_ENTRA_CLIENT_ID` in the React app.

## Step 2 — Import the solution

Two paths — pick one:

### 2a. Quick install (prebuilt zip)

For users who just want to install without building from source. Both zips are
committed in `power-platform/solution/`:

| File                                       | When to use                                                     |
|--------------------------------------------|-----------------------------------------------------------------|
| `DataverseStorageReport_unmanaged.zip`     | Dev / customisation environments. Components are editable.     |
| `DataverseStorageReport_managed.zip`       | Production. Components are locked; uninstall removes cleanly.  |

```powershell
cd <repo root>
pac auth select --name <profile pointing at target env>
pac solution import `
  --path power-platform\solution\DataverseStorageReport_managed.zip `
  --activate-plugins `
  --publish-changes
```

### 2b. Build from source

For developers iterating on the solution shape. The solution source is in
`power-platform/solution/src/` — pack it, then import.

```powershell
cd <repo root>
pac auth select --name <profile pointing at target env>
pac solution pack `
  --zipfile power-platform\solution\DataverseStorageReport_unmanaged.zip `
  --folder  power-platform\solution\src `
  --packagetype Unmanaged
pac solution import `
  --path power-platform\solution\DataverseStorageReport_unmanaged.zip `
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

> **Secret env var quirk:** the secret value record (`environmentvariablevalue`)
> must live in the *same solution* as the definition for the flow's
> `RetrieveEnvironmentVariableSecretValue` action to find it. After setting the
> value, in the solution view click **+ Add existing → More → Environment
> variable value** and add the value record if it isn't already a member.

## Step 4 — Authorize the flow's Dataverse connection reference

The flow needs a Dataverse connection (used by the secret-fetch step), and that
connection must be authorized as a user with `read` on the env-var secret tables.

1. Solutions → Dataverse Storage Report → **Connection references** →
   `DSR Shared Dataverse`.
2. Click **+ New connection**, sign in with an account that has `System
   Administrator` (or any role granting read on
   `environmentvariablevalue` + `environmentvariabledefinition`).
3. Save the connection reference.

## Step 5 — Push the React code app

```powershell
cd <repo root>
npm install
npm run build
cd power-platform\code-app
pac code push
```

`power.config.json` already points at the test environment. Edit
`environmentId` (and the embedded `linkedEnvironmentMetadata`) before pushing
into a different org.

After the first push, copy the resulting **Play URL**
(`https://apps.powerapps.com/play/e/<envId>/app/<appId>`) and add it as a
redirect URI to the **Sign-in app** (Step 1b → Authentication).

## Step 6 — Turn on the flow

1. Solutions → Dataverse Storage Report → **Cloud flows** → "Ingest Dataverse
   storage capacity".
2. Confirm the recurrence trigger is set the way you want (default: every 24 h).
3. Click **Turn on**.
4. Click **Run** once to populate Dataverse immediately.

If a run fails:

- **401 from `api.bap.microsoft.com`** → service principal is not registered as
  a Power Platform management app (Step 1a.5).
- **403 from `graph.microsoft.com`** → `User.Read.All` permission missing or not
  admin-consented.
- **Secret resolves to literal string** → Step 3 quirk: the *value* record isn't
  in the solution.

## Step 7 — Share the app with end users

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
| Authorize the flow's Dataverse connection  | Any user with read on `environmentvariablevalue` (typically `System Admin`)  |
| End-user runs the report                   | Custom Dataverse role with read on the four `dsr_` tables (write on `dsr_setting`) |

## Updating after a release

When pulling new commits:

```powershell
git pull
npm install                 # if package-lock changed
npm run build
cd power-platform\code-app
pac code push               # pushes the latest React bundle
```

For changes that touched the flow:

```powershell
# Push the on-disk flow JSON back into Power Platform
dotnet run --project tools\FlowProvisioner -- --update
```

For changes that touched the solution schema (new column, new table, new env
var definition), pack and import the updated unmanaged solution:

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
