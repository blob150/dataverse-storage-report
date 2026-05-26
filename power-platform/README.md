# Power Platform packaging notes

This app is a React SPA packaged as a Power Platform code-app asset, backed by
Dataverse tables that a Power Automate flow keeps up to date with data pulled
from the Power Platform BAP admin APIs.

## Build output

```powershell
npm run build
```

Vite emits relative asset paths because `vite.config.ts` sets `base: './'`, so the
build is portable from any code-app asset path.

## Dataverse tables

All tables use the `dsr` (Dataverse Storage Report) publisher prefix.

| Table | Entity set | Key columns |
|---|---|---|
| Environment        | `dsr_environments`      | `dsr_environmentguid` (alternate key), `dsr_displayname`, `dsr_type`, `dsr_region`, `dsr_owneremail`, `dsr_ownername`, `dsr_billingmodel`, `dsr_paygosubscriptionid`, `dsr_url` |
| Storage snapshot   | `dsr_storagesnapshots`  | lookup `dsr_environment`, `dsr_capturedat`, `dsr_dballocatedgb`, `dsr_dbusedgb`, `dsr_fileallocatedgb`, `dsr_fileusedgb`, `dsr_logallocatedgb`, `dsr_logusedgb`, `dsr_paygoenabled`, `dsr_paygoconsumptiongb`, `dsr_overagegb` |
| Tenant pool        | `dsr_tenantpools`       | `dsr_capturedat`, `dsr_totalallocatedgb`, `dsr_totalusedgb`, `dsr_availablegb`, `dsr_paygoaccrualgb` |
| Setting            | `dsr_settings`          | `dsr_warnpercent`, `dsr_criticalpercent`, `dsr_defaultenvironmenttypes` (CSV of environment-type names) |

Use `tools/DataverseProvisioner` to create them, or import the solution.

## Environment variables

See `environment-variables.json`. The client secret `dsr_AdminClientSecret` must be
set ONLY in the target environment as a secret value. Never commit the value.

## Power Automate flow

See `flows/dsr-ingest-capacity`. It runs nightly and on-demand from the app's
"Refresh now" button. The flow uses client credentials to call the BAP admin
APIs, so the Entra app behind `dsr_AdminClientId` must be registered as a
Power Platform management app (see flow notes).

## Test environment

| Setting | Value |
|---|---|
| Tenant ID | `1557f771-4c8e-4dbd-8b80-dd00a88e833e` |
| Environment ID | `e0c96096-913f-eec3-8454-d21f7b956608` |
| Dataverse URL | `https://bprocidatest.crm.dynamics.com/` |
| App registration ID | `23426e2c-3cec-48de-8c53-bfe366373c1e` |

## Deploy steps

1. Run `tools/DataverseProvisioner` to create the `dsr_` publisher, solution, and tables.
2. Add the environment variables from `environment-variables.json` to the solution and
   set `dsr_AdminClientSecret` as a secret in the target environment.
3. Author the cloud flow from `flows/dsr-ingest-capacity/flow-blueprint.json` inside
   the same solution. Save once to obtain its HTTP-trigger URL.
4. Set `VITE_REFRESH_FLOW_URL` to that URL in the build environment for the React app.
5. `npm run build` then push the code app:

   ```powershell
   pac code init --displayName "Dataverse Storage Report"  # one-time
   pac code push --environment "https://bprocidatest.crm.dynamics.com/" --solutionName "DataverseStorageReport"
   ```

6. After the flow exists in the solution, attach it to the code app:

   ```powershell
   npx power-apps list-flows --search "Ingest Dataverse storage capacity" --json
   npx power-apps add-flow --flow-id "<flow-guid>"
   pac code push --environment "https://bprocidatest.crm.dynamics.com/" --solutionName "DataverseStorageReport"
   ```

7. Share the app with the Power Platform admins. They need a Dataverse security role
   that grants read on `dsr_environment`, `dsr_storagesnapshot`, `dsr_tenantpool`
   and write on `dsr_setting`.
