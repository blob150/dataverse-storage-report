export type AuthMode = 'mock' | 'msal' | 'powerapps'

export type AppConfig = {
  authMode: AuthMode
  dataverseUrl: string
  clientId: string
  tenantId: string
  refreshFlowUrl: string
}

export const appConfig: AppConfig = {
  authMode: (import.meta.env.VITE_AUTH_MODE ?? 'mock') as AuthMode,
  dataverseUrl: import.meta.env.VITE_DATAVERSE_URL ?? '',
  clientId: import.meta.env.VITE_ENTRA_CLIENT_ID ?? '',
  tenantId: import.meta.env.VITE_ENTRA_TENANT_ID ?? 'common',
  refreshFlowUrl: import.meta.env.VITE_REFRESH_FLOW_URL ?? '',
}

export function getRequiredDataverseConfig(config = appConfig) {
  if (!config.dataverseUrl || !config.clientId) {
    throw new Error(
      'Dataverse mode requires VITE_DATAVERSE_URL and VITE_ENTRA_CLIENT_ID environment variables.',
    )
  }

  return {
    ...config,
    dataverseUrl: config.dataverseUrl.replace(/\/$/, ''),
  }
}
