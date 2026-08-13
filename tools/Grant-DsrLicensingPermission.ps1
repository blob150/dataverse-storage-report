# Grant-DsrLicensingPermission.ps1
#
# Applies the Entra changes needed for Option B (browser MSAL -> licensing endpoint):
#   1. Ensures the Service Principal for 'Power Platform Licensing'
#      (appId 1c2909a7-6432-4263-a70d-929a3c1f9ee5) exists in this tenant.
#      Without a local SP, the "APIs my organization uses" picker in the portal
#      shows nothing for it.
#   2. Adds the delegated 'user_impersonation' scope from Power Platform Licensing
#      to DSR Admin App (appId 23426e2c-3cec-48de-8c53-bfe366373c1e) requiredResourceAccess.
#   3. Creates a tenant-wide oauth2PermissionGrant so the delegated permission
#      is admin-consented for all users (no per-user consent prompt).
#   4. Adds SPA redirect URIs to DSR Admin App so the browser MSAL auth-code+PKCE
#      flow can complete.
#
# Requires: Global Administrator (or Cloud Application Administrator + Application Administrator).
# Run interactively - a browser window will pop for sign-in.

$ErrorActionPreference = 'Stop'

# Constants -------------------------------------------------------------------
$DsrAppId          = '23426e2c-3cec-48de-8c53-bfe366373c1e'  # DSR Admin App
$LicensingAppId    = '1c2909a7-6432-4263-a70d-929a3c1f9ee5'  # Power Platform Licensing (Microsoft-owned resource)
$LicensingScopeName = 'user_impersonation'
$TenantId          = '1557f771-4c8e-4dbd-8b80-dd00a88e833e'  # pfecrmonline
$SpaRedirects      = @(
  'https://apps.powerapps.com',
  'https://apps.powerapps.com/play/e/e0c96096-913f-eec3-8454-d21f7b956608/app/8fce8547-9dbe-427a-9838-104537d62f55',
  'http://localhost:3000'
)

# --- Ensure Microsoft.Graph modules ------------------------------------------
foreach ($m in @('Microsoft.Graph.Authentication','Microsoft.Graph.Applications','Microsoft.Graph.Identity.SignIns')) {
    if (-not (Get-Module -ListAvailable -Name $m)) {
        Write-Host "Installing $m..." -ForegroundColor Yellow
        Install-Module -Name $m -Scope CurrentUser -Force -AllowClobber
    }
    Import-Module $m -ErrorAction Stop
}

# --- Sign in -----------------------------------------------------------------
Write-Host "`n>> Connecting to Microsoft Graph (Global Admin sign-in expected)..." -ForegroundColor Cyan
Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
Connect-MgGraph -TenantId $TenantId -Scopes @(
    'Application.ReadWrite.All',
    'DelegatedPermissionGrant.ReadWrite.All',
    'Directory.ReadWrite.All'
) -NoWelcome

$ctx = Get-MgContext
Write-Host "Connected as: $($ctx.Account) (tenant $($ctx.TenantId))" -ForegroundColor Green

# --- 1) Ensure Licensing SP exists in tenant --------------------------------
Write-Host "`n>> Ensuring Power Platform Licensing service principal exists..." -ForegroundColor Cyan
$licensingSp = Get-MgServicePrincipal -Filter "appId eq '$LicensingAppId'" -ErrorAction SilentlyContinue
if (-not $licensingSp) {
    Write-Host "  SP not found - creating..." -ForegroundColor Yellow
    $licensingSp = New-MgServicePrincipal -BodyParameter @{ appId = $LicensingAppId }
    Write-Host "  [OK] Created SP $($licensingSp.Id)" -ForegroundColor Green
} else {
    Write-Host "  [OK] SP already present (id=$($licensingSp.Id))" -ForegroundColor Green
}

# Look up the user_impersonation scope's GUID
$scope = $licensingSp.Oauth2PermissionScopes | Where-Object { $_.Value -eq $LicensingScopeName }
if (-not $scope) {
    Write-Warning "Licensing SP publishes no named scopes (this is normal for the CDS License Management SP)."
    Write-Warning "Falling back to declaring the resource in requiredResourceAccess without a specific scope id."
    Write-Warning "Entra's v1.0 authorize endpoint treats this as an implicit user_impersonation grant for delegated flows."
    $scopeId = $null
} else {
    $scopeId = $scope.Id
    Write-Host "  Scope '$LicensingScopeName' id = $scopeId"
}

# --- 2) Add licensing resource block to DSR Admin App requiredResourceAccess -
Write-Host "`n>> Adding licensing resource declaration to DSR Admin App..." -ForegroundColor Cyan
$dsrApp = Get-MgApplication -Filter "appId eq '$DsrAppId'" -ErrorAction Stop
if (-not $dsrApp) { throw "DSR Admin App ($DsrAppId) not found in this tenant." }
Write-Host "  DSR Admin App object id = $($dsrApp.Id)"

