import { getClient, type DataClient } from '@microsoft/power-apps/data'
import { dataSourcesInfo } from '../powerapps/dataSourcesInfo'
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

const ENVIRONMENT_DS = 'dsr_environments'
const SNAPSHOT_DS = 'dsr_storagesnapshots'
const SETTING_DS = 'dsr_settings'

/**
 * Storage repository backed by the Power Apps Code App SDK data runtime.
 * No bearer token plumbing — the platform mediates auth via the hosted iframe.
 */
export class PowerAppsStorageRepository implements StorageRepository {
  private readonly client: DataClient

  constructor() {
    this.client = getClient(dataSourcesInfo)
  }

  async listEnvironments(): Promise<EnvironmentRow[]> {
    const all: DataverseEnvironment[] = []
    let skipToken: string | undefined
    for (let page = 0; page < 50; page += 1) {
      const res = await this.client.retrieveMultipleRecordsAsync<DataverseEnvironment>(
        ENVIRONMENT_DS,
        {
          orderBy: ['dsr_displayname asc'],
          maxPageSize: 5000,
          ...(skipToken ? { skipToken } : {}),
        },
      )
      throwIfFailed(res, 'list environments')
      for (const row of res.data ?? []) all.push(row)
      skipToken = res.skipToken
      if (!skipToken) break
    }
    return all.map(mapEnvironment)
  }

  async listLatestSnapshots(): Promise<StorageSnapshot[]> {
    // Snapshots accumulate one row per env per ingest run. We want the newest
    // per env regardless of age — the ingest flow may have been off for a
    // while — so we scan newest-first and take the first row we see for each
    // env id, with a hard scan cap as a safety net.
    const byEnv = new Map<string, StorageSnapshot>()
    let skipToken: string | undefined
    let scanned = 0
    const MAX_SCAN = 20000
    for (let page = 0; page < 50; page += 1) {
      const res = await this.client.retrieveMultipleRecordsAsync<DataverseStorageSnapshot>(
        SNAPSHOT_DS,
        {
          orderBy: ['dsr_capturedat desc'],
          maxPageSize: 5000,
          ...(skipToken ? { skipToken } : {}),
        },
      )
      throwIfFailed(res, 'list snapshots')
      for (const row of res.data ?? []) {
        scanned += 1
        const snap = mapSnapshot(row)
        if (!byEnv.has(snap.environmentId)) byEnv.set(snap.environmentId, snap)
      }
      skipToken = res.skipToken
      if (!skipToken) break
      if (scanned >= MAX_SCAN) break
    }
    return Array.from(byEnv.values())
  }

  async getSettings(): Promise<AppSettings> {
    const res = await this.client.retrieveMultipleRecordsAsync<DataverseSetting>(
      SETTING_DS,
      { top: 1 },
    )
    throwIfFailed(res, 'load settings')
    const row = res.data?.[0]
    return row ? mapSetting(row) : { ...DEFAULT_SETTINGS }
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    const existing = await this.client.retrieveMultipleRecordsAsync<DataverseSetting>(
      SETTING_DS,
      { top: 1, select: ['dsr_settingid'] },
    )
    throwIfFailed(existing, 'load settings')
    const body = {
      dsr_warnpercent: settings.warnPercent,
      dsr_criticalpercent: settings.criticalPercent,
      dsr_defaultenvironmenttypes: settings.defaultEnvironmentTypes.join(','),
    }
    const row = existing.data?.[0]
    if (row) {
      const result = await this.client.updateRecordAsync(SETTING_DS, row.dsr_settingid, body)
      throwIfFailed(result, 'update settings')
    } else {
      const result = await this.client.createRecordAsync(SETTING_DS, {
        ...body,
        dsr_name: 'default',
      })
      throwIfFailed(result, 'create settings')
    }
  }

  async getTableStorage(
    envId: string,
    dimension: TableStorageDimension,
    query?: TableStorageQuery,
  ): Promise<TableStorageResponse> {
    return invokeTableStorageFlow({
      envId, dimension, search: query?.search,
    })
  }
}

function throwIfFailed<T>(res: { success: boolean; error?: Error | unknown }, action: string): asserts res is { success: true } & T {
  if (!res.success) {
    const msg = res.error instanceof Error ? res.error.message : String(res.error ?? 'unknown error')
    throw new Error(`Power Apps data runtime failed to ${action}: ${msg}`)
  }
}
