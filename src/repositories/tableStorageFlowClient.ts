import { GetDataversetablestorageService } from '../generated/services/GetDataversetablestorageService'
import type {
  EnvironmentRow,
  TableRowCountResponse,
  TableRowCountRow,
} from '../domain/types'

// Wire shape returned by dsr_gettablestorage:
// {
//   entities: [{ LogicalName, DisplayName: { UserLocalizedLabel?: {Label?} }, IsCustomEntity, ... }],
//   batches:  [{ Keys: [names], Values: [counts] }, ...]
// }
//   -- or --
// {
//   error: { message: string, entityDefs: ..., batch: ... }
// }

type EntityDef = {
  LogicalName: string
  DisplayName?: { UserLocalizedLabel?: { Label?: string } }
  IsCustomEntity: boolean
}
type Batch = { Keys: string[]; Values: number[] }
type FlowPayload = {
  entities?: EntityDef[]
  batches?: Batch[]
  error?: { message: string }
}

// Session cache — re-opening the same env skips the flow.
const cache = new Map<string, TableRowCountResponse>()
function cacheKey(envUrl: string): string { return envUrl.replace(/\/+$/, '').toLowerCase() }

export async function fetchTableRowCounts(
  env: EnvironmentRow,
  opts?: { force?: boolean },
): Promise<TableRowCountResponse> {
  if (!env.url) throw new Error(`Environment ${env.displayName} has no Dataverse URL`)
  const key = cacheKey(env.url)
  if (!opts?.force) {
    const hit = cache.get(key)
    if (hit) return hit
  }
  const result = await GetDataversetablestorageService.Run({ envUrl: env.url })
  if (!result.success) {
    const err = result.error as unknown
    let msg: string
    if (err instanceof Error) msg = err.message
    else if (typeof err === 'string') msg = err
    else if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>
      msg = (e.message as string) || (e.code as string) || (() => {
        try { return JSON.stringify(err) } catch { return String(err) }
      })()
    } else msg = String(err ?? 'unknown error')
    throw new Error(`dsr-gettablestorage failed: ${msg}`)
  }
  const body = result.data?.body ?? ''
  let payload: FlowPayload
  try { payload = body ? JSON.parse(body) : {} }
  catch { throw new Error(`dsr-gettablestorage returned non-JSON: ${body.substring(0, 300)}`) }

  if (payload.error) throw new Error(`dsr-gettablestorage: ${payload.error.message}`)
  const entities = payload.entities ?? []
  const batches = payload.batches ?? []

  // Merge batches into a single Map<logicalName, count>. Some batches may
  // have shorter Keys/Values arrays than the batch input if licensing masks
  // certain tables — take whatever's there.
  const counts = new Map<string, number>()
  for (const b of batches) {
    if (!b?.Keys || !b?.Values) continue
    const len = Math.min(b.Keys.length, b.Values.length)
    for (let i = 0; i < len; i += 1) counts.set(b.Keys[i], b.Values[i])
  }

  const rows: TableRowCountRow[] = entities
    .map((e) => {
      const rowCount = counts.get(e.LogicalName)
      if (rowCount === undefined || rowCount < 0) return null
      return {
        logicalName: e.LogicalName,
        displayName: e.DisplayName?.UserLocalizedLabel?.Label || e.LogicalName,
        rowCount,
        isCustom: Boolean(e.IsCustomEntity),
      }
    })
    .filter((r): r is TableRowCountRow => r !== null)
    .sort((a, b) => b.rowCount - a.rowCount)

  const response: TableRowCountResponse = {
    envId: env.environmentId,
    envUrl: env.url,
    fetchedAt: new Date().toISOString(),
    rows,
  }
  cache.set(key, response)
  return response
}
