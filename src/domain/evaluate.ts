import type {
  AppSettings,
  EnvironmentRow,
  EvaluatedRow,
  StorageKind,
  StorageSnapshot,
  Thresholds,
  TriggeredBy,
} from '../domain/types'

export function evaluateRow(
  environment: EnvironmentRow,
  snapshot: StorageSnapshot | null,
  thresholds: Thresholds,
): EvaluatedRow {
  if (!snapshot) {
    return { environment, snapshot, status: 'ok', triggers: [], payGoFlag: false }
  }

  const triggers: TriggeredBy = []
  const dims: Array<{ kind: StorageKind; percent: number; allocated: number }> = [
    { kind: 'database', percent: snapshot.database.percent, allocated: snapshot.database.allocatedGb },
    { kind: 'file', percent: snapshot.file.percent, allocated: snapshot.file.allocatedGb },
    { kind: 'log', percent: snapshot.log.percent, allocated: snapshot.log.allocatedGb },
  ]

  for (const dim of dims) {
    if (dim.allocated <= 0) continue
    if (dim.percent >= thresholds.criticalPercent) {
      triggers.push({ kind: dim.kind, status: 'over', percent: dim.percent })
    } else if (dim.percent >= thresholds.warnPercent) {
      triggers.push({ kind: dim.kind, status: 'warn', percent: dim.percent })
    }
  }

  const payGoFlag = snapshot.payGoEnabled || snapshot.payGoConsumptionGb > 0

  // Envs with any PayGo signal (entitled OR active consumption) have an
  // overflow path — labelling them "over capacity" misleads admins. Downgrade
  // the per-dim "over" triggers to "warn" so the chips still surface heavy
  // usage but the row doesn't read as a hard breach.
  const displayTriggers: TriggeredBy = payGoFlag
    ? triggers.map((t) => (t.status === 'over' ? { ...t, status: 'warn' } : t))
    : triggers

  let status: EvaluatedRow['status'] = 'ok'
  if (displayTriggers.some((t) => t.status === 'over')) status = 'over'
  else if (displayTriggers.some((t) => t.status === 'warn')) status = 'warn'

  return { environment, snapshot, status, triggers: displayTriggers, payGoFlag }
}

export function evaluateRows(
  environments: EnvironmentRow[],
  snapshots: StorageSnapshot[],
  settings: AppSettings,
): EvaluatedRow[] {
  const byEnv = new Map<string, StorageSnapshot>()
  for (const s of snapshots) {
    const existing = byEnv.get(s.environmentId)
    if (!existing || new Date(s.capturedAt) > new Date(existing.capturedAt)) {
      byEnv.set(s.environmentId, s)
    }
  }
  return environments.map((e) =>
    evaluateRow(e, byEnv.get(e.id) ?? null, {
      warnPercent: settings.warnPercent,
      criticalPercent: settings.criticalPercent,
    }),
  )
}

export function cellClass(percent: number, thresholds: Thresholds): string {
  if (percent >= thresholds.criticalPercent) return 'cell-over'
  if (percent >= thresholds.warnPercent) return 'cell-warn'
  return 'cell-ok'
}
