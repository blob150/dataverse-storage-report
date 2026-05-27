using System.Text.Json;
using Azure.Core;
using Azure.Identity;
using Microsoft.Crm.Sdk.Messages;
using Microsoft.PowerPlatform.Dataverse.Client;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Messages;
using Microsoft.Xrm.Sdk.Query;

const string DataverseUrl = "https://bprocidatest.crm.dynamics.com/";
const string TenantId = "1557f771-4c8e-4dbd-8b80-dd00a88e833e";
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

var solutionId = GetSolutionId(service, SolutionUniqueName)
    ?? throw new InvalidOperationException($"Solution '{SolutionUniqueName}' not found. Run DataverseProvisioner first.");
Console.WriteLine($"Solution {SolutionUniqueName} = {solutionId}");

// 1. Connection references (created in Dataverse; user adds them to the solution
// from the maker portal — programmatic solution add is unreliable for this type).
var httpRef = EnsureConnectionReference(service, "dsr_sharedhttp",
    "DSR Shared HTTP", "/providers/Microsoft.PowerApps/apis/shared_http");

var cdsRef = EnsureConnectionReference(service, "dsr_shareddataverse",
    "DSR Shared Dataverse", "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps");

// 2. Workflow (cloud flow) as Draft
var workflowId = EnsureWorkflow(service, "dsr_ingestdataversecapacity",
    "Ingest Dataverse storage capacity",
    "Pulls per-environment Dataverse capacity from BAP admin APIs and upserts dsr_environment / dsr_storagesnapshot / dsr_tenantpool rows. Open in Power Automate to bind connections and turn on.",
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
Console.WriteLine($"  HTTP connection reference: {httpRef}");
Console.WriteLine($"  Dataverse connection reference: {cdsRef}");
Console.WriteLine();
Console.WriteLine("Next steps in Power Automate (make.powerautomate.com):");
Console.WriteLine("  1. Open solution 'DataverseStorageReport' and edit the new flow.");
Console.WriteLine("  2. Bind 'DSR Shared HTTP' to a connection (premium HTTP).");
Console.WriteLine("  3. Bind 'DSR Shared Dataverse' to a connection that can write dsr_* tables.");
Console.WriteLine("  4. Set environment variable values: dsr_TenantId, dsr_AdminClientId,");
Console.WriteLine("     dsr_AdminClientSecret, dsr_BapApiVersion, dsr_HistoryRetentionDays.");
Console.WriteLine("  5. Save & Turn on. Optional: add a Recurrence trigger for daily refresh.");
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
        TopCount = 1,
    };
    var existing = svc.RetrieveMultiple(q).Entities.FirstOrDefault();
    if (existing != null)
    {
        Console.WriteLine($"Workflow already exists (no update): {uniqueName}");
        return existing.Id;
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
