import comfyWordmarkSource from '../components/icons/ComfyWordmark.vue?raw'

export interface BenchmarkComparisonImageProperty {
  label: string
  value: string
}

export interface BenchmarkComparisonImageMetric extends BenchmarkComparisonImageProperty {
  highlighted: boolean
}

export interface BenchmarkComparisonImageRun {
  color: string
  properties: BenchmarkComparisonImageProperty[]
  metrics: BenchmarkComparisonImageMetric[]
  fastestDurationSeconds: number | null
  averageDurationSeconds: number | null
  slowestDurationSeconds: number | null
}

export interface BenchmarkComparisonImageData {
  title: string
  metricTitle: string
  durationRangeTitle: string
  exportDateTime: string
  runs: BenchmarkComparisonImageRun[]
}

const COMFY_WORDMARK_PATH = comfyWordmarkSource.match(/\sd="([^"]+)"/)?.[1]

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function text(x: number, y: number, value: string, className: string, anchor = 'start'): string {
  return `<text x="${x}" y="${y}" class="${className}" text-anchor="${anchor}">${escapeXml(value)}</text>`
}

function wrapText(value: string, maximumLength = 42): string[] {
  const lines: string[] = []
  for (const word of value.split(/\s+/)) {
    const previous = lines.at(-1)
    if (!previous) lines.push(word)
    else if (`${previous} ${word}`.length <= maximumLength)
      lines[lines.length - 1] = `${previous} ${word}`
    else lines.push(word)
  }
  return lines.flatMap((line) => {
    if (line.length <= maximumLength) return line
    return Array.from({ length: Math.ceil(line.length / maximumLength) }, (_, index) =>
      line.slice(index * maximumLength, (index + 1) * maximumLength)
    )
  })
}

function propertyTextLines(properties: BenchmarkComparisonImageProperty[]) {
  return properties.flatMap((property, propertyIndex) => {
    const value = propertyIndex === 0 ? property.value : `${property.label}: ${property.value}`
    return wrapText(value).map((line) => ({ line, propertyIndex }))
  })
}

function estimatedPropertyLineWidth(line: string, propertyIndex: number): number {
  return line.length * (propertyIndex === 0 ? 7.2 : 6.6)
}

function propertyLines(
  properties: BenchmarkComparisonImageProperty[],
  x: number,
  y: number
): string {
  return propertyTextLines(properties)
    .map(({ line, propertyIndex }, index) => {
      return text(x, y + index * 19, line, propertyIndex === 0 ? 'run-title' : 'run-property')
    })
    .join('')
}

function formatDuration(value: number): string {
  return `${value.toFixed(2).replace(/\.?0+$/, '')} s`
}

export const MAX_BENCHMARK_COMPARISON_EXPORT_RUNS = 20

