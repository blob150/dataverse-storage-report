import type { AppUser } from '../domain/types'

export interface AuthProvider {
  getCurrentUser(): Promise<AppUser | null>
  signIn(): Promise<AppUser>
  getAccessToken(): Promise<string>
}
