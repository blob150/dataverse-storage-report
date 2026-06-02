import { appConfig, getRequiredDataverseConfig } from '../config'
import type { AuthProvider } from '../auth/AuthProvider'
import { DataverseClient } from '../dataverse/DataverseClient'
import { DataverseStorageRepository } from './DataverseStorageRepository'
import { MockStorageRepository } from './MockStorageRepository'
import { PowerAppsStorageRepository } from './PowerAppsStorageRepository'
import type { StorageRepository } from './StorageRepository'

export function createRepository(authProvider: AuthProvider): StorageRepository {
  if (appConfig.authMode === 'powerapps') {
    return new PowerAppsStorageRepository()
  }
  if (appConfig.authMode === 'msal') {
    const cfg = getRequiredDataverseConfig()
    const client = new DataverseClient(cfg.dataverseUrl, authProvider)
    return new DataverseStorageRepository(client)
  }
  return new MockStorageRepository()
}
