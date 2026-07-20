using Azure.Core; using Azure.Identity;
using Microsoft.PowerPlatform.Dataverse.Client;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;

var cred = new InteractiveBrowserCredential(new InteractiveBrowserCredentialOptions {
    TenantId = Environment.GetEnvironmentVariable("DSR_TENANT_ID"),
    ClientId = "51f81489-12ee-4a9e-aaae-a2591f45987d",
    RedirectUri = new Uri("http://localhost") });
using var s = new ServiceClient(new Uri(Environment.GetEnvironmentVariable("DSR_DV_URL")!), async _ =>
{ var t = await cred.GetTokenAsync(new TokenRequestContext(new[] { Environment.GetEnvironmentVariable("DSR_DV_URL")!.TrimEnd('/') + "/.default" })); return t.Token; });
if (!s.IsReady) throw new Exception(s.LastError);

// Get the full flowrun row + look for related action results
Console.WriteLine("=== flowrun row (most recent, all cols) ===");
var q = new QueryExpression("flowrun") { ColumnSet = new ColumnSet(true), TopCount = 1 };
q.Criteria.AddCondition("workflow", ConditionOperator.Equal, new Guid("2167dd11-6001-48a5-9d3d-503c0075bbb1"));
q.AddOrder("createdon", OrderType.Descending);
var run = s.RetrieveMultiple(q).Entities.FirstOrDefault();
if (run != null) {
    foreach (var attr in run.Attributes.OrderBy(a => a.Key)) {
        var v = attr.Value?.ToString();
        if (string.IsNullOrEmpty(v) || v == "0" || v.Length < 3) continue;
        Console.WriteLine($"  {attr.Key} = {(v.Length > 300 ? v.Substring(0,300)+"..." : v)}");
    }
}

Console.WriteLine("\n=== check if DSR Admin App SP is registered as PP management app ===");
Console.WriteLine("(Would need Get-PowerAppManagementApp — must be run separately in PowerShell)");
Console.WriteLine("SP client id per SETUP.md: 23426e2c-3cec-48de-8c53-bfe366373c1e");
