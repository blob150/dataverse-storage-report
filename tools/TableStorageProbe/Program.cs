using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Azure.Core;
using Azure.Identity;

// Probe candidate Dataverse Web API endpoints for per-table storage on a target env.
// Usage:
//   $env:DSR_TENANT_ID = "<tenant-guid>"; $env:DSR_DV_URL = "https://bprocidatest.crm.dynamics.com/"; dotnet run

var tenantId = Environment.GetEnvironmentVariable("DSR_TENANT_ID")
    ?? throw new InvalidOperationException("Set DSR_TENANT_ID (Entra tenant GUID).");
var dvUrl = (Environment.GetEnvironmentVariable("DSR_DV_URL")
    ?? "https://bprocidatest.crm.dynamics.com/").TrimEnd('/') + "/";

// Public well-known "Azure CLI" client ID is fine for interactive user token to Dataverse.
var cred = new InteractiveBrowserCredential(new InteractiveBrowserCredentialOptions
{
    TenantId = tenantId,
    ClientId = "04b07795-8ddb-461a-bbee-02f9e1bf7b46",
    RedirectUri = new Uri("http://localhost"),
});
var scope = dvUrl.TrimEnd('/') + "/.default";
var tok = (await cred.GetTokenAsync(new TokenRequestContext(new[] { scope }))).Token;

using var http = new HttpClient { BaseAddress = new Uri(dvUrl) };
http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", tok);
http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
http.DefaultRequestHeaders.Add("OData-MaxVersion", "4.0");
http.DefaultRequestHeaders.Add("OData-Version", "4.0");
http.DefaultRequestHeaders.Add("Prefer", "odata.include-annotations=\"*\"");

async Task Section(string title, Func<Task> body)
{
    Console.WriteLine();
    Console.WriteLine("=================================================================");
    Console.WriteLine("== " + title);
    Console.WriteLine("=================================================================");
    try { await body(); }
    catch (Exception ex) { Console.WriteLine("EX: " + ex.Message); }
}

async Task<(int status, string body)> Get(string relative)
{
    var r = await http.GetAsync(relative);
    var b = await r.Content.ReadAsStringAsync();
    return ((int)r.StatusCode, b);
}

async Task<(int status, string body)> Post(string relative, string json)
{
    using var req = new HttpRequestMessage(HttpMethod.Post, relative);
    req.Content = new StringContent(json, Encoding.UTF8, "application/json");
    var r = await http.SendAsync(req);
    var b = await r.Content.ReadAsStringAsync();
    return ((int)r.StatusCode, b);
}

static string Trim(string s, int n = 1200) => s.Length <= n ? s : s.Substring(0, n) + "...<truncated>";

Console.WriteLine($"Target: {dvUrl}");
Console.WriteLine($"Token audience: {scope}");

// -----------------------------------------------------------------------------
// 0. Sanity: WhoAmI + version
// -----------------------------------------------------------------------------
await Section("WhoAmI / RetrieveVersion", async () =>
{
    var (s1, b1) = await Get("api/data/v9.2/WhoAmI");
    Console.WriteLine($"WhoAmI status={s1}");
    Console.WriteLine(Trim(b1, 400));
    var (s2, b2) = await Get("api/data/v9.2/RetrieveVersion");
    Console.WriteLine($"RetrieveVersion status={s2}");
    Console.WriteLine(Trim(b2, 200));
});

// -----------------------------------------------------------------------------
// 1. Discover any system entity that looks like it holds storage info
// -----------------------------------------------------------------------------
await Section("EntityDefinitions matching storage/capacity/size", async () =>
{
    var (s, b) = await Get(
        "api/data/v9.2/EntityDefinitions?$select=LogicalName,SchemaName,DisplayName,ObjectTypeCode,IsCustomEntity" +
        "&$filter=(contains(LogicalName,'storage') or contains(LogicalName,'capacity') or contains(LogicalName,'databasesize') or contains(LogicalName,'tablesize'))");
    Console.WriteLine($"status={s}");
    if (s != 200) { Console.WriteLine(Trim(b)); return; }
    using var doc = JsonDocument.Parse(b);
    foreach (var e in doc.RootElement.GetProperty("value").EnumerateArray())
    {
        Console.WriteLine("  logical=" + e.GetProperty("LogicalName").GetString()
            + "  schema=" + e.GetProperty("SchemaName").GetString()
            + "  otc=" + (e.TryGetProperty("ObjectTypeCode", out var otc) ? otc.ToString() : "?"));
    }
});

