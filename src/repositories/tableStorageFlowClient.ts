import type {
  TableStorageDimension,
  TableStorageResponse,
  TableStorageRow,
} from '../domain/types'

// Wire shape returned by the dsr-gettablestorage flow. The flow simply
// forwards licensing.powerplatform.microsoft.com's response, which is an
// array of { resourceId, consumed, unit, lastRefreshedDate } items — but we
// wrap it in an envelope so the flow can surface errors/paging without a
// custom HTTP status.
export type FlowInvokeInput = {
  envId: string
  dimension: TableStorageDimension
  search?: string
  skip?: number
  top?: number
}

type LicensingResource = {
  resourceId: string
  consumed: number
  unit?: string
  lastRefreshedDate?: string
}

type FlowResponseEnvelope = {
  // The flow returns the licensing service's raw response as `value` (array).
  // On error it returns { error: { message } }.
  value?: LicensingResource[]
  hasMore?: boolean
  error?: { message?: string }
  // Some Power Automate outputs put the array at root — we accept either.
}

function toRows(items: LicensingResource[]): TableStorageRow[] {
  return items.map((it) => ({
    resourceId: String(it.resourceId ?? ''),
    consumedMb: Number(it.consumed ?? 0),
    lastRefreshedDate: String(it.lastRefreshedDate ?? ''),
  }))
}

function latestRefresh(rows: TableStorageRow[]): string | null {
  let max = 0
  let maxIso = ''
  for (const r of rows) {
    if (!r.lastRefreshedDate) continue
    const t = Date.parse(r.lastRefreshedDate)
    if (Number.isFinite(t) && t > max) { max = t; maxIso = r.lastRefreshedDate }
  }
  return maxIso || null
}

// Shared helper used by both PowerApps and MSAL repos. Both invoke the same
// HTTP-triggered Power Automate flow — the flow's own SP handles the
// admin-token acquisition for the licensing service.
export async function invokeTableStorageFlow(
  flowUrl: string,
  input: FlowInvokeInput,
): Promise<TableStorageResponse> {
  if (!flowUrl || !flowUrl.trim()) {
    throw new Error(
      'Per-table storage is not configured. In Settings, paste the HTTP trigger URL ' +
      'from the dsr-gettablestorage flow.',
    )
  }
  const top = Math.max(1, Math.min(input.top ?? 50, 200))
  const body = {
    envId: input.envId,
    dimension: input.dimension,
    search: input.search ?? '',
    skip: Math.max(0, input.skip ?? 0),
    top,
  }
  const res = await fetch(flowUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    // Surface a meaningful chunk of the body; the flow's Respond action
    // returns a { error: { message } } shape on the failure path.
    let msg = `dsr-gettablestorage failed: ${res.status}`
    try {
      const parsed = JSON.parse(text)
      msg += ` — ${parsed?.error?.message || parsed?.message || text.substring(0, 300)}`
    } catch {
      msg += ` — ${text.substring(0, 300)}`
    }
    throw new Error(msg)
  }
  let payload: FlowResponseEnvelope | LicensingResource[]
  try { payload = JSON.parse(text) as FlowResponseEnvelope | LicensingResource[] }
  catch { throw new Error(`dsr-gettablestorage returned non-JSON: ${text.substring(0, 300)}`) }

  const items: LicensingResource[] = Array.isArray(payload)
    ? payload
    : (payload.value ?? [])
  if (!Array.isArray(items)) {
    throw new Error('dsr-gettablestorage returned unexpected shape (no array)')
  }
  const rows = toRows(items)
  const hasMore = !Array.isArray(payload) && Boolean(payload.hasMore)
  return {
    envId: input.envId,
    dimension: input.dimension,
    rows,
    hasMore,
    latestRefreshDate: latestRefresh(rows),
  }
}