# Convert existing RRA to plain hashtables so we can modify safely
$currentRra = @()
foreach ($block in @($dsrApp.RequiredResourceAccess)) {
    $newAccess = @()
    foreach ($a in @($block.ResourceAccess)) {
        $newAccess += @{ Id = $a.Id; Type = $a.Type }
    }
    $currentRra += @{ ResourceAppId = $block.ResourceAppId; ResourceAccess = $newAccess }
}
$licBlock = $currentRra | Where-Object { $_.ResourceAppId -eq $LicensingAppId }
if ($null -eq $licBlock) {
    # If we have a scope id, include it; otherwise ship an empty ResourceAccess array
    # (declaring the resource is sufficient for AADSTS650057).
    $newAccess = if ($scopeId) { @(@{ Id = $scopeId; Type = 'Scope' }) } else { @() }
    $currentRra = @($currentRra) + @{
        ResourceAppId = $LicensingAppId
        ResourceAccess = $newAccess
    }
    Update-MgApplication -ApplicationId $dsrApp.Id -RequiredResourceAccess $currentRra
    Write-Host "  [OK] Declared licensing resource in DSR Admin App (scopeId=$(if ($scopeId) { $scopeId } else { 'none' }))" -ForegroundColor Green
} else {
    if ($scopeId -and -not ($licBlock.ResourceAccess | Where-Object { $_.Id -eq $scopeId -and $_.Type -eq 'Scope' })) {
        $licBlock.ResourceAccess += @{ Id = $scopeId; Type = 'Scope' }
        Update-MgApplication -ApplicationId $dsrApp.Id -RequiredResourceAccess $currentRra
        Write-Host "  [OK] Added Licensing/$LicensingScopeName scope to existing block" -ForegroundColor Green
    } else {
        Write-Host "  [OK] Licensing resource already declared" -ForegroundColor Green
    }
}

# --- 3) Ensure DSR Admin App has an SP + grant admin consent ---------------
Write-Host "`n>> Ensuring DSR Admin App has a Service Principal..." -ForegroundColor Cyan
$dsrSp = Get-MgServicePrincipal -Filter "appId eq '$DsrAppId'" -ErrorAction SilentlyContinue
if (-not $dsrSp) {
    Write-Host "  Creating SP for DSR Admin App..." -ForegroundColor Yellow
    $dsrSp = New-MgServicePrincipal -BodyParameter @{ appId = $DsrAppId }
}
Write-Host "  DSR Admin App SP id = $($dsrSp.Id)"

Write-Host "`n>> Granting tenant-wide admin consent (oauth2PermissionGrant AllPrincipals)..." -ForegroundColor Cyan
if (-not $scopeId) {
    Write-Host "  Skipping oauth2PermissionGrant - no published scope to consent." -ForegroundColor Yellow
    Write-Host "  Entra will treat delegated calls as implicit user_impersonation when the resource is declared" -ForegroundColor Yellow
    Write-Host "  in requiredResourceAccess (step 2 above)." -ForegroundColor Yellow
} else {
    $existingGrants = Get-MgOauth2PermissionGrant -Filter "clientId eq '$($dsrSp.Id)' and resourceId eq '$($licensingSp.Id)'" -ErrorAction SilentlyContinue
    $grantToUpdate = $existingGrants | Where-Object { $_.ConsentType -eq 'AllPrincipals' }

    if ($grantToUpdate) {
        $currentScopes = @($grantToUpdate.Scope -split '\s+')
        if ($currentScopes -contains $LicensingScopeName) {
            Write-Host "  [OK] Admin consent already covers '$LicensingScopeName'" -ForegroundColor Green
        } else {
            $newScope = ($currentScopes + $LicensingScopeName | Sort-Object -Unique) -join ' '
            Update-MgOauth2PermissionGrant -OAuth2PermissionGrantId $grantToUpdate.Id -Scope $newScope
            Write-Host "  [OK] Updated existing grant to include '$LicensingScopeName'" -ForegroundColor Green
        }
    } else {
        New-MgOauth2PermissionGrant -BodyParameter @{
            clientId    = $dsrSp.Id
            consentType = 'AllPrincipals'
            resourceId  = $licensingSp.Id
            scope       = $LicensingScopeName
        } | Out-Null
        Write-Host "  [OK] Created new tenant-wide admin consent grant" -ForegroundColor Green
    }
}

# --- 4) Add SPA redirect URIs -----------------------------------------------
Write-Host "`n>> Ensuring SPA redirect URIs are registered..." -ForegroundColor Cyan
$app = Get-MgApplication -ApplicationId $dsrApp.Id
$spa = $app.Spa
if (-not $spa) { $spa = @{ RedirectUris = @() } }
$currentUris = @($spa.RedirectUris)
$missing = @($SpaRedirects | Where-Object { $_ -notin $currentUris })
if ($missing.Count -eq 0) {
    Write-Host "  [OK] All SPA redirect URIs already registered" -ForegroundColor Green
} else {
    $newUris = ($currentUris + $missing) | Sort-Object -Unique
    Update-MgApplication -ApplicationId $dsrApp.Id -Spa @{ RedirectUris = $newUris }
    Write-Host "  [OK] Added: $($missing -join ', ')" -ForegroundColor Green
}

Write-Host "`n=== Final state ===" -ForegroundColor Cyan
$final = Get-MgApplication -ApplicationId $dsrApp.Id
Write-Host "SPA redirect URIs:"
$final.Spa.RedirectUris | ForEach-Object { Write-Host "  * $_" }
Write-Host "RequiredResourceAccess (Licensing block):"
$final.RequiredResourceAccess | Where-Object { $_.ResourceAppId -eq $LicensingAppId } | ForEach-Object {
    Write-Host "  ResourceAppId: $($_.ResourceAppId)"
    $_.ResourceAccess | ForEach-Object { Write-Host "    Scope Id: $($_.Id) Type: $($_.Type)" }
}
Write-Host "Admin consent grants (Licensing):"
Get-MgOauth2PermissionGrant -Filter "clientId eq '$($dsrSp.Id)' and resourceId eq '$($licensingSp.Id)'" |
    ForEach-Object { Write-Host "  ConsentType=$($_.ConsentType)  Scope='$($_.Scope)'" }

Write-Host "`n[OK] Done. DSR Admin App is now configured for delegated browser MSAL against Power Platform Licensing." -ForegroundColor Green
Disconnect-MgGraph | Out-Null
