import type { AuthProvider } from '../auth/AuthProvider'

export class DataverseClient {
  private readonly baseUrl: string
  private readonly authProvider: AuthProvider

  constructor(baseUrl: string, authProvider: AuthProvider) {
    this.baseUrl = baseUrl
    this.authProvider = authProvider
  }

  async list<T>(entitySetName: string, query = '') {
    const response = await this.request<{ value: T[]; '@odata.nextLink'?: string }>(
      `${entitySetName}${query ? `?${query}` : ''}`,
      { method: 'GET' },
    )
    return response.value
  }

  async listAll<T>(entitySetName: string, query = '', maxPages = 50): Promise<T[]> {
    const out: T[] = []
    let path: string | null = `${entitySetName}${query ? `?${query}` : ''}`
    for (let i = 0; i < maxPages && path; i++) {
      const isAbsolute = /^https?:\/\//i.test(path)
      const response: { value: T[]; '@odata.nextLink'?: string } = isAbsolute
        ? await this.requestAbsolute<{ value: T[]; '@odata.nextLink'?: string }>(path)
        : await this.request<{ value: T[]; '@odata.nextLink'?: string }>(path, { method: 'GET' })
      out.push(...response.value)
      path = response['@odata.nextLink'] ?? null
    }
    return out
  }

  async create<TBody extends Record<string, unknown>>(entitySetName: string, body: TBody) {
    const token = await this.authProvider.getAccessToken()
    const response = await fetch(`${this.baseUrl}/api/data/v9.2/${entitySetName}`, {
      method: 'POST',
      headers: this.getHeaders(token, true),
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(await this.getErrorMessage(response))
    const entityId = response.headers.get('OData-EntityId')
    return entityId?.match(/\(([^)]+)\)/)?.[1] ?? null
  }

  async update<TBody extends Record<string, unknown>>(entitySetName: string, id: string, body: TBody) {
    await this.request<void>(`${entitySetName}(${id})`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  }

  async delete(entitySetName: string, id: string) {
    await this.request<void>(`${entitySetName}(${id})`, { method: 'DELETE' })
  }

  private async request<T>(path: string, init: RequestInit) {
    const token = await this.authProvider.getAccessToken()
    const response = await fetch(`${this.baseUrl}/api/data/v9.2/${path}`, {
      ...init,
      headers: this.getHeaders(token, init.method !== 'GET'),
    })
    if (!response.ok) throw new Error(await this.getErrorMessage(response))
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  private async requestAbsolute<T>(url: string) {
    const token = await this.authProvider.getAccessToken()
    const response = await fetch(url, { method: 'GET', headers: this.getHeaders(token, false) })
    if (!response.ok) throw new Error(await this.getErrorMessage(response))
    return (await response.json()) as T
  }

  private getHeaders(token: string, hasBody: boolean): HeadersInit {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    }
  }

  private async getErrorMessage(response: Response) {
    const body = await response.text()
    return `Dataverse request failed (${response.status} ${response.statusText}): ${body}`
  }
}
