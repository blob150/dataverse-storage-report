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
  const dims: Array<{ kind: StorageKind; percent: number }> = [
    { kind: 'database', percent: snapshot.database.percent },
    { kind: 'file', percent: snapshot.file.percent },
    { kind: 'log', percent: snapshot.log.percent },
  ]

  for (const dim of dims) {
    if (dim.percent >= thresholds.criticalPercent) {
      triggers.push({ kind: dim.kind, status: 'over', percent: dim.percent })
    } else if (dim.percent >= thresholds.warnPercent) {
      triggers.push({ kind: dim.kind, status: 'warn', percent: dim.percent })
    }
  }

  const payGoFlag = snapshot.payGoEnabled && snapshot.payGoConsumptionGb > 0

  let status: EvaluatedRow['status'] = 'ok'
  if (triggers.some((t) => t.status === 'over') || payGoFlag) status = 'over'
  else if (triggers.some((t) => t.status === 'warn')) status = 'warn'

  return { environment, snapshot, status, triggers, payGoFlag }
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
