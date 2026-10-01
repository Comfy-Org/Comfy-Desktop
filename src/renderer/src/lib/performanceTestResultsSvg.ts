import comfyWordmarkSource from '../components/icons/ComfyWordmark.vue?raw'
import type { PerformanceTestResultsSummary } from '../types/ipc'

/** The i18n translator shape the results-image builder needs. */
type ResultsImageTranslate = (key: string, params?: Record<string, unknown>) => string

export interface PerformanceTestImageMetric {
  label: string
  value: string
  durationSeconds?: number
}

export interface PerformanceTestResultsImageData {
  title: string
  aggregateTitle: string
  systemInformationTitle: string
  testDateTime: string
  metrics: PerformanceTestImageMetric[]
  hardware: PerformanceTestImageMetric[]
  system: PerformanceTestImageMetric[]
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
    .footer-date { fill: #a3a3a3; font: 12px system-ui, sans-serif; }
  </style>
  <rect width="${width}" height="${height}" class="background" />
  ${text(margin, 55, data.title, 'title')}
  ${metricCards}
  ${chartMetrics.length > 0 ? text(margin, 215, data.aggregateTitle, 'section-title') : ''}
  ${chart}
  ${text(margin, systemY, data.systemInformationTitle, 'section-title')}
  ${informationCard(margin, systemY + 24, cardWidth, cardHeight, data.hardware)}
  ${informationCard(margin + cardWidth + cardGap, systemY + 24, cardWidth, cardHeight, data.system)}
  <g role="img" aria-label="Comfy" transform="translate(${margin} ${height - 51}) scale(0.65)">
    <path d="${COMFY_WORDMARK_PATH}" fill="#F2FF59" />
  </g>
  ${text(width - margin, height - 28, data.testDateTime, 'footer-date', 'end')}
</svg>`
}

function formatResultsDuration(seconds: number): string {
  return `${seconds.toFixed(3)} s`
}
function formatResultsMemory(megabytes: number): string {
  return `${(megabytes / 1024).toFixed(1)} GB`
}
function formatResultsOperatingSystem(info: PerformanceTestResultsSummary['systemInfo']): string {
  return (
    [info.os_distro, info.os_release].filter(Boolean).join(' ') ||
    `${info.platform} ${info.os_version}`
  )
}

/**
 * Build the single-run results-image SVG from a results summary. Shared by the live
 * Run view and the History "Open" detail view so both export the identical artifact.
 * Returns `null` when the summary is missing the hardware or duration fields the image
 * requires (the caller surfaces that as an export failure) — never fabricates values.
 */
export function buildPerformanceTestResultsSvg(
  summary: PerformanceTestResultsSummary,
  t: ResultsImageTranslate
): string | null {
  const hardware = summary.hardware
  const fastest = summary.fastestJobDurationSeconds
  const slowest = summary.slowestJobDurationSeconds
  const average = summary.averageJobDurationSeconds
  const median = summary.medianJobDurationSeconds
  if (!hardware || fastest === null || slowest === null || average === null || median === null) {
    return null
  }
  const hardwareRows: PerformanceTestImageMetric[] = [
    {
      label: t('performanceTest.device'),
      value: hardware.devices.flatMap((device) => device.deviceName ?? []).join(', ')
    }
  ]
  if (hardware.vramMb != null)
    hardwareRows.push({
      label: t('performanceTest.vram'),
      value: formatResultsMemory(hardware.vramMb)
    })
  if (hardware.ramMb != null)
    hardwareRows.push({
      label: t('performanceTest.ram'),
      value: formatResultsMemory(hardware.ramMb)
    })
  if (hardware.pytorchVersion)
    hardwareRows.push({
      label: t('performanceTest.pytorchVersion'),
      value: hardware.pytorchVersion
    })
  if (hardware.xformersVersion)
    hardwareRows.push({
      label: t('performanceTest.xformersVersion'),
      value: hardware.xformersVersion
    })

  return createPerformanceTestResultsSvg({
    title: t('performanceTest.imageTitle', { workflowName: summary.workflowName }),
    aggregateTitle: t('performanceTest.runDurationChart'),
    systemInformationTitle: t('performanceTest.systemInformation'),
    testDateTime: new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(summary.createdAt)),
    metrics: [
      { label: t('performanceTest.measuredRunCount'), value: String(summary.measuredJobCount) },
      { label: t('performanceTest.failedRunCount'), value: String(summary.failedRunCount) },
      {
        label: t('performanceTest.fastestRun'),
        value: formatResultsDuration(fastest),
        durationSeconds: fastest
      },
      {
        label: t('performanceTest.slowestRun'),
        value: formatResultsDuration(slowest),
        durationSeconds: slowest
      },
      {
        label: t('performanceTest.averageRunDuration'),
        value: formatResultsDuration(average),
        durationSeconds: average
      },
      {
        label: t('performanceTest.medianRunDuration'),
        value: formatResultsDuration(median),
        durationSeconds: median
      }
    ],
    hardware: hardwareRows,
    system: [
      { label: t('performanceTest.cpu'), value: summary.systemInfo.cpu_model },
      { label: t('performanceTest.cpuCores'), value: String(summary.systemInfo.cpu_cores) },
      { label: t('performanceTest.architecture'), value: summary.systemInfo.arch },
      {
        label: t('performanceTest.operatingSystem'),
        value: formatResultsOperatingSystem(summary.systemInfo)
      }
    ]
  })
}

/** Rasterize the self-contained results SVG at its intrinsic dimensions. */
export async function createResultsPng(svg: string): Promise<ArrayBuffer> {
  const dimensions = svg.match(/<svg\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/)
  const width = Number(dimensions?.[1])
  const height = Number(dimensions?.[2])
  if (!width || !height) throw new Error('Invalid results image dimensions.')

  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Could not render the results image.'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not render the results image.')
  context.drawImage(image, 0, 0, width, height)

  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the results image.'))),
      'image/png'
    )
  })
  return png.arrayBuffer()
}
