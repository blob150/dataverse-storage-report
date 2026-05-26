import type { AuthProvider } from './AuthProvider'

export class MockAuthProvider implements AuthProvider {
  async getCurrentUser() {
    return this.signIn()
  }

  async signIn() {
    return {
      displayName: 'Demo Administrator',
      username: 'demo.admin@example.com',
    }
  }

  async getAccessToken() {
    return 'mock-access-token'
  }
}
