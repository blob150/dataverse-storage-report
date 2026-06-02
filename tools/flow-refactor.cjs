// Refactors the flow to use the v2.0 search licensing endpoint per env (hybrid pattern).
// For each env in the BAP env list, fetch its 3 dim entitlements (Database/File/Log) inline,
// parallelized by For_each concurrency. Avoids holding a full tenant-wide array in memory and
// the slow serial Until loops.
const fs = require('fs');
const path = require('path');

const FLOW = path.resolve(__dirname, '..', 'power-platform', 'flows', 'dsr-ingest-capacity', 'flow-definition.json');
const MIRROR = path.resolve(__dirname, 'FlowProvisioner', 'flow-definition.json');

const doc = JSON.parse(fs.readFileSync(FLOW, 'utf8'));
const def = doc.properties.definition;
const acts = def.actions;

// Drop unused HTTP connection reference (all HTTP actions are raw type:'Http' with inline AAD)
if (doc.properties.connectionReferences && doc.properties.connectionReferences.shared_http) {
  delete doc.properties.connectionReferences.shared_http;
}

// Replace HTTP request trigger with daily Recurrence (4am ET)
def.triggers = {
  Recurrence: {
    metadata: { operationMetadataId: '00000000-0000-0000-0000-000000000001' },
    type: 'Recurrence',
    recurrence: {
      frequency: 'Day',
      interval: 1,
      startTime: '2026-05-28T08:00:00Z',
      timeZone: 'Eastern Standard Time',
      schedule: {
        hours: ['4'],
        minutes: [0]
      }
    }
  }
};

const DIMS = ['Database', 'File', 'Log'];

function aadAuth(audience) {
  return {
    type: 'ActiveDirectoryOAuth',
    tenant: "@{parameters('DSR Tenant ID (dsr_TenantId)')}",
    audience,
    authority: 'https://login.microsoftonline.com',
    clientId: "@{parameters('DSR Admin Client ID (dsr_AdminClientId)')}",
    secret: 'REPLACE_WITH_CLIENT_SECRET'
  };
}

// ---- Top-level cleanup: convert HTTP actions to inline AAD auth, drop legacy token POSTs ----
function convertHttpToAad(actionName, audience) {
  const a = acts[actionName];
  if (!a || a.type !== 'Http') return;
  if (a.inputs && a.inputs.headers && a.inputs.headers.Authorization) {
    delete a.inputs.headers.Authorization;
    if (Object.keys(a.inputs.headers).length === 0) delete a.inputs.headers;
  }
  a.inputs.authentication = aadAuth(audience);
  a.runtimeConfiguration = { ...(a.runtimeConfiguration || {}), secureData: { properties: ['inputs'] } };
}
convertHttpToAad('List_environments', 'https://api.bap.microsoft.com/');

// Replace the broken BAP `tenantCapacity` endpoint with 3 licensing v2.0 tenant-level calls
// (one per dim: Database/File/Log), then aggregate. The BAP /scopes/admin/tenantCapacity
// endpoint returns 404 — it apparently doesn't exist. The licensing endpoint without the
// /environments/ segment returns tenant pool entitlement, allocated, consumed, available.
delete acts.Get_tenant_capacity;
delete acts.Parse_tenant_capacity_response;

function httpTenantDim(dim) {
  return {
    runAfter: { For_each_environment: ['Succeeded'] },
    type: 'Http',
    inputs: {
      method: 'GET',
      uri: `@{concat('https://licensing.powerplatform.microsoft.com/v2.0/tenants/', parameters('DSR Tenant ID (dsr_TenantId)'), '/entitlements/${dim}')}`,
      authentication: aadAuth('https://licensing.powerplatform.microsoft.com/')
    },
    runtimeConfiguration: { secureData: { properties: ['inputs'] } }
  };
}
function parseTenantDim(dim) {
  return {
    runAfter: { [`Get_tenant_${dim}`]: ['Succeeded'] },
    type: 'ParseJson',
    inputs: {
      content: `@body('Get_tenant_${dim}')`,
      schema: { type: 'object', properties: { entitlement: { type: 'object' } } }
    }
  };
}
for (const dim of DIMS) {
  acts[`Get_tenant_${dim}`] = httpTenantDim(dim);
  acts[`Parse_tenant_${dim}`] = parseTenantDim(dim);
}

