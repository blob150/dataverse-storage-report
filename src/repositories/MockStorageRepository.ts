import type {
  AppSettings,
  EnvironmentRow,
  StorageSnapshot,
  TableStorageDimension,
  TableStorageQuery,
  TableStorageResponse,
} from '../domain/types'
import {
  mockEnvironments,
  mockSettings,
  mockSnapshots,
  mockTableStorage,
} from '../data/mockData'
import type { StorageRepository } from './StorageRepository'

export class MockStorageRepository implements StorageRepository {
  private settings: AppSettings = { ...mockSettings }

  async listEnvironments(): Promise<EnvironmentRow[]> { return mockEnvironments }
  async listLatestSnapshots(): Promise<StorageSnapshot[]> { return mockSnapshots }
  async getSettings(): Promise<AppSettings> { return this.settings }
  async saveSettings(settings: AppSettings): Promise<void> { this.settings = settings }

  async getTableStorage(
    envId: string,
    dimension: TableStorageDimension,
    query?: TableStorageQuery,
  ): Promise<TableStorageResponse> {
    const all = mockTableStorage(envId, dimension)
    const search = (query?.search ?? '').toLowerCase()
    const filtered = search
      ? all.filter((r) => r.resourceId.toLowerCase().includes(search))
      : all
    const skip = Math.max(0, query?.skip ?? 0)
    const top = Math.max(1, Math.min(query?.top ?? 50, 200))
    const page = filtered.slice(skip, skip + top)
    let latest: string | null = null
    for (const r of page) {
      if (r.lastRefreshedDate && (!latest || r.lastRefreshedDate > latest)) latest = r.lastRefreshedDate
    }
    return {
      envId,
      dimension,
      rows: page,
      hasMore: skip + top < filtered.length,
      latestRefreshDate: latest,
    }
  }
}
