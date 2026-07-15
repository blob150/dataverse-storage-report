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
  // HTTP-trigger URL for the dsr-gettablestorage flow. Populated post-import
  // from the flow's "When an HTTP request is received" trigger URL. Empty
  // means the per-table drill-in is disabled.
  tableStorageFlowUrl: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  warnPercent: 80,
  criticalPercent: 100,
  defaultEnvironmentTypes: ['Production', 'Sandbox'],
  tableStorageFlowUrl: '',
}

// Dimension of Dataverse storage we drill into per environment.
// Maps directly to the licensing entitlement path segment.
export type TableStorageDimension = 'Database' | 'File' | 'Log'

export const TABLE_STORAGE_DIMENSIONS: TableStorageDimension[] = ['Database', 'File', 'Log']

// One row in the per-table storage response for a given env + dimension.
// resourceId is the raw SQL/logical table name from the licensing service
// (may be a *Base suffix or a SQL system view like sys_columns). consumedMb
// is the storage consumption in megabytes even though the wire "unit" field
// is literally the string "Count".
export type TableStorageRow = {
  resourceId: string
  consumedMb: number
  lastRefreshedDate: string
}

// Full response the drawer works with. hasMore indicates whether a follow-up
// paged request would return more rows (skip += top).
export type TableStorageResponse = {
  envId: string
  dimension: TableStorageDimension
  rows: TableStorageRow[]
  hasMore: boolean
  // Latest lastRefreshedDate across returned rows — surfaced in the UI so
  // users know how stale the licensing-service snapshot is.
  latestRefreshDate: string | null
}

export type TableStorageQuery = {
  search?: string
  skip?: number
  top?: number
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
