import type { AppSettings, EnvironmentRow, StorageSnapshot, TenantPool } from '../domain/types'
import { mockEnvironments, mockSettings, mockSnapshots, mockTenantPool } from '../data/mockData'
import type { StorageRepository } from './StorageRepository'

export class MockStorageRepository implements StorageRepository {
  private settings: AppSettings = { ...mockSettings }

  async listEnvironments(): Promise<EnvironmentRow[]> { return mockEnvironments }
  async listLatestSnapshots(): Promise<StorageSnapshot[]> { return mockSnapshots }
  async getTenantPool(): Promise<TenantPool | null> { return mockTenantPool }
  async getSettings(): Promise<AppSettings> { return this.settings }
  async saveSettings(settings: AppSettings): Promise<void> { this.settings = settings }
}