/** Create a self-contained SVG containing the selected benchmark comparison. */
export function createBenchmarkComparisonSvg(data: BenchmarkComparisonImageData): string {
  if (data.runs.length > MAX_BENCHMARK_COMPARISON_EXPORT_RUNS) {
    throw new Error(
      `Benchmark comparison images support up to ${MAX_BENCHMARK_COMPARISON_EXPORT_RUNS} runs.`
    )
  }
  const margin = 56
  const metricColumnWidth = 170
  const runCount = Math.max(1, data.runs.length)
  const width = Math.max(1200, margin * 2 + metricColumnWidth + runCount * 270)
  const runColumnWidth = (width - margin * 2 - metricColumnWidth) / runCount
  const runPropertyLines = data.runs.map((run) => propertyTextLines(run.properties))
  const propertyLineCount = Math.max(1, ...runPropertyLines.map((lines) => lines.length))
  const chartLabelWidth =
    20 +
    Math.max(
      0,
      ...runPropertyLines.flatMap((lines) =>
        lines.map(({ line, propertyIndex }) => estimatedPropertyLineWidth(line, propertyIndex))
      )
    )
  const headerHeight = Math.max(88, 34 + propertyLineCount * 19)
  const metricCount = Math.max(1, ...data.runs.map((run) => run.metrics.length))
  const metricRowHeight = 42
  const tableX = margin
  const tableY = 90
  const tableWidth = width - margin * 2
  const tableHeight = headerHeight + metricCount * metricRowHeight
  const chartY = tableY + tableHeight + 70
  const chartLabelGap = 10
  const chartEndpointLabelSpace = 56
  const chartStart = margin + chartLabelWidth + chartLabelGap + chartEndpointLabelSpace
  const chartEnd = width - margin - chartEndpointLabelSpace
  const chartWidth = chartEnd - chartStart
  const chartRowHeight = Math.max(96, 52 + propertyLineCount * 19)
  const height = chartY + 44 + data.runs.length * chartRowHeight + 80
  const maximumDuration = Math.max(
    1,
    ...data.runs.flatMap((run) =>
      run.slowestDurationSeconds === null ? [] : [run.slowestDurationSeconds]
    )
  )
  const durationX = (value: number) => chartStart + (value / maximumDuration) * chartWidth

  const headers = data.runs
    .map((run, index) => {
      const x = tableX + metricColumnWidth + index * runColumnWidth
      return [
        `<rect x="${x}" y="${tableY}" width="${runColumnWidth}" height="${headerHeight}" class="header-cell" />`,
        `<circle cx="${x + 18}" cy="${tableY + 24}" r="6" fill="${escapeXml(run.color)}" />`,
        propertyLines(run.properties, x + 32, tableY + 29)
      ].join('')
    })
    .join('')

  const metricRows = Array.from({ length: metricCount }, (_, rowIndex) => {
    const y = tableY + headerHeight + rowIndex * metricRowHeight
    const label = data.runs.find((run) => run.metrics[rowIndex])?.metrics[rowIndex]?.label ?? ''
    const values = data.runs
      .map((run, runIndex) => {
        const x = tableX + metricColumnWidth + runIndex * runColumnWidth
        const metric = run.metrics[rowIndex]
        const cellClass = metric?.highlighted ? 'table-cell best-cell' : 'table-cell'
        const valueClass = metric?.highlighted ? 'metric-value best-value' : 'metric-value'
        return [
          `<rect x="${x}" y="${y}" width="${runColumnWidth}" height="${metricRowHeight}" class="${cellClass}" />`,
          text(x + runColumnWidth / 2, y + 27, metric?.value ?? '-', valueClass, 'middle')
        ].join('')
      })
      .join('')
    return [
      `<rect x="${tableX}" y="${y}" width="${metricColumnWidth}" height="${metricRowHeight}" class="table-cell" />`,
      text(tableX + 14, y + 27, label, 'metric-label'),
      values
    ].join('')
  }).join('')

  const chartRows = data.runs
    .map((run, index) => {
      const y = chartY + 44 + index * chartRowHeight
      const trackY = y + Math.max(42, (runPropertyLines[index]!.length * 19) / 2)
      const fastest = run.fastestDurationSeconds
      const average = run.averageDurationSeconds
      const slowest = run.slowestDurationSeconds
      const fastestX = fastest === null ? null : durationX(fastest)
      const averageX = average === null ? null : durationX(average)
      const slowestX = slowest === null ? null : durationX(slowest)
      const range =
        fastest !== null && slowest !== null && fastestX !== null && slowestX !== null
          ? `<line x1="${fastestX}" y1="${trackY}" x2="${slowestX}" y2="${trackY}" stroke="${escapeXml(run.color)}" class="chart-range" />
             <circle cx="${fastestX}" cy="${trackY}" r="4" fill="${escapeXml(run.color)}" />
             <circle cx="${slowestX}" cy="${trackY}" r="4" fill="${escapeXml(run.color)}" />
             ${text(fastestX - 4, trackY + 4, formatDuration(fastest), 'chart-point-label', 'end')}
             ${text(slowestX + 4, trackY + 4, formatDuration(slowest), 'chart-point-label', 'start')}`
          : ''
      const averageMarker =
        average === null || averageX === null
          ? ''
          : `<circle cx="${averageX}" cy="${trackY}" r="5" fill="${escapeXml(run.color)}" class="chart-average" />
             ${text(averageX, trackY + 22, formatDuration(average), 'chart-point-label', 'middle')}`
      return [
        `<circle cx="${margin + 6}" cy="${y + 7}" r="6" fill="${escapeXml(run.color)}" />`,
        propertyLines(run.properties, margin + 20, y + 12),
        `<line x1="${margin + chartLabelWidth + chartLabelGap}" y1="${trackY}" x2="${width - margin}" y2="${trackY}" class="chart-track" />`,
        range,
        averageMarker
      ].join('')
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .background { fill: #121212; }
    .table-frame, .header-cell, .table-cell { stroke: #393939; stroke-width: 1; }
    .table-frame, .table-cell { fill: #1d1d1d; }
    .header-cell { fill: #191919; }
    .title { fill: #f5f5f5; font: 600 28px system-ui, sans-serif; }
    .section-title { fill: #d4d4d4; font: 600 16px system-ui, sans-serif; }
    .run-title { fill: #f5f5f5; font: 600 13px system-ui, sans-serif; }
    .run-property { fill: #a3a3a3; font: 11px system-ui, sans-serif; }
    .metric-label { fill: #d4d4d4; font: 500 13px system-ui, sans-serif; }
    .metric-value { fill: #f5f5f5; font: 13px system-ui, sans-serif; }
    .best-cell { fill: #f2ff59; fill-opacity: 0.08; }
    .best-value { fill: #e5eb86; font-weight: 600; }
    .chart-track { stroke: #393939; stroke-width: 2; }
    .chart-range { stroke-width: 3; }
    .chart-average { stroke: #121212; stroke-width: 2; }
    .chart-point-label { fill: #a3a3a3; font: 12px system-ui, sans-serif; }
    .footer-date { fill: #a3a3a3; font: 12px system-ui, sans-serif; }
  </style>
  <rect width="${width}" height="${height}" class="background" />
  ${text(margin, 55, data.title, 'title')}
  <rect x="${tableX}" y="${tableY}" width="${tableWidth}" height="${tableHeight}" rx="10" class="table-frame" />
  ${text(tableX + 14, tableY + headerHeight - 14, data.metricTitle, 'metric-label')}
  ${headers}
  ${metricRows}
  ${text(margin, chartY, data.durationRangeTitle, 'section-title')}
  ${chartRows}
  <g role="img" aria-label="Comfy" transform="translate(${margin} ${height - 51}) scale(0.65)">
    <path d="${COMFY_WORDMARK_PATH}" fill="#F2FF59" />
  </g>
  ${text(width - margin, height - 28, data.exportDateTime, 'footer-date', 'end')}
</svg>`
}
