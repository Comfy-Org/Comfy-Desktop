import comfyWordmarkSource from '../components/icons/ComfyWordmark.vue?raw'

export interface PerformanceTestImageMetric {
  label: string
  value: string
}

export interface PerformanceTestImageDuration extends PerformanceTestImageMetric {
  durationSeconds: number
  highlight?: boolean
}

export interface PerformanceTestResultsImageData {
  title: string
  aggregateTitle: string
  systemInformationTitle: string
  testDateTime: string
  headline: PerformanceTestImageMetric
  durations: PerformanceTestImageDuration[]
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

function fitText(value: string, maxCharacters: number): string {
  return value.length > maxCharacters ? `${value.slice(0, maxCharacters - 1).trimEnd()}…` : value
}

export function createPerformanceTestResultsSvg(data: PerformanceTestResultsImageData): string {
  const width = 1200
  const margin = 56
  const contentWidth = width - margin * 2
  const resultsY = 132
  const chartX = margin + 320
  const chartLabelWidth = 120
  const chartValueWidth = 96
  const trackX = chartX + chartLabelWidth
  const trackWidth = width - margin - chartValueWidth - trackX
  const rowHeight = 32
  const longestDuration = Math.max(...data.durations.map((row) => row.durationSeconds), 0.001)
  const chartTop = resultsY + 30
  const chartBottom = chartTop + data.durations.length * rowHeight
  const systemY = Math.max(chartBottom, resultsY + 140) + 52
  const columns = 3
  const columnGap = 32
  const columnWidth = (contentWidth - columnGap * (columns - 1)) / columns
  const factHeight = 60
  const factRows = Math.ceil(data.system.length / columns)
  const factsTop = systemY + 30
  const height = factsTop + factRows * factHeight + 92

  const chart = data.durations
    .map((row, index) => {
      const y = chartTop + index * rowHeight
      const barWidth = Math.max((row.durationSeconds / longestDuration) * trackWidth, 8)
      const tone = row.highlight ? 'strong' : 'soft'
      return [
        text(chartX, y + 20, row.label, 'chart-label'),
        `<rect x="${trackX}" y="${y + 12}" width="${trackWidth}" height="8" rx="4" class="chart-track" />`,
        `<rect x="${trackX}" y="${y + 12}" width="${barWidth}" height="8" rx="4" class="chart-bar-${tone}" />`,
        text(width - margin, y + 21, row.value, `chart-value-${tone}`, 'end')
      ].join('')
    })
    .join('')

  const facts = data.system
    .map((fact, index) => {
      const x = margin + (index % columns) * (columnWidth + columnGap)
      const y = factsTop + Math.floor(index / columns) * factHeight
      return [
        text(x, y + 18, fact.label, 'fact-label'),
        text(x, y + 42, fitText(fact.value, Math.floor(columnWidth / 8.4)), 'fact-value')
      ].join('')
    })
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    text { font-family: Inter, system-ui, sans-serif; font-variant-numeric: tabular-nums; }
    .background { fill: #121212; }
    .title { fill: #f5f5f5; font-size: 26px; font-weight: 600; }
    .section-label { fill: #8a8a8a; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; }
    .headline { fill: #ffffff; font-size: 64px; font-weight: 500; letter-spacing: -0.02em; }
    .headline-label { fill: #a3a3a3; font-size: 15px; }
    .chart-label { fill: #a3a3a3; font-size: 14px; }
    .chart-track { fill: #242424; }
    .chart-bar-strong { fill: #f5f5f5; }
    .chart-bar-soft { fill: #6b6b6b; }
    .chart-value-strong { fill: #ffffff; font-size: 16px; font-weight: 600; }
    .chart-value-soft { fill: #d4d4d4; font-size: 16px; }
    .fact-label { fill: #8a8a8a; font-size: 13px; }
    .fact-value { fill: #e5e5e5; font-size: 15px; }
    .footer-date { fill: #8a8a8a; font-size: 13px; }
  </style>
  <rect width="${width}" height="${height}" class="background" />
  ${text(margin, 72, data.title, 'title')}
  ${text(margin, resultsY + 86, data.headline.value, 'headline')}
  ${text(margin, resultsY + 120, data.headline.label, 'headline-label')}
  ${text(chartX, resultsY + 14, data.aggregateTitle.toUpperCase(), 'section-label')}
  ${chart}
  ${text(margin, systemY + 14, data.systemInformationTitle.toUpperCase(), 'section-label')}
  ${facts}
  <g role="img" aria-label="Comfy" transform="translate(${margin} ${height - 60}) scale(0.65)">
    <path d="${COMFY_WORDMARK_PATH}" fill="#ffffff" />
  </g>
  ${text(width - margin, height - 37, data.testDateTime, 'footer-date', 'end')}
</svg>`
}

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
