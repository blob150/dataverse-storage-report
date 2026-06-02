import type { AppSettings, EnvironmentRow, StorageSnapshot } from '../domain/types'
import { mockEnvironments, mockSettings, mockSnapshots } from '../data/mockData'
import type { StorageRepository } from './StorageRepository'

export class MockStorageRepository implements StorageRepository {
  private settings: AppSettings = { ...mockSettings }

  async listEnvironments(): Promise<EnvironmentRow[]> { return mockEnvironments }
  async listLatestSnapshots(): Promise<StorageSnapshot[]> { return mockSnapshots }
  async getSettings(): Promise<AppSettings> { return this.settings }
  async saveSettings(settings: AppSettings): Promise<void> { this.settings = settings }
}
