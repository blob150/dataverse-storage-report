import { GetDataversetablestorageService } from '../generated/services/GetDataversetablestorageService'
import type {
  TableStorageDimension,
  TableStorageResponse,
  TableStorageRow,
} from '../domain/types'

// Wire shape returned by the dsr-gettablestorage flow. The flow's PowerApps
// response returns a single `body` string field containing the JSON payload
// forwarded from licensing.powerplatform.microsoft.com.
type LicensingResource = {
  resourceId: string
  consumed: number
  unit?: string
  lastRefreshedDate?: string
}

export type FlowInvokeInput = {
  envId: string
  dimension: TableStorageDimension
  search?: string
}

function toRows(items: LicensingResource[]): TableStorageRow[] {
  return items.map((it) => ({
    resourceId: String(it.resourceId ?? ''),
    consumedMb: Number(it.consumed ?? 0),
    lastRefreshedDate: String(it.lastRefreshedDate ?? ''),
  }))
}

function latestRefresh(rows: TableStorageRow[]): string | null {
  let maxIso = ''
  for (const r of rows) {
    if (r.lastRefreshedDate && r.lastRefreshedDate > maxIso) maxIso = r.lastRefreshedDate
  }
  return maxIso || null
}

// Invoke the dsr-gettablestorage flow via the Power Apps typed data client.
// The flow trigger is caller-authenticated (PowerAppV2) so only signed-in app
// users can call it — no shared URL.
export async function invokeTableStorageFlow(
  input: FlowInvokeInput,
): Promise<TableStorageResponse> {
  const result = await GetDataversetablestorageService.Run({
    envId: input.envId,
    dimension: String(input.dimension),
    search: input.search ?? '',
  })
  if (!result.success) {
    const msg = result.error instanceof Error ? result.error.message : String(result.error ?? 'unknown error')
    throw new Error(`dsr-gettablestorage failed: ${msg}`)
  }
  const body = result.data?.body ?? ''
  let payload: unknown
  try { payload = body ? JSON.parse(body) : [] }
  catch { throw new Error(`dsr-gettablestorage returned non-JSON body: ${body.substring(0, 300)}`) }

  // Flow returns either a raw array (licensing service response) or an
  // error envelope `{ error: { message } }`.
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const asRecord = payload as Record<string, unknown>
    const err = asRecord.error as { message?: string } | undefined
    if (err?.message) throw new Error(`dsr-gettablestorage upstream error: ${err.message}`)
  }
  const items = Array.isArray(payload) ? (payload as LicensingResource[]) : []
  const rows = toRows(items)
  return {
    envId: input.envId,
    dimension: input.dimension,
    rows,
    hasMore: false,
    latestRefreshDate: latestRefresh(rows),
  }
}

