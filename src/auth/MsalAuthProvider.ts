import { PublicClientApplication, type AccountInfo } from '@azure/msal-browser'
import type { AppConfig } from '../config'
import type { AuthProvider } from './AuthProvider'

export class MsalAuthProvider implements AuthProvider {
  private readonly scope: string
  private readonly msal: PublicClientApplication
  private initialized = false

  constructor(config: AppConfig) {
    this.scope = `${config.dataverseUrl.replace(/\/$/, '')}/user_impersonation`
    this.msal = new PublicClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: 'sessionStorage' },
    })
  }

  async getCurrentUser() {
    const account = await this.getExistingAccount()
    if (!account) return null
    return {
      displayName: account.name ?? account.username,
      username: account.username,
    }
  }

  async signIn() {
    await this.ensureInitialized()
    const login = await this.msal.loginPopup({ scopes: [this.scope] })
    this.msal.setActiveAccount(login.account)
    return {
      displayName: login.account.name ?? login.account.username,
      username: login.account.username,
    }
  }

  async getAccessToken() {
    const account = await this.getExistingAccount()
    if (!account) throw new Error('Sign in is required before Dataverse can be loaded.')

    try {
      const token = await this.msal.acquireTokenSilent({ account, scopes: [this.scope] })
      return token.accessToken
    } catch {
      const token = await this.msal.acquireTokenPopup({ account, scopes: [this.scope] })
      return token.accessToken
    }
  }

  private async getExistingAccount(): Promise<AccountInfo | null> {
    await this.ensureInitialized()
    const active = this.msal.getActiveAccount()
    if (active) return active
    const accounts = this.msal.getAllAccounts()
    if (accounts[0]) {
      this.msal.setActiveAccount(accounts[0])
      return accounts[0]
    }
    return null
  }

  private async ensureInitialized() {
    if (this.initialized) return
    await this.msal.initialize()
    await this.msal.handleRedirectPromise().catch(() => undefined)
    this.initialized = true
  }
}
