using Azure.Core; using Azure.Identity;
using Microsoft.PowerPlatform.Dataverse.Client;
using Microsoft.Xrm.Sdk; using Microsoft.Xrm.Sdk.Query;
var cred = new InteractiveBrowserCredential(new InteractiveBrowserCredentialOptions { TenantId="1557f771-4c8e-4dbd-8b80-dd00a88e833e", ClientId="51f81489-12ee-4a9e-aaae-a2591f45987d", RedirectUri=new Uri("http://localhost") });
using var s = new ServiceClient(new Uri("https://bprocidatest.crm.dynamics.com/"), async _ => { var t = await cred.GetTokenAsync(new TokenRequestContext(new[]{ "https://bprocidatest.crm.dynamics.com/.default" })); return t.Token; });
if (!s.IsReady) throw new Exception(s.LastError);
var eq = new QueryExpression("dsr_environment") { ColumnSet = new ColumnSet("dsr_environmentid","dsr_environmentguid","dsr_displayname","dsr_type") };
eq.Criteria.AddCondition("dsr_displayname", ConditionOperator.Like, "%default%");
var envs = s.RetrieveMultiple(eq).Entities;
Console.WriteLine($"envs={envs.Count}");
foreach (var r in envs) {
  Console.WriteLine($"ENV: name='{r.GetAttributeValue<string>("dsr_displayname")}' type={r.GetAttributeValue<string>("dsr_type")} dsr_id={r.Id} guid={r.GetAttributeValue<string>("dsr_environmentguid")}");
  var sq = new QueryExpression("dsr_storagesnapshot"){ ColumnSet = new ColumnSet("dsr_capturedat","dsr_dbusedgb","dsr_dballocatedgb","dsr_fileusedgb","dsr_logusedgb","dsr_paygoconsumptiongb"), TopCount=2 };
  sq.Criteria.AddCondition("dsr_environment", ConditionOperator.Equal, r.Id);
  sq.AddOrder("dsr_capturedat", OrderType.Descending);
  foreach (var sn in s.RetrieveMultiple(sq).Entities) {
    Console.WriteLine($"  cap={sn.GetAttributeValue<DateTime>("dsr_capturedat"):s} dbU={sn.GetAttributeValue<decimal?>("dsr_dbusedgb")} dbA={sn.GetAttributeValue<decimal?>("dsr_dballocatedgb")} fU={sn.GetAttributeValue<decimal?>("dsr_fileusedgb")} lU={sn.GetAttributeValue<decimal?>("dsr_logusedgb")} pgC={sn.GetAttributeValue<decimal?>("dsr_paygoconsumptiongb")}");
  }
}