// -----------------------------------------------------------------------------
// 2. Try known-name reads (some may 404 — that's fine, we log & continue)
//    These are the entity names most commonly cited in community/PPAC internals.
// -----------------------------------------------------------------------------
string[] candidates = new[] {
    "msdyn_databasesizes",
    "msdyn_databasesize",
    "msdyn_databasestorage",
    "msdyn_tablestorageusage",
    "msdyn_tablestorage",
    "msdyn_tablecapacity",
    "msdyn_databasestorageadvisor",
    "msdyn_capacityreport",
    "recyclebinconfig",
    "organizationdatasyncstate",
    "organizationdatabases",
};
await Section("Known-name entity probe (top 3 rows each)", async () =>
{
    foreach (var name in candidates)
    {
        var (s, b) = await Get($"api/data/v9.2/{name}?$top=3");
        Console.WriteLine($"\n-- {name}  status={s}");
        Console.WriteLine(Trim(b, 800));
    }
});

// -----------------------------------------------------------------------------
// 3. RetrieveTotalRecordCount — public, reliable, gives row counts for a batch of entities.
//    Use it against a small set first (account, contact, our four dsr_* tables) to confirm shape.
// -----------------------------------------------------------------------------
await Section("RetrieveTotalRecordCount (batch)", async () =>
{
    var entities = new[] { "account", "contact", "systemuser",
        "dsr_environment", "dsr_storagesnapshot", "dsr_tenantpool", "dsr_setting" };
    var query = "EntityNames=[" + string.Join(",", entities.Select(e => $"'{e}'")) + "]";
    var url = "api/data/v9.2/RetrieveTotalRecordCount(" + query + ")";
    var (s, b) = await Get(url);
    Console.WriteLine($"status={s}");
    Console.WriteLine(Trim(b, 2000));
});

// -----------------------------------------------------------------------------
// 4. Try messages that might exist on the environment for storage.
//    Unbound functions/actions in Dataverse.
// -----------------------------------------------------------------------------
await Section("Candidate unbound functions", async () =>
{
    string[] funcs = new[] {
        "api/data/v9.2/RetrieveCurrentOrganization(AccessType='Default')",
        "api/data/v9.2/RetrieveOrganizationInfo",
        "api/data/v9.2/GetDataEncryptionKey",
        "api/data/v9.2/RetrieveDataEncryptionKey",
        "api/data/v9.2/msdyn_RetrieveAvailableStorage",
        "api/data/v9.2/msdyn_GetDatabaseSize",
        "api/data/v9.2/msdyn_GetTableStorage",
        "api/data/v9.2/msdyn_GetCapacity",
    };
    foreach (var f in funcs)
    {
        var (s, b) = await Get(f);
        Console.WriteLine($"\n-- {f}  status={s}");
        Console.WriteLine(Trim(b, 400));
    }
});

// -----------------------------------------------------------------------------
// 5. Any entity that ends with 'storage' - try broader $filter
// -----------------------------------------------------------------------------
await Section("EntityDefinitions LIKE '%usage%' or '%metric%'", async () =>
{
    var (s, b) = await Get(
        "api/data/v9.2/EntityDefinitions?$select=LogicalName,SchemaName" +
        "&$filter=(contains(LogicalName,'usage') or contains(LogicalName,'metric') or contains(LogicalName,'quota'))");
    Console.WriteLine($"status={s}");
    if (s != 200) { Console.WriteLine(Trim(b, 400)); return; }
    using var doc = JsonDocument.Parse(b);
    foreach (var e in doc.RootElement.GetProperty("value").EnumerateArray())
    {
        Console.WriteLine("  " + e.GetProperty("LogicalName").GetString());
    }
});

// -----------------------------------------------------------------------------
// 6. Full RetrieveOrganizationInfo (look for storage/size fields hidden in the payload)
// -----------------------------------------------------------------------------
await Section("RetrieveOrganizationInfo (top-level keys + any size-like fields)", async () =>
{
    var (s, b) = await Get("api/data/v9.2/RetrieveOrganizationInfo");
    Console.WriteLine($"status={s}  length={b.Length}");
    if (s != 200) { Console.WriteLine(Trim(b, 400)); return; }
    using var doc = JsonDocument.Parse(b);
    // walk & report any leaf key containing size/storage/capacity/quota/db/file/log
    var hits = new List<string>();
    void Walk(JsonElement el, string path)
    {
        if (el.ValueKind == JsonValueKind.Object)
        {
            foreach (var p in el.EnumerateObject())
            {
                var np = path == "" ? p.Name : path + "." + p.Name;
                var kl = p.Name.ToLowerInvariant();
                if (kl.Contains("size") || kl.Contains("storage") || kl.Contains("capacity")
                    || kl.Contains("quota") || kl.Contains("bytes") || kl.Contains("usage")
                    || kl.Contains("dbmb") || kl.Contains("filemb") || kl.Contains("logmb"))
                    hits.Add(np + " = " + p.Value.ToString());
                Walk(p.Value, np);
            }
        }
        else if (el.ValueKind == JsonValueKind.Array)
        {
            int i = 0;
            foreach (var c in el.EnumerateArray()) { Walk(c, path + "[" + i + "]"); i++; if (i > 3) break; }
        }
    }
    Walk(doc.RootElement, "");
    Console.WriteLine($"size-like key matches: {hits.Count}");
    foreach (var h in hits.Take(80)) Console.WriteLine("  " + h);
    Console.WriteLine("--- top-level keys ---");
    foreach (var p in doc.RootElement.EnumerateObject())
        Console.WriteLine("  " + p.Name + " (" + p.Value.ValueKind + ")");
    if (doc.RootElement.TryGetProperty("organizationInfo", out var oi))
    {
        Console.WriteLine("--- organizationInfo keys ---");
        foreach (var p in oi.EnumerateObject())
            Console.WriteLine("  " + p.Name + " (" + p.Value.ValueKind + ")");
    }
});

