import type { DataverseClient } from '../dataverse/DataverseClient'
import {
  mapEnvironment,
  mapSetting,
  mapSnapshot,
  type DataverseEnvironment,
  type DataverseSetting,
  type DataverseStorageSnapshot,
} from '../dataverse/mappers'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type EnvironmentRow,
  type StorageSnapshot,
  type TableRowCountResponse,
} from '../domain/types'
import type { StorageRepository } from './StorageRepository'
import { fetchTableRowCounts } from './tableStorageFlowClient'

const ENVIRONMENT_SET = 'dsr_environments'
const SNAPSHOT_SET = 'dsr_storagesnapshots'
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
    // Newest snapshot per env, regardless of age. The ingest flow may have
    // been paused; we don't want to hide stale-but-real data.
    const query = `$orderby=dsr_capturedat desc`
    const rows = await this.client.listAll<DataverseStorageSnapshot>(SNAPSHOT_SET, query)
    const byEnv = new Map<string, StorageSnapshot>()
    for (const row of rows) {
      const snap = mapSnapshot(row)
      if (!byEnv.has(snap.environmentId)) byEnv.set(snap.environmentId, snap)
    }
    return Array.from(byEnv.values())
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

  async getTableRowCounts(env: EnvironmentRow, opts?: { force?: boolean }): Promise<TableRowCountResponse> {
    return fetchTableRowCounts(env, opts)
  }
}