if (acts.Get_BAP_admin_token) delete acts.Get_BAP_admin_token;
if (acts.Parse_token_response) delete acts.Parse_token_response;
if (acts.List_environments) acts.List_environments.runAfter = {};

// Drop any prior Until-loop scaffolding from earlier refactors (init vars + Until_<dim>)
for (const dim of DIMS) {
  delete acts[`Init_${dim}_Token`];
  delete acts[`Init_${dim}_All`];
  delete acts[`Init_${dim}_Done`];
  delete acts[`Until_${dim}`];
}

// ---- For_each_environment: rebuild inner actions ----
const fe = acts.For_each_environment.actions;

// Remove all legacy / prior-iteration inner actions (variable filters, BAP capacity, prior HTTP entitlements)
const innerToRemove = [
  'Get_database_entitlement', 'Get_file_entitlement', 'Get_log_entitlement',
  'Get_bap_capacity', 'Filter_db_capacity', 'Filter_file_capacity', 'Filter_log_capacity',
  'Get_capacity_consumption', 'Parse_capacity_response',
  'Filter_Database', 'Filter_File', 'Filter_Log',
  'Get_Database_entitlement', 'Get_File_entitlement', 'Get_Log_entitlement',
  'Parse_Database_entitlement', 'Parse_File_entitlement', 'Parse_Log_entitlement'
];
for (const k of innerToRemove) delete fe[k];

// HTTP GET v2.0 licensing endpoint per dim, scoped to the env display name.
// searchRequest filters by displayName; we then pick the matching environmentId in the response.
function httpDimEntitlement(dim) {
  return {
    runAfter: {},
    metadata: { operationMetadataId: `00000000-0000-0000-0000-${(0x200 + DIMS.indexOf(dim)).toString(16).padStart(12, '0')}` },
    type: 'Http',
    inputs: {
      method: 'GET',
      uri: `@{concat('https://licensing.powerplatform.microsoft.com/v2.0/tenants/', parameters('DSR Tenant ID (dsr_TenantId)'), '/environments/entitlements/${dim}?searchRequest=', encodeUriComponent(items('For_each_environment')?['properties']?['displayName']))}`,
      authentication: aadAuth('https://licensing.powerplatform.microsoft.com/')
    },
    runtimeConfiguration: { secureData: { properties: ['inputs'] } }
  };
}

function parseDimEntitlement(dim) {
  return {
    runAfter: { [`Get_${dim}_entitlement`]: ['Succeeded'] },
    metadata: { operationMetadataId: `00000000-0000-0000-0000-${(0x210 + DIMS.indexOf(dim)).toString(16).padStart(12, '0')}` },
    type: 'ParseJson',
    inputs: {
      content: `@body('Get_${dim}_entitlement')`,
      schema: {
        type: 'object',
        properties: {
          value: { type: 'array' }
        }
      }
    }
  };
}

// Filter the page response down to the row whose environmentId matches our env (case-insensitive).
// searchRequest filters by displayName; multiple matches possible if names collide.
function filterDimEntitlement(dim) {
  return {
    runAfter: { [`Parse_${dim}_entitlement`]: ['Succeeded'] },
    metadata: { operationMetadataId: `00000000-0000-0000-0000-${(0x220 + DIMS.indexOf(dim)).toString(16).padStart(12, '0')}` },
    type: 'Query',
    inputs: {
      from: `@coalesce(body('Parse_${dim}_entitlement')?['value'], json('[]'))`,
      where: `@equals(toLower(item()?['environmentId']), toLower(items('For_each_environment')?['name']))`
    }
  };
}

// Add the 3 entitlement HTTP + Parse + Filter chains to For_each_environment
for (const dim of DIMS) {
  fe[`Get_${dim}_entitlement`] = httpDimEntitlement(dim);
  fe[`Parse_${dim}_entitlement`] = parseDimEntitlement(dim);
  fe[`Filter_${dim}`] = filterDimEntitlement(dim);
}

