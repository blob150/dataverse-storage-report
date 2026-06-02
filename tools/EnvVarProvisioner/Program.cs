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
const int ComponentType_EnvironmentVariableDefinition = 380;

// environmentvariabledefinition.type option set values
const int Type_String = 100000000;
const int Type_Number = 100000001;
const int Type_Secret = 100000005;

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

var vars = new (string SchemaName, string DisplayName, int Type, string? Default, string Description)[]
{
    ("dsr_TenantId", "DSR Tenant ID", Type_String, TenantId,
        "Azure AD tenant GUID used to acquire BAP admin tokens."),
    ("dsr_AdminClientId", "DSR Admin Client ID", Type_String, null,
        "App registration (service principal) client ID used to call BAP admin APIs."),
    ("dsr_AdminClientSecret", "DSR Admin Client Secret", Type_Secret, null,
        "Secret for the admin service principal. Bind to an Azure Key Vault secret in the maker portal."),
    ("dsr_BapApiVersion", "DSR BAP API Version", Type_String, "2020-10-01",
        "api-version query string for BAP admin endpoints."),
    ("dsr_HistoryRetentionDays", "DSR History Retention Days", Type_Number, "90",
        "Days of dsr_storagesnapshot history to retain. Older rows are pruned by the ingest flow."),
};

foreach (var v in vars)
{
    var id = EnsureEnvVarDefinition(service, v.SchemaName, v.DisplayName, v.Type, v.Default, v.Description);
    AddToSolution(service, id, ComponentType_EnvironmentVariableDefinition, SolutionUniqueName);
}

Console.WriteLine();
Console.WriteLine("Environment variable provisioning complete.");
Console.WriteLine();
Console.WriteLine("Next steps in the maker portal:");
Console.WriteLine("  1. Open solution 'DataverseStorageReport'.");
Console.WriteLine("  2. For each environment variable, set the Current Value:");
Console.WriteLine("     - dsr_AdminClientId: paste the service principal app (client) ID.");
Console.WriteLine("     - dsr_AdminClientSecret: select 'New Azure Key Vault Reference' and supply KV URL + secret name.");
Console.WriteLine("     - dsr_TenantId / dsr_BapApiVersion / dsr_HistoryRetentionDays: defaults set; override if needed.");
return;

static Guid? GetSolutionId(IOrganizationService svc, string uniqueName)
{
    var q = new QueryExpression("solution")
    {
        ColumnSet = new ColumnSet("solutionid"),
        Criteria = new FilterExpression
        {
            Conditions = { new ConditionExpression("uniquename", ConditionOperator.Equal, uniqueName) },
        },
        TopCount = 1,
    };
    return svc.RetrieveMultiple(q).Entities.FirstOrDefault()?.Id;
}

static Guid EnsureEnvVarDefinition(IOrganizationService svc, string schemaName, string displayName,
    int type, string? defaultValue, string description)
{
    var q = new QueryExpression("environmentvariabledefinition")
    {
        ColumnSet = new ColumnSet("environmentvariabledefinitionid", "schemaname"),
        Criteria = new FilterExpression
        {
            Conditions = { new ConditionExpression("schemaname", ConditionOperator.Equal, schemaName) },
        },
        TopCount = 1,
    };
    var existing = svc.RetrieveMultiple(q).Entities.FirstOrDefault();
    if (existing != null)
    {
        var upd = new Entity("environmentvariabledefinition", existing.Id)
        {
            ["displayname"] = displayName,
            ["description"] = description,
            ["type"] = new OptionSetValue(type),
        };
        if (defaultValue is not null)
        {
            upd["defaultvalue"] = defaultValue;
        }
        svc.Update(upd);
        Console.WriteLine($"Updated env var: {schemaName}");
        return existing.Id;
    }

    var e = new Entity("environmentvariabledefinition")
    {
        ["schemaname"] = schemaName,
        ["displayname"] = displayName,
        ["description"] = description,
        ["type"] = new OptionSetValue(type),
        ["isrequired"] = false,
    };
    if (defaultValue is not null)
    {
        e["defaultvalue"] = defaultValue;
    }
    var id = svc.Create(e);
    Console.WriteLine($"Created env var: {schemaName}");
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
        Console.WriteLine($"  Added to solution (type={componentType}).");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"  AddToSolution note: {ex.Message.Split('\n')[0]}");
    }
}
