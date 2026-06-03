using System.Text.Json;
using Azure.Core;
using Azure.Identity;
using Microsoft.Crm.Sdk.Messages;
using Microsoft.PowerPlatform.Dataverse.Client;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Query;

string DataverseUrl = Environment.GetEnvironmentVariable("DSR_DATAVERSE_URL")
    ?? throw new InvalidOperationException("Set DSR_DATAVERSE_URL (e.g. https://<your-org>.crm.dynamics.com/) before running.");
string TenantId = Environment.GetEnvironmentVariable("DSR_TENANT_ID")
    ?? throw new InvalidOperationException("Set DSR_TENANT_ID (your Entra tenant GUID) before running.");
const string DataverseToolingClientId = "51f81489-12ee-4a9e-aaae-a2591f45987d";
const string SolutionUniqueName = "DataverseStorageReport";

// Solution component types
const int ComponentType_Workflow = 29;
const int ComponentType_ConnectionReference = 372;

var flowDefinitionPath = Path.Combine(System.AppContext.BaseDirectory, "flow-definition.json");
if (!File.Exists(flowDefinitionPath))
{
    throw new FileNotFoundException("flow-definition.json not found next to executable", flowDefinitionPath);
}
var clientData = File.ReadAllText(flowDefinitionPath);
// Validate JSON is parseable before we send it to Dataverse.
using (JsonDocument.Parse(clientData)) { }

var credential = new InteractiveBrowserCredential(new InteractiveBrowserCredentialOptions
{
    TenantId = TenantId,
    ClientId = DataverseToolingClientId,
    RedirectUri = new Uri("http://localhost"),
});

using var service = new ServiceClient(new Uri(DataverseUrl), async _ =>
{
    var token = await credential.GetTokenAsync(
        new TokenRequestContext(new[] { $"{DataverseUrl.TrimEnd('/')}/.default" }));
    return token.Token;
});
if (!service.IsReady)
{
    throw new InvalidOperationException($"Dataverse connection failed: {service.LastError}", service.LastException);
}
Console.WriteLine($"Connected to {DataverseUrl}");

// --pull mode: download the current clientdata of the deployed flow into flow-definition.json
// so we capture any manual edits made via the maker portal.
if (args.Contains("--pull"))
{
    var qd = new QueryExpression("workflow")
    {
        ColumnSet = new ColumnSet("workflowid", "name", "uniquename", "clientdata", "statecode"),
        Criteria = new FilterExpression
        {
            Conditions = { new ConditionExpression("uniquename", ConditionOperator.Equal, "dsr_ingestdataversecapacity") }
        }
    };
    var rows = service.RetrieveMultiple(qd).Entities;
    if (rows.Count == 0) { Console.WriteLine("No workflow with uniquename dsr_ingestdataversecapacity found."); return; }
    var wf = rows.OrderByDescending(r => r.Contains("statecode") && ((OptionSetValue)r["statecode"]).Value == 1).First();
    var pulled = wf.GetAttributeValue<string>("clientdata") ?? "";
    // Pretty-print so it diffs cleanly in git.
    using var doc = JsonDocument.Parse(pulled);
    var pretty = JsonSerializer.Serialize(doc.RootElement, new JsonSerializerOptions { WriteIndented = true });
    var sourcePath = Path.GetFullPath(Path.Combine(System.AppContext.BaseDirectory, "..", "..", "..", "..", "..", "power-platform", "flows", "dsr-ingest-capacity", "flow-definition.json"));
    var localPath = Path.Combine(System.AppContext.BaseDirectory, "flow-definition.json");
    File.WriteAllText(sourcePath, pretty);
    File.WriteAllText(localPath, pretty);
    Console.WriteLine($"Pulled {pretty.Length} chars of clientdata from workflow {wf.Id}.");
    Console.WriteLine($"  Wrote: {sourcePath}");
    Console.WriteLine($"  Wrote: {localPath}");
    return;
}