// ---- Owner resolution via Microsoft Graph ----
// BAP admin scope returns createdBy.id (AAD object GUID) but scrubs displayName/email.
// Resolve via Graph if id is present; otherwise default to 'System'.
// Requires the SP to have User.Read.All Graph application permission (admin-consented).
delete fe.Get_owner_user;
delete fe.Parse_owner_user;
delete fe.If_owner_id_present;

fe.If_owner_id_present = {
  runAfter: {},
  metadata: { operationMetadataId: '00000000-0000-0000-0000-000000000300' },
  type: 'If',
  expression: {
    and: [
      { not: { equals: [ "@coalesce(items('For_each_environment')?['properties']?['createdBy']?['id'], '')", '' ] } }
    ]
  },
  actions: {
    Get_owner_user: {
      runAfter: {},
      metadata: { operationMetadataId: '00000000-0000-0000-0000-000000000301' },
      type: 'Http',
      inputs: {
        method: 'GET',
        uri: "@{concat('https://graph.microsoft.com/v1.0/users/', items('For_each_environment')?['properties']?['createdBy']?['id'], '?$select=displayName,mail,userPrincipalName')}",
        authentication: aadAuth('https://graph.microsoft.com')
      },
      runtimeConfiguration: {
        secureData: { properties: ['inputs'] },
        // Don't fail iteration on stale GUIDs (deleted users). Retry off; downstream Parse will see empty body if it 404s.
        retryPolicy: { type: 'none' }
      }
    },
    Parse_owner_user: {
      runAfter: { Get_owner_user: ['Succeeded', 'Failed'] },
      metadata: { operationMetadataId: '00000000-0000-0000-0000-000000000302' },
      type: 'ParseJson',
      inputs: {
        content: "@coalesce(body('Get_owner_user'), json('{}'))",
        schema: {
          type: 'object',
          properties: {
            displayName: { type: ['string', 'null'] },
            mail: { type: ['string', 'null'] },
            userPrincipalName: { type: ['string', 'null'] }
          }
        }
      }
    }
  },
  else: { actions: {} }
};

// Upsert_environment fix: HEAD's UpdateRecordWithAlternateKey expects a `dsr_environmentguid` alt key
// that isn't defined; revert to UpdateRecord with the row's GUID PK derived from env name
// (strip the "Default-" prefix for default envs).
const recordIdExpr = "@{if(startsWith(items('For_each_environment')?['name'], 'Default-'), substring(items('For_each_environment')?['name'], 8, sub(length(items('For_each_environment')?['name']), 8)), items('For_each_environment')?['name'])}";
if (fe.Upsert_environment) {
  fe.Upsert_environment.runAfter = { If_owner_id_present: ['Succeeded'] };
  fe.Upsert_environment.inputs.host.operationId = 'UpdateRecord';
  const p = fe.Upsert_environment.inputs.parameters;
  delete p.alternateKeyName;
  delete p.alternateKeyValue;
  p.recordId = recordIdExpr;
  p['item/dsr_environmentguid'] = "@{items('For_each_environment')?['name']}";
  // Owner: prefer Graph result, fall back to 'System' for service-created envs or when Graph 404s.
  p['item/dsr_ownername']  = "@{coalesce(body('Parse_owner_user')?['displayName'], 'System')}";
  p['item/dsr_owneremail'] = "@{coalesce(body('Parse_owner_user')?['mail'], body('Parse_owner_user')?['userPrincipalName'], 'System')}";
}

// Add_storage_snapshot wires off Filter_Log (last filter) and uses the stripped GUID for the env lookup
const dbEnt = "first(body('Filter_Database'))?['entitlement']";
const fileEnt = "first(body('Filter_File'))?['entitlement']";
const logEnt = "first(body('Filter_Log'))?['entitlement']";

function consumed(ent)   { return `coalesce(${ent}?['capacity']?['consumed']?['value'], 0)`; }
function allocated(ent)  { return `coalesce(${ent}?['capacity']?['allocated']?['value'], 0)`; }
function pgEntitled(ent) { return `coalesce(${ent}?['payGo']?['entitled']?['value'], 0)`; }
function pgConsumed(ent) { return `coalesce(${ent}?['payGo']?['consumed']?['value'], 0)`; }
function avail(ent)      { return `coalesce(${ent}?['capacity']?['availableQuantity'], 0)`; }

