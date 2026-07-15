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
  type TableStorageDimension,
  type TableStorageQuery,
  type TableStorageResponse,
} from '../domain/types'
import type { StorageRepository } from './StorageRepository'
import { invokeTableStorageFlow } from './tableStorageFlowClient'

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
    // Snapshots accumulate per ingest run; pull the last 48h and paginate so
    // every environment's most recent row is included even when the history
    // table holds many thousands of older snapshots.
    const sinceIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const query = `$orderby=dsr_capturedat desc&$filter=dsr_capturedat gt ${sinceIso}`
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
      dsr_tablestorageflowurl: settings.tableStorageFlowUrl ?? '',
    }
    if (rows[0]) {
      await this.client.update(SETTING_SET, rows[0].dsr_settingid, body)
    } else {
      await this.client.create(SETTING_SET, { ...body, dsr_name: 'default' })
    }
  }

  async getTableStorage(
    envId: string,
    dimension: TableStorageDimension,
    query?: TableStorageQuery,
  ): Promise<TableStorageResponse> {
    const settings = await this.getSettings()
    return invokeTableStorageFlow(settings.tableStorageFlowUrl, {
      envId, dimension, search: query?.search, skip: query?.skip, top: query?.top,
    })
  }
}
