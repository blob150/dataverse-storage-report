# Dataverse Storage Report — Power Platform solution scaffold

This folder is reserved for the exported Power Platform solution artifacts
(`solution.xml`, table xml fragments, code-app asset, flow assets) once you export
the unmanaged solution that the `DataverseProvisioner` tool creates and the cloud
flow you author in the maker portal.

Recommended export command (run from this folder after the solution exists):

```powershell
pac solution export --path .\DataverseStorageReport.zip --name DataverseStorageReport --managed false --include settings,calendar,customization,emailtracking,externalapplications,generalsettings,isvconfig,marketing,outlooksynchronization,relationshiproles,sales
pac solution unpack --zipfile .\DataverseStorageReport.zip --folder . --packagetype Both
```

The unpacked output is what gets committed alongside the React source.