if (fe.Add_storage_snapshot) {
  fe.Add_storage_snapshot.runAfter = {
    Upsert_environment: ['Succeeded'],
    Filter_Database: ['Succeeded'],
    Filter_File: ['Succeeded'],
    Filter_Log: ['Succeeded']
  };
  const sp = fe.Add_storage_snapshot.inputs.parameters;
  sp['item/dsr_Environment@odata.bind'] = `/dsr_environments(${recordIdExpr})`;
  delete sp['item/dsr_environment@odata.bind'];
  sp['item/dsr_dballocatedgb']     = `@div(mul(${allocated(dbEnt)}, 1.0), 1024.0)`;
  sp['item/dsr_dbusedgb']          = `@div(mul(${consumed(dbEnt)}, 1.0), 1024.0)`;
  sp['item/dsr_fileallocatedgb']   = `@div(mul(${allocated(fileEnt)}, 1.0), 1024.0)`;
  sp['item/dsr_fileusedgb']        = `@div(mul(${consumed(fileEnt)}, 1.0), 1024.0)`;
  sp['item/dsr_logallocatedgb']    = `@div(mul(${allocated(logEnt)}, 1.0), 1024.0)`;
  sp['item/dsr_logusedgb']         = `@div(mul(${consumed(logEnt)}, 1.0), 1024.0)`;
  sp['item/dsr_paygoenabled']      = `@or(or(greater(${pgEntitled(dbEnt)}, 0), greater(${pgEntitled(fileEnt)}, 0)), greater(${pgEntitled(logEnt)}, 0))`;
  sp['item/dsr_paygoconsumptiongb'] = `@div(mul(add(add(${pgConsumed(dbEnt)}, ${pgConsumed(fileEnt)}), ${pgConsumed(logEnt)}), 1.0), 1024.0)`;
  sp['item/dsr_overagegb'] = `@div(mul(add(add(if(less(${avail(dbEnt)}, 0), mul(${avail(dbEnt)}, -1), 0), if(less(${avail(fileEnt)}, 0), mul(${avail(fileEnt)}, -1), 0)), if(less(${avail(logEnt)}, 0), mul(${avail(logEnt)}, -1), 0)), 1.0), 1024.0)`;
}

// Set parallelism on For_each_environment so dim fetches fan out across envs.
acts.For_each_environment.runtimeConfiguration = {
  ...(acts.For_each_environment.runtimeConfiguration || {}),
  concurrency: { repetitions: 20 }
};

// Rewire For_each_environment to start right after Parse_environments_response
acts.For_each_environment.runAfter = { Parse_environments_response: ['Succeeded'] };

// Rewire Add_tenant_pool_snapshot to depend on the 3 parsed tenant-dim responses, and aggregate
// across dims (MB → GB). Tenant pool fields:
//   dsr_totalallocatedgb = sum of allocated.value across 3 dims (MB) / 1024
//   dsr_totalusedgb      = sum of consumed.value across 3 dims  (MB) / 1024
//   dsr_availablegb      = sum of availableQuantity across 3 dims (MB) / 1024
//   dsr_paygoaccrualgb   = sum of payGo.consumed.value across 3 dims (MB) / 1024
if (acts.Add_tenant_pool_snapshot) {
  acts.Add_tenant_pool_snapshot.runAfter = {
    Parse_tenant_Database: ['Succeeded'],
    Parse_tenant_File: ['Succeeded'],
    Parse_tenant_Log: ['Succeeded']
  };
  const tp = acts.Add_tenant_pool_snapshot.inputs.parameters;
  function tEnt(dim) { return `body('Parse_tenant_${dim}')?['entitlement']`; }
  function tCap(dim, path) { return `coalesce(${tEnt(dim)}?['capacity']?${path}, 0)`; }
  function tPgConsumed(dim) { return `coalesce(${tEnt(dim)}?['payGo']?['consumed']?['value'], 0)`; }
  const sumAllocated = `add(add(${tCap('Database', "['allocated']?['value']")}, ${tCap('File', "['allocated']?['value']")}), ${tCap('Log', "['allocated']?['value']")})`;
  const sumConsumed  = `add(add(${tCap('Database', "['consumed']?['value']")}, ${tCap('File', "['consumed']?['value']")}), ${tCap('Log', "['consumed']?['value']")})`;
  const sumAvailable = `add(add(${tCap('Database', "['availableQuantity']")}, ${tCap('File', "['availableQuantity']")}), ${tCap('Log', "['availableQuantity']")})`;
  const sumPayGo     = `add(add(${tPgConsumed('Database')}, ${tPgConsumed('File')}), ${tPgConsumed('Log')})`;
  tp['item/dsr_totalallocatedgb'] = `@{div(mul(${sumAllocated}, 1.0), 1024.0)}`;
  tp['item/dsr_totalusedgb']      = `@{div(mul(${sumConsumed}, 1.0), 1024.0)}`;
  tp['item/dsr_availablegb']      = `@{div(mul(${sumAvailable}, 1.0), 1024.0)}`;
  tp['item/dsr_paygoaccrualgb']   = `@{div(mul(${sumPayGo}, 1.0), 1024.0)}`;
}

