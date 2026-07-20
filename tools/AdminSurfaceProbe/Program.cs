using System.Net.Http.Headers;
using System.Text.Json;
using Azure.Core;
using Azure.Identity;

// Probe admin backend surfaces (BAP, api.powerplatform.com, admin.powerplatform.microsoft.com)
// for per-table storage against a target env, using an interactive user token (must be PP admin).
//
// Env vars:
//   DSR_TENANT_ID   -- Entra tenant GUID
//   DSR_ENV_GUID    -- Power Platform environment ID (BAP GUID form).  If absent, we list envs first.
//   DSR_ORG_GUID    -- Dataverse organization ID (from RetrieveCurrentOrganization; alt form of env id sometimes).
//   DSR_ORG_URL     -- Dataverse org URL (https://<host>.crm.dynamics.com/), used for a host-matched BAP env lookup.

var tenantId = Environment.GetEnvironmentVariable("DSR_TENANT_ID")
    ?? throw new InvalidOperationException("Set DSR_TENANT_ID");
var providedEnvGuid = Environment.GetEnvironmentVariable("DSR_ENV_GUID");
var providedOrgGuid = Environment.GetEnvironmentVariable("DSR_ORG_GUID");
var orgUrl = Environment.GetEnvironmentVariable("DSR_ORG_URL");

// One interactive credential, reused for all audiences (silent token cache).
var cred = new InteractiveBrowserCredential(new InteractiveBrowserCredentialOptions
{
    TenantId = tenantId,
    ClientId = "1950a258-227b-4e31-a9cf-717495945fc2", // Azure PowerShell public client - allowed everywhere
    RedirectUri = new Uri("http://localhost"),
});

async Task<string> Tok(string audience)
{
    var t = await cred.GetTokenAsync(new TokenRequestContext(new[] { audience + "/.default" }));
    return t.Token;
}

using var http = new HttpClient();
http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

async Task<(int status, string body, string? contentType)> Call(string url, string audience)
{
    var t = await Tok(audience);
    using var req = new HttpRequestMessage(HttpMethod.Get, url);
    req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", t);
    // PPAC's fetch sends these; may unlock some server-side routes.
    req.Headers.TryAddWithoutValidation("x-ms-path-query", url);
    req.Headers.TryAddWithoutValidation("x-ms-client-request-id", Guid.NewGuid().ToString());
    var r = await http.SendAsync(req);
    var b = await r.Content.ReadAsStringAsync();
    return ((int)r.StatusCode, b, r.Content.Headers.ContentType?.MediaType);
}

static string Trim(string s, int n = 600) => s.Length <= n ? s : s.Substring(0, n) + "...<truncated>";

Console.WriteLine($"Tenant: {tenantId}");
Console.WriteLine($"Provided env GUID: {providedEnvGuid ?? "(none)"}");
Console.WriteLine($"Org URL: {orgUrl ?? "(none)"}");

// -----------------------------------------------------------------------------
// STEP 1: If env GUID wasn't provided, list BAP envs and find the one matching the org URL/GUID.
// -----------------------------------------------------------------------------
string? envId = providedEnvGuid;
if (envId == null && orgUrl != null)
{
    Console.WriteLine("\n>>> Looking up env by org URL via BAP...");
    var (s, b, _) = await Call(
        "https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments?api-version=2022-05-01&$expand=properties",
        "https://api.bap.microsoft.com");
    Console.WriteLine($"list envs status={s} len={b.Length}");
    if (s == 200)
    {
        using var doc = JsonDocument.Parse(b);
        var target = new Uri(orgUrl).Host.ToLowerInvariant();
        foreach (var e in doc.RootElement.GetProperty("value").EnumerateArray())
        {
            if (!e.TryGetProperty("properties", out var props)) continue;
            var instanceUrl = props.TryGetProperty("linkedEnvironmentMetadata", out var lem)
                && lem.TryGetProperty("instanceUrl", out var iu) ? iu.GetString() : null;
            if (instanceUrl != null && instanceUrl.ToLowerInvariant().Contains(target))
            {
                envId = e.GetProperty("name").GetString();
                var display = props.TryGetProperty("displayName", out var dn) ? dn.GetString() : "?";
                Console.WriteLine($"  MATCH: envId={envId} displayName={display} instance={instanceUrl}");
                break;
            }
        }
    }
    else Console.WriteLine(Trim(b));
}

envId ??= providedOrgGuid;
if (envId == null) { Console.WriteLine("ERROR: could not resolve env GUID"); return; }

Console.WriteLine($"\nUsing env GUID: {envId}\n");

