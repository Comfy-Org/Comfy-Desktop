export interface PerformanceTestImageMetric {
  label: string
  value: string
  durationSeconds?: number
}

export interface PerformanceTestResultsImageData {
  title: string
  aggregateTitle: string
  systemInformationTitle: string
  metrics: PerformanceTestImageMetric[]
  hardware: PerformanceTestImageMetric[]
  system: PerformanceTestImageMetric[]
}

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

function informationCard(
  x: number,
  y: number,
  width: number,
  height: number,
  rows: PerformanceTestImageMetric[]
): string {
  const content = rows
    .map((row, index) => {
      const rowY = y + 35 + index * 43
      return [
        text(x + 20, rowY, row.label, 'info-label'),
        text(x + width - 20, rowY, row.value, 'info-value', 'end'),
        `<line x1="${x + 20}" y1="${rowY + 12}" x2="${x + width - 20}" y2="${rowY + 12}" class="divider" />`
      ].join('')
    })
    .join('')

  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" class="card" />${content}`
}

/** Create a dependency-free, self-contained SVG matching the visible results summary. */
export function createPerformanceTestResultsSvg(data: PerformanceTestResultsImageData): string {
  const width = 1200
  const margin = 56
  const metricGap = 16
  const metricWidth =
    (width - margin * 2 - metricGap * (data.metrics.length - 1)) / data.metrics.length
  const chartMetrics = data.metrics.filter((metric) => metric.durationSeconds != null)
  const longestDuration = Math.max(...chartMetrics.map((metric) => metric.durationSeconds!), 0.001)
  const systemY = chartMetrics.length > 0 ? 340 : 235
  const cardGap = 20
  const cardWidth = (width - margin * 2 - cardGap) / 2
  const cardHeight = Math.max(data.hardware.length, data.system.length) * 43 + 34
  const height = systemY + 50 + cardHeight + 56

  const metricCards = data.metrics
    .map((metric, index) => {
      const x = margin + index * (metricWidth + metricGap)
      const right = x + metricWidth - 16
      return [
        `<rect x="${x}" y="90" width="${metricWidth}" height="92" rx="10" class="card" />`,
        text(right, 122, metric.label, 'metric-label', 'end'),
        text(right, 160, metric.value, 'metric-value', 'end')
      ].join('')
    })
    .join('')

  const chart = chartMetrics
    .map((metric, index) => {
      const y = 235 + index * 24
      const barWidth = (metric.durationSeconds! / longestDuration) * 800
      return [
        text(margin, y + 10, metric.label, 'chart-label'),
        `<rect x="${margin + 180}" y="${y}" width="800" height="10" rx="5" class="chart-track" />`,
        `<rect x="${margin + 180}" y="${y}" width="${barWidth}" height="10" rx="5" class="chart-bar" />`
      ].join('')
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .background { fill: #121212; }
    .card { fill: #1d1d1d; stroke: #393939; stroke-width: 1; }
    .title { fill: #f5f5f5; font: 600 28px system-ui, sans-serif; }
    .section-title { fill: #d4d4d4; font: 500 16px system-ui, sans-serif; }
    .metric-label, .info-label { fill: #a3a3a3; font: 14px system-ui, sans-serif; }
    .metric-value { fill: #ffffff; font: 600 26px system-ui, sans-serif; }
    .info-value { fill: #d4d4d4; font: 14px system-ui, sans-serif; }
    .chart-label { fill: #a3a3a3; font: 12px system-ui, sans-serif; }
    .chart-track { fill: #393939; }
    .chart-bar { fill: #f4c430; }
    .divider { stroke: #333333; stroke-width: 1; }
  </style>
  <rect width="${width}" height="${height}" class="background" />
  ${text(margin, 55, data.title, 'title')}
  ${metricCards}
  ${chartMetrics.length > 0 ? text(margin, 215, data.aggregateTitle, 'section-title') : ''}
  ${chart}
  ${text(margin, systemY, data.systemInformationTitle, 'section-title')}
  ${informationCard(margin, systemY + 24, cardWidth, cardHeight, data.hardware)}
  ${informationCard(margin + cardWidth + cardGap, systemY + 24, cardWidth, cardHeight, data.system)}
</svg>`
}
