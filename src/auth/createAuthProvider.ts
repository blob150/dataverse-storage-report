import { appConfig, getRequiredDataverseConfig } from '../config'
import { MockAuthProvider } from './MockAuthProvider'
import { MsalAuthProvider } from './MsalAuthProvider'
import { PowerAppsAuthProvider } from './PowerAppsAuthProvider'

export function createAuthProvider() {
  if (appConfig.authMode === 'powerapps') {
    return new PowerAppsAuthProvider()
  }
  if (appConfig.authMode === 'msal') {
    return new MsalAuthProvider(getRequiredDataverseConfig())
  }
  return new MockAuthProvider()
}