// -----------------------------------------------------------------------------
// 7. Fields on the `organizations` entity itself — legacy CRM had DatabaseSize etc.
// -----------------------------------------------------------------------------
await Section("organizations entity (full record, list size-like columns)", async () =>
{
    var (s, b) = await Get("api/data/v9.2/organizations?$top=1");
    Console.WriteLine($"status={s}  length={b.Length}");
    if (s != 200) { Console.WriteLine(Trim(b, 800)); return; }
    using var doc = JsonDocument.Parse(b);
    var arr = doc.RootElement.GetProperty("value");
    if (arr.GetArrayLength() == 0) { Console.WriteLine("(no rows)"); return; }
    var org = arr[0];
    Console.WriteLine("all columns on organization:");
    foreach (var p in org.EnumerateObject())
    {
        var kl = p.Name.ToLowerInvariant();
        var mark = (kl.Contains("size") || kl.Contains("storage") || kl.Contains("capacity")
            || kl.Contains("quota") || kl.Contains("bytes") || kl.Contains("usage")
            || kl.Contains("database") || kl.Contains("file") || kl.Contains("log"))
            ? "  <-- MATCH" : "";
        var val = p.Value.ValueKind == JsonValueKind.String
            ? "\"" + Trim(p.Value.GetString() ?? "", 60) + "\""
            : p.Value.ToString();
        if (val.Length > 80) val = val.Substring(0, 80) + "...";
        Console.WriteLine($"  {p.Name} = {val}{mark}");
    }
});

// -----------------------------------------------------------------------------
// 8. Broader metadata scan using startswith  (no contains support)
// -----------------------------------------------------------------------------
await Section("EntityDefinitions startswith scan for msdyn_/org*/dv*", async () =>
{
    string[] prefixes = new[] { "msdyn_", "adx_", "org", "dv_", "systemsetting" };
    foreach (var pref in prefixes)
    {
        var (s, b) = await Get(
            "api/data/v9.2/EntityDefinitions?$select=LogicalName,SchemaName" +
            $"&$filter=startswith(LogicalName,'{pref}')");
        Console.WriteLine($"\n-- startswith '{pref}'  status={s}");
        if (s != 200) { Console.WriteLine(Trim(b, 300)); continue; }
        using var doc = JsonDocument.Parse(b);
        var arr = doc.RootElement.GetProperty("value");
        Console.WriteLine("count=" + arr.GetArrayLength());
        // Show only ones with interesting keywords
        foreach (var e in arr.EnumerateArray())
        {
            var ln = e.GetProperty("LogicalName").GetString() ?? "";
            var lower = ln.ToLowerInvariant();
            if (lower.Contains("storage") || lower.Contains("capacity") || lower.Contains("size")
                || lower.Contains("usage") || lower.Contains("metric") || lower.Contains("quota")
                || lower.Contains("database") || lower.Contains("stat"))
                Console.WriteLine("  " + ln);
        }
    }
});

// -----------------------------------------------------------------------------
// 9. More unbound-function candidates (admin/reporting messages)
// -----------------------------------------------------------------------------
await Section("Extra unbound function candidates", async () =>
{
    string[] funcs = new[] {
        "api/data/v9.2/RetrieveResourceLimits",
        "api/data/v9.2/GetSizeStatistics",
        "api/data/v9.2/RetrieveSizeStatistics",
        "api/data/v9.2/RetrieveOrganizationResources",
        "api/data/v9.2/RetrieveTenantInfo",
        "api/data/v9.2/RetrieveOrgDbOrgSettings",
        "api/data/v9.2/GetOrgDbOrgSettings",
        "api/data/v9.2/RetrieveDatabaseSize",
        "api/data/v9.2/DatabaseSize",
        "api/data/v9.2/RetrieveDatabaseVersion",
        "api/data/v9.2/RetrieveMailboxUsage",
        "api/data/v9.2/RetrieveOrganizationCapacity",
    };
    foreach (var f in funcs)
    {
        var (s, b) = await Get(f);
        Console.WriteLine($"\n-- {f}  status={s}");
        Console.WriteLine(Trim(b, 500));
    }
});

Console.WriteLine("\n== DONE ==");
