import type { DataverseClient } from '../dataverse/DataverseClient'
import {
  mapEnvironment,
  mapSetting,
  mapSnapshot,
  mapTenantPool,
  type DataverseEnvironment,
  type DataverseSetting,
  type DataverseStorageSnapshot,
  type DataverseTenantPool,
} from '../dataverse/mappers'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type EnvironmentRow,
  type StorageSnapshot,
  type TenantPool,
} from '../domain/types'
import type { StorageRepository } from './StorageRepository'

const ENVIRONMENT_SET = 'dsr_environments'
const SNAPSHOT_SET = 'dsr_storagesnapshots'
const POOL_SET = 'dsr_tenantpools'
const SETTING_SET = 'dsr_settings'

export class DataverseStorageRepository implements StorageRepository {
  private readonly client: DataverseClient

  constructor(client: DataverseClient) {
    this.client = client
  }

  async listEnvironments(): Promise<EnvironmentRow[]> {
    const rows = await this.client.list<DataverseEnvironment>(
      ENVIRONMENT_SET,
      '$orderby=dsr_displayname asc',
    )
    return rows.map(mapEnvironment)
  }

  async listLatestSnapshots(): Promise<StorageSnapshot[]> {
    // Pull the most recent snapshot per environment. Dataverse doesn't have a
    // grouped-top query, so we fetch the latest N snapshots ordered by capture
    // time and de-dupe client-side. The ingest flow keeps history small enough
    // that a generous top is fine for typical tenants.
    const rows = await this.client.list<DataverseStorageSnapshot>(
      SNAPSHOT_SET,
      '$orderby=dsr_capturedat desc&$top=500',
    )
    const mapped = rows.map(mapSnapshot)
    const byEnv = new Map<string, StorageSnapshot>()
    for (const s of mapped) {
      if (!byEnv.has(s.environmentId)) byEnv.set(s.environmentId, s)
    }
    return Array.from(byEnv.values())
  }

  async getTenantPool(): Promise<TenantPool | null> {
    const rows = await this.client.list<DataverseTenantPool>(
      POOL_SET,
      '$orderby=dsr_capturedat desc&$top=1',
    )
    return rows[0] ? mapTenantPool(rows[0]) : null
  }

  async getSettings(): Promise<AppSettings> {
    const rows = await this.client.list<DataverseSetting>(SETTING_SET, '$top=1')
    return rows[0] ? mapSetting(rows[0]) : { ...DEFAULT_SETTINGS }
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    const rows = await this.client.list<DataverseSetting>(SETTING_SET, '$top=1&$select=dsr_settingid')
    const body = {
      dsr_warnpercent: settings.warnPercent,
      dsr_criticalpercent: settings.criticalPercent,
      dsr_defaultenvironmenttypes: settings.defaultEnvironmentTypes.join(','),
    }
    if (rows[0]) {
      await this.client.update(SETTING_SET, rows[0].dsr_settingid, body)
    } else {
      await this.client.create(SETTING_SET, { ...body, dsr_name: 'default' })
    }
  }
}
