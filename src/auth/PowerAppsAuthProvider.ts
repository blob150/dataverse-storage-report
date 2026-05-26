import { getContext } from '@microsoft/power-apps/app'
import type { AuthProvider } from './AuthProvider'

export class PowerAppsAuthProvider implements AuthProvider {
  async getCurrentUser() {
    return this.signIn()
  }

  async signIn() {
    const context = await getContext()
    return {
      displayName: context.user.fullName ?? context.user.userPrincipalName ?? 'Power Apps user',
      username: context.user.userPrincipalName ?? context.user.objectId ?? 'powerapps-user',
    }
  }

  async getAccessToken(): Promise<string> {
    throw new Error('Power Apps hosted mode uses the Power Platform data runtime, not direct access tokens.')
  }
}
