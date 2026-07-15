import type {
  AppSettings,
  BillingModel,
  EnvironmentRow,
  EnvironmentType,
  StorageSnapshot,
} from '../domain/types'

export type DataverseEnvironment = {
  dsr_environmentid: string
  dsr_environmentguid: string
  dsr_displayname: string
  dsr_type: string
  dsr_region: string
  dsr_owneremail: string
  dsr_ownername: string
  dsr_billingmodel: string
  dsr_paygosubscriptionid?: string
  dsr_url?: string
}

export type DataverseStorageSnapshot = {
  dsr_storagesnapshotid: string
  _dsr_environment_value?: string
  dsr_environment?: unknown
  'dsr_Environment@odata.bind'?: string
  dsr_capturedat: string
  dsr_dballocatedgb: number
  dsr_dbusedgb: number
  dsr_fileallocatedgb: number
  dsr_fileusedgb: number
  dsr_logallocatedgb: number
  dsr_logusedgb: number
  dsr_paygoenabled: boolean
  dsr_paygoconsumptiongb: number
  dsr_overagegb: number
}

export type DataverseSetting = {
  dsr_settingid: string
  dsr_warnpercent: number
  dsr_criticalpercent: number
  dsr_defaultenvironmenttypes: string
  dsr_tablestorageflowurl?: string
}

function asType(value: string): EnvironmentType {
  const allowed: EnvironmentType[] = [
    'Production', 'Sandbox', 'Trial', 'Default', 'Developer', 'Teams', 'Unknown',
  ]
  return (allowed.find((t) => t.toLowerCase() === value?.toLowerCase()) ?? 'Unknown')
}

function asBilling(value: string): BillingModel {
  if (!value) return 'Unknown'
  if (value.toLowerCase().includes('paygo') || value.toLowerCase().includes('pay-as')) {
    return 'PayAsYouGo'
  }
  if (value.toLowerCase().includes('license')) return 'License'
  return 'Unknown'
}

function pct(used: number, allocated: number): number {
  const u = Number(used) || 0
  const a = Number(allocated) || 0
  if (a <= 0) return 0
  return Math.round((u / a) * 1000) / 10
}

function n(value: unknown): number {
  const x = Number(value)
  return Number.isFinite(x) ? x : 0
}

function s(value: unknown): string {
  return value == null ? '' : String(value)
}

export function mapEnvironment(row: DataverseEnvironment): EnvironmentRow {
  return {
    id: s(row.dsr_environmentid).toLowerCase(),
    environmentId: s(row.dsr_environmentguid),
    displayName: s(row.dsr_displayname),
    type: asType(s(row.dsr_type)),
    region: s(row.dsr_region),
    ownerEmail: s(row.dsr_owneremail),
    ownerName: s(row.dsr_ownername),
    billingModel: asBilling(s(row.dsr_billingmodel)),
    payGoSubscriptionId: row.dsr_paygosubscriptionid ?? undefined,
    url: row.dsr_url ?? undefined,
  }
}

export function mapSnapshot(row: DataverseStorageSnapshot): StorageSnapshot {
  const dbAlloc = n(row.dsr_dballocatedgb)
  const dbUsed = n(row.dsr_dbusedgb)
  const fileAlloc = n(row.dsr_fileallocatedgb)
  const fileUsed = n(row.dsr_fileusedgb)
  const logAlloc = n(row.dsr_logallocatedgb)
  const logUsed = n(row.dsr_logusedgb)
  return {
    id: s(row.dsr_storagesnapshotid),
    environmentId: extractLookupId(row),
    capturedAt: s(row.dsr_capturedat),
    database: { allocatedGb: dbAlloc, usedGb: dbUsed, percent: pct(dbUsed, dbAlloc) },
    file: { allocatedGb: fileAlloc, usedGb: fileUsed, percent: pct(fileUsed, fileAlloc) },
    log: { allocatedGb: logAlloc, usedGb: logUsed, percent: pct(logUsed, logAlloc) },
    payGoEnabled: Boolean(row.dsr_paygoenabled),
    payGoConsumptionGb: n(row.dsr_paygoconsumptiongb),
    overageGb: n(row.dsr_overagegb),
  }
}

const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function extractLookupId(row: DataverseStorageSnapshot): string {
  // The Power Apps Code App SDK doesn't normalize lookup column names. Depending
  // on the platform version we've seen the env reference surface as
  //   _dsr_environment_value (Web API style)
  //   dsr_environment        (string GUID, or { id } / { dsr_environmentid } object)
  //   dsr_Environment@odata.bind = "/dsr_environments({guid})"
  // Look in all three so the join to dsr_environments doesn't silently drop rows.
  const candidates: unknown[] = [
    row._dsr_environment_value,
    row.dsr_environment,
    row['dsr_Environment@odata.bind'],
  ]
  for (const c of candidates) {
    if (!c) continue
    if (typeof c === 'string') {
      const m = c.match(GUID_RE)
      if (m) return m[0].toLowerCase()
    } else if (typeof c === 'object') {
      const o = c as Record<string, unknown>
      const id = (o.id ?? o.dsr_environmentid ?? o.value) as string | undefined
      if (typeof id === 'string') {
        const m = id.match(GUID_RE)
        if (m) return m[0].toLowerCase()
      }
    }
  }
  return ''
}

export function mapSetting(row: DataverseSetting): AppSettings {
  return {
    warnPercent: n(row.dsr_warnpercent) || 80,
    criticalPercent: n(row.dsr_criticalpercent) || 100,
    defaultEnvironmentTypes: (s(row.dsr_defaultenvironmenttypes) || 'Production,Sandbox')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean) as EnvironmentType[],
    tableStorageFlowUrl: s(row.dsr_tablestorageflowurl),
  }
}
