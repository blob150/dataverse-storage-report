using Microsoft.PowerPlatform.Dataverse.Client;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
var dataverseUrl = (System.Environment.GetEnvironmentVariable("DSR_DATAVERSE_URL") ?? throw new System.InvalidOperationException("Set DSR_DATAVERSE_URL before running.")).TrimEnd('/');
var c = new ServiceClient($"AuthType=OAuth;Url={dataverseUrl};LoginPrompt=Auto;TokenCacheStorePath=" + System.IO.Path.Combine(System.Environment.GetFolderPath(System.Environment.SpecialFolder.UserProfile), ".pac", "cache"));
var q = new QueryExpression("dsr_storagesnapshot") { ColumnSet = new ColumnSet("dsr_name","dsr_fileallocatedgb","dsr_fileusedgb","dsr_dballocatedgb","dsr_dbusedgb","dsr_paygoenabled","dsr_paygoconsumptiongb","dsr_capturedat","dsr_environment"), TopCount = 20 };
q.AddOrder("dsr_capturedat", OrderType.Descending);
var rows = c.RetrieveMultiple(q);
foreach (var r in rows.Entities) {
  var er = r.GetAttributeValue<EntityReference>("dsr_environment");
  System.Console.WriteLine($"{r["dsr_name"],-50} env={er?.Id} file={r.GetAttributeValue<decimal?>("dsr_fileusedgb"):F2}/{r.GetAttributeValue<decimal?>("dsr_fileallocatedgb"):F2} db={r.GetAttributeValue<decimal?>("dsr_dbusedgb"):F2}/{r.GetAttributeValue<decimal?>("dsr_dballocatedgb"):F2} paygo={r.GetAttributeValue<bool?>("dsr_paygoenabled")}={r.GetAttributeValue<decimal?>("dsr_paygoconsumptiongb"):F2}");
}
