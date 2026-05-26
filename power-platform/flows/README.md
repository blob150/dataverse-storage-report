# Power Automate flows

This folder contains blueprint files for the flows packaged with this solution.

## `dsr-ingest-capacity`

Pulls per-environment Dataverse capacity and tenant pool data from the Power Platform
BAP admin APIs and writes it into the `dsr_environment`, `dsr_storagesnapshot`, and
`dsr_tenantpool` tables. See the folder's `implementation-notes.md` and
`flow-blueprint.json` for the recommended steps.
