import type {
  AppSettings,
  EnvironmentRow,
  StorageSnapshot,
} from '../domain/types'

export interface StorageRepository {
  listEnvironments(): Promise<EnvironmentRow[]>
  listLatestSnapshots(): Promise<StorageSnapshot[]>
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<void>
}
