import type {
  AppSettings,
  EnvironmentRow,
  StorageSnapshot,
  TableRowCountResponse,
  TableRowCountRow,
} from '../domain/types'
import {
  mockEnvironments,
  mockSettings,
  mockSnapshots,
} from '../data/mockData'
import type { StorageRepository } from './StorageRepository'

export class MockStorageRepository implements StorageRepository {
  private settings: AppSettings = { ...mockSettings }

  async listEnvironments(): Promise<EnvironmentRow[]> { return mockEnvironments }
  async listLatestSnapshots(): Promise<StorageSnapshot[]> { return mockSnapshots }
  async getSettings(): Promise<AppSettings> { return this.settings }
  async saveSettings(settings: AppSettings): Promise<void> { this.settings = settings }

  async getTableRowCounts(env: EnvironmentRow): Promise<TableRowCountResponse> {
    // Deterministic fake counts so the drawer is explorable in mock mode.
    const names = [
      'account', 'contact', 'systemuser', 'businessunit',
      'workflow', 'asyncoperation', 'auditbase', 'plugintracelog',
      'connectionreference', 'msdyn_flow', 'msdyn_botcomponent', 'annotation',
      'dsr_environment', 'dsr_storagesnapshot', 'dsr_setting',
    ]
    let seed = 0
    for (const c of env.environmentId) seed = (seed + c.charCodeAt(0)) & 0xffff
    const rows: TableRowCountRow[] = names.map((n, i) => ({
      logicalName: n,
      displayName: n.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
      rowCount: Math.floor((names.length - i) * 1200 * ((seed % 13) + 1) / (i + 1)),
      isCustom: n.startsWith('dsr_') || n.startsWith('msdyn_'),
    }))
    rows.sort((a, b) => b.rowCount - a.rowCount)
    return {
      envId: env.environmentId,
      envUrl: env.url ?? '',
      fetchedAt: new Date().toISOString(),
      rows,
    }
  }
}
