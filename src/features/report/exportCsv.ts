import type { EvaluatedRow } from '../../domain/types'

function fmtCell(value: string) {
  if (value == null) return ''
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

const COLUMNS = [
  'Environment', 'Type', 'Region', 'Owner', 'Billing',
  'DB used GB', 'DB allocated GB', 'DB %',
  'File used GB', 'File allocated GB', 'File %',
  'Log used GB', 'Log allocated GB', 'Log %',
  'PayGo', 'PayGo usage GB', 'Overage GB',
  'Status', 'Triggered by', 'Snapshot captured',
]

export function rowsToCsv(rows: EvaluatedRow[]): string {
  const lines = [COLUMNS.map(fmtCell).join(',')]
  for (const r of rows) {
    const s = r.snapshot
    const triggers = r.triggers
      .map((t) => `${t.kind} ${t.status} ${t.percent}%`)
      .concat(r.payGoFlag ? ['PayGo accruing'] : [])
      .join('; ')

    lines.push([
      r.environment.displayName,
      r.environment.type,
      r.environment.region,
      `${r.environment.ownerName} <${r.environment.ownerEmail}>`,
      r.environment.billingModel,
      s ? String(s.database.usedGb) : '',
      s ? String(s.database.allocatedGb) : '',
      s ? String(s.database.percent) : '',
      s ? String(s.file.usedGb) : '',
      s ? String(s.file.allocatedGb) : '',
      s ? String(s.file.percent) : '',
      s ? String(s.log.usedGb) : '',
      s ? String(s.log.allocatedGb) : '',
      s ? String(s.log.percent) : '',
      s ? String(s.payGoEnabled) : '',
      s ? String(s.payGoConsumptionGb) : '',
      s ? String(s.overageGb) : '',
      r.status,
      triggers,
      s?.capturedAt ?? '',
    ].map(fmtCell).join(','))
  }
  return lines.join('\n')
}

export function downloadCsv(filename: string, contents: string) {
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