// -----------------------------------------------------------------------------
// STEP 2: Try candidate admin URLs across three hosts, for that env.
// -----------------------------------------------------------------------------
var urls = new (string url, string audience, string label)[]
{
    // ---- BAP admin surface ----
    ($"https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/{envId}?api-version=2022-05-01&$expand=properties",
        "https://api.bap.microsoft.com", "BAP env (expand properties)"),
    ($"https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/{envId}/settings?api-version=2022-05-01",
        "https://api.bap.microsoft.com", "BAP env settings"),
    ($"https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/{envId}/capacity?api-version=2022-05-01",
        "https://api.bap.microsoft.com", "BAP env capacity (env-level)"),
    ($"https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/{envId}/capacity/details?api-version=2022-05-01",
        "https://api.bap.microsoft.com", "BAP env capacity/details"),
    ($"https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/{envId}/tableStorage?api-version=2022-05-01",
        "https://api.bap.microsoft.com", "BAP env tableStorage"),
    ($"https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/{envId}/instance?api-version=2022-05-01",
        "https://api.bap.microsoft.com", "BAP env instance"),
    ($"https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/{envId}/instance/tables?api-version=2022-05-01",
        "https://api.bap.microsoft.com", "BAP env instance/tables"),
    ($"https://api.bap.microsoft.com/providers/Microsoft.BusinessAppPlatform/scopes/admin/environments/{envId}/analytics?api-version=2022-05-01",
        "https://api.bap.microsoft.com", "BAP env analytics"),

    // ---- api.powerplatform.com (newer surface) ----
    ($"https://api.powerplatform.com/environments/{envId}?api-version=2022-03-01-preview",
        "https://api.powerplatform.com", "PP API env"),
    ($"https://api.powerplatform.com/analytics/environments/{envId}/storage/tables?api-version=2022-03-01-preview",
        "https://api.powerplatform.com", "PP API analytics/storage/tables"),
    ($"https://api.powerplatform.com/analytics/environments/{envId}/capacity/tables?api-version=2022-03-01-preview",
        "https://api.powerplatform.com", "PP API analytics/capacity/tables"),
    ($"https://api.powerplatform.com/analytics/environments/{envId}/dataverse/tables?api-version=2022-03-01-preview",
        "https://api.powerplatform.com", "PP API analytics/dataverse/tables"),
    ($"https://api.powerplatform.com/dataverse/environments/{envId}/tables?api-version=2022-03-01-preview",
        "https://api.powerplatform.com", "PP API dataverse/tables"),
    ($"https://api.powerplatform.com/capacity/environments/{envId}/tables?api-version=2022-03-01-preview",
        "https://api.powerplatform.com", "PP API capacity/tables"),

    // ---- admin.powerplatform.microsoft.com (PPAC frontend backend) ----
    ($"https://admin.powerplatform.microsoft.com/api/environments/{envId}/capacity",
        "https://admin.powerplatform.microsoft.com", "PPAC api env capacity"),
    ($"https://admin.powerplatform.microsoft.com/api/environments/{envId}/capacity/details",
        "https://admin.powerplatform.microsoft.com", "PPAC api env capacity/details"),
    ($"https://admin.powerplatform.microsoft.com/api/environments/{envId}/storage/tables",
        "https://admin.powerplatform.microsoft.com", "PPAC api env storage/tables"),
    ($"https://admin.powerplatform.microsoft.com/api/environments/{envId}/tableStorage",
        "https://admin.powerplatform.microsoft.com", "PPAC api env tableStorage"),
    ($"https://admin.powerplatform.microsoft.com/api/environments/{envId}/dataverse/tables",
        "https://admin.powerplatform.microsoft.com", "PPAC api env dataverse/tables"),
};

foreach (var (url, audience, label) in urls)
{
    Console.WriteLine();
    Console.WriteLine($"===== {label}");
    Console.WriteLine($"  URL: {url}");
    Console.WriteLine($"  aud: {audience}");
    try
    {
        var (s, b, ct) = await Call(url, audience);
        Console.WriteLine($"  status={s} contentType={ct} len={b.Length}");
        // For successes, quickly flag storage-like tokens in the body
        var lowered = b.ToLowerInvariant();
        var flags = new[] { "storage", "capacity", "sizemb", "sizeinmb", "sizebytes",
            "databasesize", "filesize", "logsize", "rowcount", "recordcount",
            "logicalname", "entityname" }
            .Where(k => lowered.Contains(k)).ToList();
        if (flags.Count > 0)
            Console.WriteLine("  KEYWORDS: " + string.Join(", ", flags));
        Console.WriteLine("  body: " + Trim(b, 700));
    }
    catch (Exception ex) { Console.WriteLine("  EX: " + ex.Message); }
}

Console.WriteLine("\n== DONE ==");