// --list-envvars mode: dump schema name + display name of all dsr_ env var definitions and exit.
if (args.Contains("--list-envvars"))
{
    var qd = new QueryExpression("environmentvariabledefinition")
    {
        ColumnSet = new ColumnSet("schemaname", "displayname", "type"),
        Criteria = new FilterExpression
        {
            Conditions = { new ConditionExpression("schemaname", ConditionOperator.BeginsWith, "dsr_") }
        }
    };
    var rows = service.RetrieveMultiple(qd).Entities;
    Console.WriteLine($"Found {rows.Count} dsr_ env var definitions:");
    foreach (var r in rows)
    {
        var schema = r.GetAttributeValue<string>("schemaname");
        var disp = r.GetAttributeValue<string>("displayname");
        var typ = r.Contains("type") ? r.FormattedValues["type"] : "";
        Console.WriteLine($"  {schema} | display='{disp}' | type='{typ}'");
    }
    return;
}

var solutionId = GetSolutionId(service, SolutionUniqueName)
    ?? throw new InvalidOperationException($"Solution '{SolutionUniqueName}' not found. Run DataverseProvisioner first.");
Console.WriteLine($"Solution {SolutionUniqueName} = {solutionId}");

// 1. Connection reference (created in Dataverse; user adds it to the solution
// from the maker portal — programmatic solution add is unreliable for this type).
var cdsRef = EnsureConnectionReference(service, "dsr_shareddataverse",
    "DSR Shared Dataverse", "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps");

// 2. Workflow (cloud flow) as Draft
var workflowId = EnsureWorkflow(service, "dsr_ingestdataversecapacity",
    "Ingest Dataverse storage capacity",
    "Pulls per-environment Dataverse capacity from BAP admin APIs and upserts dsr_environment / dsr_storagesnapshot / dsr_tenantpool rows. Open in Power Automate to bind the Dataverse connection and turn on.",
    clientData);
AddToSolution(service, workflowId, ComponentType_Workflow, SolutionUniqueName);

try
{
    PublishAll(service);
}
catch (Exception ex)
{
    Console.WriteLine($"Publish warning (non-fatal): {ex.Message.Split('\n')[0]}");
}

Console.WriteLine();
Console.WriteLine("Flow provisioning complete.");
Console.WriteLine($"  Workflow ID: {workflowId}");
Console.WriteLine($"  Dataverse connection reference: {cdsRef}");
Console.WriteLine();
Console.WriteLine("Next steps in Power Automate (make.powerautomate.com):");
Console.WriteLine("  1. Open solution 'DataverseStorageReport' and edit the new flow.");
Console.WriteLine("  2. Bind 'DSR Shared Dataverse' to a connection that can write dsr_* tables.");
Console.WriteLine("  3. Set environment variable values: dsr_TenantId, dsr_AdminClientId,");
Console.WriteLine("     dsr_AdminClientSecret, dsr_BapApiVersion, dsr_HistoryRetentionDays.");
Console.WriteLine("  4. Save & Turn on.");
return;

static Guid? GetSolutionId(IOrganizationService svc, string uniqueName)
{
    var q = new QueryExpression("solution")
    {
        ColumnSet = new ColumnSet("solutionid"),
        Criteria = new FilterExpression { Conditions = { new ConditionExpression("uniquename", ConditionOperator.Equal, uniqueName) } },
        TopCount = 1,
    };
    return svc.RetrieveMultiple(q).Entities.Select(e => e.Id).FirstOrDefault() is var id && id != Guid.Empty ? id : null;
}

static Guid EnsureConnectionReference(IOrganizationService svc, string logicalName, string displayName, string connectorId)
{
    var q = new QueryExpression("connectionreference")
    {
        ColumnSet = new ColumnSet("connectionreferenceid"),
        Criteria = new FilterExpression
        {
            Conditions = { new ConditionExpression("connectionreferencelogicalname", ConditionOperator.Equal, logicalName) },
        },
        TopCount = 1,
    };
    var existing = svc.RetrieveMultiple(q).Entities.FirstOrDefault();
    if (existing != null)
    {
        Console.WriteLine($"Connection reference already exists: {logicalName}");
        return existing.Id;
    }

    var e = new Entity("connectionreference")
    {
        ["connectionreferencelogicalname"] = logicalName,
        ["connectionreferencedisplayname"] = displayName,
        ["connectorid"] = connectorId,
        ["description"] = "Created by FlowProvisioner. Bind in Power Automate before turning on the flow.",
    };
    var id = svc.Create(e);
    Console.WriteLine($"Created connection reference: {logicalName}");
    return id;
}

