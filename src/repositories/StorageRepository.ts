import type {
  AppSettings,
  EnvironmentRow,
  StorageSnapshot,
  TenantPool,
} from '../domain/types'

export interface StorageRepository {
  listEnvironments(): Promise<EnvironmentRow[]>
  listLatestSnapshots(): Promise<StorageSnapshot[]>
  getTenantPool(): Promise<TenantPool | null>
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<void>
}