// List_old_snapshots needs to wait for the snapshot writes — but tenant snapshot now depends on
// the 3 tenant-dim parses, so just leave its existing runAfter pointing at Add_tenant_pool_snapshot.

// Ensure every action and trigger has a metadata.operationMetadataId (new designer relies on these for layout).
let metaCounter = 0x100;
function nextMetaId() {
  const hex = (metaCounter++).toString(16).padStart(12, '0');
  return `00000000-0000-0000-0000-${hex}`;
}
function ensureMeta(actionsObj) {
  if (!actionsObj || typeof actionsObj !== 'object') return;
  for (const a of Object.values(actionsObj)) {
    if (a && typeof a === 'object') {
      if (!a.metadata || !a.metadata.operationMetadataId) {
        a.metadata = { ...(a.metadata || {}), operationMetadataId: nextMetaId() };
      }
      if (a.actions) ensureMeta(a.actions);
      if (a.else && a.else.actions) ensureMeta(a.else.actions);
      if (a.cases) for (const c of Object.values(a.cases)) if (c && c.actions) ensureMeta(c.actions);
    }
  }
}
ensureMeta(def.actions);
if (def.triggers) {
  for (const t of Object.values(def.triggers)) {
    if (t && (!t.metadata || !t.metadata.operationMetadataId)) {
      t.metadata = { ...(t.metadata || {}), operationMetadataId: nextMetaId() };
    }
  }
}

fs.writeFileSync(FLOW, JSON.stringify(doc, null, 2));
fs.writeFileSync(MIRROR, JSON.stringify(doc, null, 2));

// Map environment('dsr_X') → parameters('<DisplayName> (dsr_X)') for every env var.
// Power Automate's WDL has no environment() function; solution env vars are exposed as flow parameters.
const ENV_DISPLAY = {
  dsr_TenantId: 'DSR Tenant ID',
  dsr_AdminClientId: 'DSR Admin Client ID',
  dsr_BapApiVersion: 'DSR BAP API Version',
  dsr_HistoryRetentionDays: 'DSR History Retention Days',
  // dsr_AdminClientSecret is intentionally not mapped — kept as hardcoded placeholder
  // string (REPLACE_WITH_CLIENT_SECRET) inline in the AAD auth blocks until the
  // secret env var can be configured in this environment.
};
for (const file of [FLOW, MIRROR]) {
  let txt = fs.readFileSync(file, 'utf8');
  for (const [schema, display] of Object.entries(ENV_DISPLAY)) {
    const re = new RegExp(`environment\\('${schema}'\\)`, 'g');
    txt = txt.replace(re, `parameters('${display} (${schema})')`);
  }
  fs.writeFileSync(file, txt);
}

console.log('Refactored. Top-level actions:', Object.keys(def.actions).join(', '));
console.log('For_each_environment sub-actions:', Object.keys(fe).join(', '));
console.log('For_each_environment concurrency:', acts.For_each_environment.runtimeConfiguration.concurrency.repetitions);
