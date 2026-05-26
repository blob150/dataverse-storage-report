import type {
  AppSettings,
  BillingModel,
  EnvironmentRow,
  EnvironmentType,
  StorageSnapshot,
  TenantPool,
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
  _dsr_environment_value: string
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

export type DataverseTenantPool = {
  dsr_tenantpoolid: string
  dsr_capturedat: string
  dsr_totalallocatedgb: number
  dsr_totalusedgb: number
  dsr_availablegb: number
  dsr_paygoaccrualgb: number
}

export type DataverseSetting = {
  dsr_settingid: string
  dsr_warnpercent: number
  dsr_criticalpercent: number
  dsr_defaultenvironmenttypes: string
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
  if (!allocated || allocated <= 0) return 0
  return Math.round((used / allocated) * 1000) / 10
}

export function mapEnvironment(row: DataverseEnvironment): EnvironmentRow {
  return {
    id: row.dsr_environmentid,
    environmentId: row.dsr_environmentguid,
    displayName: row.dsr_displayname,
    type: asType(row.dsr_type),
    region: row.dsr_region,
    ownerEmail: row.dsr_owneremail,
    ownerName: row.dsr_ownername,
    billingModel: asBilling(row.dsr_billingmodel),
    payGoSubscriptionId: row.dsr_paygosubscriptionid,
    url: row.dsr_url,
  }
}

export function mapSnapshot(row: DataverseStorageSnapshot): StorageSnapshot {
  return {
    id: row.dsr_storagesnapshotid,
    environmentId: row._dsr_environment_value,
    capturedAt: row.dsr_capturedat,
    database: {
      allocatedGb: row.dsr_dballocatedgb ?? 0,
      usedGb: row.dsr_dbusedgb ?? 0,
      percent: pct(row.dsr_dbusedgb ?? 0, row.dsr_dballocatedgb ?? 0),
    },
    file: {
      allocatedGb: row.dsr_fileallocatedgb ?? 0,
      usedGb: row.dsr_fileusedgb ?? 0,
      percent: pct(row.dsr_fileusedgb ?? 0, row.dsr_fileallocatedgb ?? 0),
    },
    log: {
      allocatedGb: row.dsr_logallocatedgb ?? 0,
      usedGb: row.dsr_logusedgb ?? 0,
      percent: pct(row.dsr_logusedgb ?? 0, row.dsr_logallocatedgb ?? 0),
    },
    payGoEnabled: row.dsr_paygoenabled ?? false,
    payGoConsumptionGb: row.dsr_paygoconsumptiongb ?? 0,
    overageGb: row.dsr_overagegb ?? 0,
  }
}

export function mapTenantPool(row: DataverseTenantPool): TenantPool {
  return {
    id: row.dsr_tenantpoolid,
    capturedAt: row.dsr_capturedat,
    totalAllocatedGb: row.dsr_totalallocatedgb ?? 0,
    totalUsedGb: row.dsr_totalusedgb ?? 0,
    availableGb: row.dsr_availablegb ?? 0,
    payGoAccrualGb: row.dsr_paygoaccrualgb ?? 0,
  }
}

export function mapSetting(row: DataverseSetting): AppSettings {
  return {
    warnPercent: row.dsr_warnpercent ?? 80,
    criticalPercent: row.dsr_criticalpercent ?? 100,
    defaultEnvironmentTypes: (row.dsr_defaultenvironmenttypes ?? 'Production,Sandbox')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as EnvironmentType[],
  }
}
