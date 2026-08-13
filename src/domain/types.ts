export type AppUser = {
  displayName: string
  username: string
}

export type EnvironmentType =
  | 'Production'
  | 'Sandbox'
  | 'Trial'
  | 'Default'
  | 'Developer'
  | 'Teams'
  | 'Unknown'

export type BillingModel = 'License' | 'PayAsYouGo' | 'Unknown'

export type EnvironmentRow = {
  id: string
  environmentId: string
  displayName: string
  type: EnvironmentType
  region: string
  ownerEmail: string
  ownerName: string
  billingModel: BillingModel
  payGoSubscriptionId?: string
  url?: string
}

export type StorageKind = 'database' | 'file' | 'log'

export type StorageDimension = {
  allocatedGb: number
  usedGb: number
  percent: number
}

export type StorageSnapshot = {
  id: string
  environmentId: string
  capturedAt: string
  database: StorageDimension
  file: StorageDimension
  log: StorageDimension
  payGoEnabled: boolean
  payGoConsumptionGb: number
  overageGb: number
}

export type Thresholds = {
  warnPercent: number
  criticalPercent: number
}

export type StorageStatus = 'ok' | 'warn' | 'over'

export type TriggeredBy = {
  kind: StorageKind
  status: 'warn' | 'over'
  percent: number
}[]

export type EvaluatedRow = {
  environment: EnvironmentRow
  snapshot: StorageSnapshot | null
  status: StorageStatus
  triggers: TriggeredBy
  payGoFlag: boolean
}

export type AppSettings = {
  warnPercent: number
  criticalPercent: number
  defaultEnvironmentTypes: EnvironmentType[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  warnPercent: 80,
  criticalPercent: 100,
  defaultEnvironmentTypes: ['Production', 'Sandbox'],
}

// Per-table row-count drill-in response. Bytes-per-table is not currently
// exposed by any Microsoft API to non-preauthorized apps (see docs); we fall
// back to row counts via the target env's Dataverse Web API. Real-time, no
// cataloging.
export type TableRowCountRow = {
  logicalName: string
  displayName: string
  rowCount: number
  isCustom: boolean
}

export type TableRowCountResponse = {
  envId: string
  envUrl: string
  fetchedAt: string
  rows: TableRowCountRow[]
}

export const ALL_ENVIRONMENT_TYPES: EnvironmentType[] = [
  'Production',
  'Sandbox',
  'Trial',
  'Default',
  'Developer',
  'Teams',
  'Unknown',
]

// Whether an environment type draws from the shared tenant Dataverse storage pool.
// Developer, Teams, and Trial environments have their own per-license/per-user
// allocations that do NOT count against the tenant pool — admins managing pool
// capacity typically want to filter those out.
export function isPoolImpacting(type: EnvironmentType): boolean {
  switch (type) {
    case 'Developer':
    case 'Teams':
    case 'Trial':
      return false
    default:
      return true
  }
}
