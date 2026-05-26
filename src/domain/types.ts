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

export type TenantPool = {
  id: string
  capturedAt: string
  totalAllocatedGb: number
  totalUsedGb: number
  availableGb: number
  payGoAccrualGb: number
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

export const ALL_ENVIRONMENT_TYPES: EnvironmentType[] = [
  'Production',
  'Sandbox',
  'Trial',
  'Default',
  'Developer',
  'Teams',
  'Unknown',
]