static Guid EnsureWorkflow(IOrganizationService svc, string uniqueName, string name, string description, string clientData)
{
    var q = new QueryExpression("workflow")
    {
        ColumnSet = new ColumnSet("workflowid"),
        Criteria = new FilterExpression
        {
            Conditions =
            {
                new ConditionExpression("uniquename", ConditionOperator.Equal, uniqueName),
                new ConditionExpression("type", ConditionOperator.Equal, 1),
            },
        },
    };
    var matches = svc.RetrieveMultiple(q).Entities;

    // If multiple drafts accumulated (from prior recreate cycles), prune extras
    if (matches.Count > 1)
    {
        Console.WriteLine($"Found {matches.Count} workflow rows for {uniqueName}; pruning duplicates.");
        foreach (var dup in matches.Skip(1))
        {
            try { svc.Delete("workflow", dup.Id); Console.WriteLine($"  Deleted duplicate: {dup.Id}"); }
            catch (Exception dx) { Console.WriteLine($"  Could not delete {dup.Id}: {dx.Message.Split('\n')[0]}"); }
        }
    }
    var existing = matches.FirstOrDefault();
    if (existing != null)
    {
        var upd = new Entity("workflow", existing.Id)
        {
            ["clientdata"] = clientData,
            ["description"] = description,
        };
        try
        {
            svc.Update(upd);
            Console.WriteLine($"Updated workflow: {uniqueName}");
            return existing.Id;
        }
        catch (Exception ex) when (ex.Message.Contains("0x80060467") || ex.Message.Contains("0x80040203") || ex.Message.Contains("connection references") || ex.Message.Contains("ActiveUnpublished"))
        {
            // Dataverse blocks workflow updates when connection refs are unbound,
            // or when the row is in ActiveUnpublished (draft) state.
            // Fall back to delete+recreate so the new clientdata actually lands.
            Console.WriteLine($"Update blocked ({ex.Message.Split('\n')[0]}). Recreating workflow: {uniqueName}");
            svc.Delete("workflow", existing.Id);
        }
    }

    var wf = new Entity("workflow")
    {
        ["name"] = name,
        ["uniquename"] = uniqueName,
        ["description"] = description,
        ["type"] = new OptionSetValue(1),                  // Definition
        ["category"] = new OptionSetValue(5),              // Modern Flow (cloud flow)
        ["mode"] = new OptionSetValue(0),                  // Background
        ["primaryentity"] = "none",
        ["clientdata"] = clientData,
        ["statecode"] = new OptionSetValue(0),             // Draft
        ["statuscode"] = new OptionSetValue(1),            // Draft
    };
    var id = svc.Create(wf);
    Console.WriteLine($"Created workflow (Draft): {uniqueName}");
    return id;
}

static void AddToSolution(IOrganizationService svc, Guid componentId, int componentType, string solutionUniqueName)
{
    try
    {
        svc.Execute(new AddSolutionComponentRequest
        {
            ComponentId = componentId,
            ComponentType = componentType,
            SolutionUniqueName = solutionUniqueName,
            AddRequiredComponents = false,
            DoNotIncludeSubcomponents = false,
        });
        Console.WriteLine($"Added to solution: type={componentType} id={componentId}");
    }
    catch (Exception ex)
    {
        // already-in-solution shows as 'cannot insert duplicate' — non-fatal.
        Console.WriteLine($"AddToSolution (type={componentType}) note: {ex.Message}");
    }
}

static void PublishAll(IOrganizationService svc)
{
    svc.Execute(new PublishAllXmlRequest());
    Console.WriteLine("Published customizations.");
}
