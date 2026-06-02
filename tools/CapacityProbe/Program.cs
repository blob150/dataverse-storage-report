using System.Text.Json; using Azure.Core; using Azure.Identity;
var tenantId = "1557f771-4c8e-4dbd-8b80-dd00a88e833e";
var cred = new InteractiveBrowserCredential(new InteractiveBrowserCredentialOptions { TenantId=tenantId, ClientId="1950a258-227b-4e31-a9cf-717495945fc2", RedirectUri=new Uri("http://localhost") });
var bapTok = (await cred.GetTokenAsync(new TokenRequestContext(new[]{ "https://api.bap.microsoft.com/.default" }))).Token;
using var http = new HttpClient();
http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bapTok);

// Try several variants. $expand=permissions is the common way to get owner; some scopes require other expands.
string[] urls = {
  "https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments?api-version=2022-05-01&$top=3",
  "https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments?api-version=2022-05-01&$expand=permissions&$top=3",
  "https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments?api-version=2022-05-01&$expand=properties/permissions&$top=3",
  "https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments?api-version=2024-05-01&$top=3",
};
int idx = 0;
foreach (var u in urls) {
  idx++;
  Console.WriteLine($"\n===== [{idx}] {u} =====");
  var r = await http.GetAsync(u);
  var b = await r.Content.ReadAsStringAsync();
  Console.WriteLine($"status: {(int)r.StatusCode}");
  if (!r.IsSuccessStatusCode) { Console.WriteLine(b.Substring(0, Math.Min(600, b.Length))); continue; }
  var doc = JsonDocument.Parse(b);
  if (!doc.RootElement.TryGetProperty("value", out var arr)) { Console.WriteLine("(no value array)"); continue; }
  // Pretty-print the first env from this response, then list all distinct top-level + properties.* keys across all 3.
  var first = arr.EnumerateArray().FirstOrDefault();
  if (first.ValueKind == JsonValueKind.Undefined) { Console.WriteLine("(empty)"); continue; }
  Console.WriteLine("--- first env (full) ---");
  Console.WriteLine(JsonSerializer.Serialize(first, new JsonSerializerOptions { WriteIndented = true }));
  Console.WriteLine("--- key map (all envs in this page) ---");
  var keys = new SortedSet<string>();
  foreach (var env in arr.EnumerateArray()) {
    foreach (var p in env.EnumerateObject()) keys.Add(p.Name);
    if (env.TryGetProperty("properties", out var props) && props.ValueKind == JsonValueKind.Object) {
      foreach (var p in props.EnumerateObject()) keys.Add("properties." + p.Name);
    }
  }
  foreach (var k in keys) Console.WriteLine("  " + k);
}
