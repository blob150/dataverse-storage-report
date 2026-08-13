import type {
  AppSettings,
  EnvironmentRow,
  StorageSnapshot,
  TableRowCountResponse,
} from '../domain/types'

export interface StorageRepository {
  listEnvironments(): Promise<EnvironmentRow[]>
  listLatestSnapshots(): Promise<StorageSnapshot[]>
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<void>
  // Per-table row counts for the env drill-in. Uses the target env's Dataverse
  // Web API with the signed-in user's delegated token via MSAL popup. Users
  // need Read privilege on the entities in the target env.
  getTableRowCounts(env: EnvironmentRow, opts?: { force?: boolean }): Promise<TableRowCountResponse>
}
