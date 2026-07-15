import type {
  AppSettings,
  EnvironmentRow,
  StorageSnapshot,
  TableStorageDimension,
  TableStorageQuery,
  TableStorageResponse,
} from '../domain/types'

export interface StorageRepository {
  listEnvironments(): Promise<EnvironmentRow[]>
  listLatestSnapshots(): Promise<StorageSnapshot[]>
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<void>
  // Per-table storage drill-in for one env + dimension. Real-time (not cached
  // in Dataverse) — the implementation forwards to the dsr-gettablestorage
  // flow, which proxies the licensing.powerplatform.microsoft.com endpoint.
  // Throws if the flow URL isn't configured in settings.
  getTableStorage(
    envId: string,
    dimension: TableStorageDimension,
    query?: TableStorageQuery,
  ): Promise<TableStorageResponse>
}
