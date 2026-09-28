import { describe, expect, it } from 'vitest'
import {
  createBenchmarkComparisonSvg,
  MAX_BENCHMARK_COMPARISON_EXPORT_RUNS,
  type BenchmarkComparisonImageData
} from './benchmarkComparisonSvg'

function comparisonData(workflowName: string): BenchmarkComparisonImageData {
  return {
    title: 'Benchmark comparison',
    metricTitle: 'Metric',
    durationRangeTitle: 'Duration range',
    durationRangeHint: 'Fastest to slowest duration, with the average marked.',
    exportDateTime: 'Sep 20, 2026',
    runs: [
      {
        color: '#55e0d1',
        properties: [
          { label: 'Workflow', value: workflowName },
          { label: 'Session', value: 'Session A' }
        ],
        metrics: [{ label: 'Average', value: '2 s', highlighted: false }],
        fastestDurationSeconds: 1,
        averageDurationSeconds: 2,
        slowestDurationSeconds: 3
      }
    ]
  }
}

function chartTrackStart(svg: string): number {
  const match = svg.match(/<line x1="([^"]+)"[^>]+class="chart-track"/)
  if (!match) throw new Error('Chart track not found.')
  return Number(match[1])
}

function textCoordinates(svg: string, className: string): string[] {
  return [
    ...svg.matchAll(new RegExp(`<text x="([^"]+)" y="([^"]+)" class="${className}"`, 'g'))
  ].map((match) => `${match[1]},${match[2]}`)
}

describe('createBenchmarkComparisonSvg', () => {
  it('starts aligned chart tracks after the longest run information', () => {
    const shortLabelStart = chartTrackStart(createBenchmarkComparisonSvg(comparisonData('a.json')))
    const longLabelStart = chartTrackStart(
      createBenchmarkComparisonSvg(comparisonData('considerably-longer-workflow-name.json'))
    )

    expect(longLabelStart).toBeGreaterThan(shortLabelStart)
  })

  it('renders the duration range subtitle', () => {
    const svg = createBenchmarkComparisonSvg(comparisonData('workflow.json'))

    expect(svg).toContain('Fastest to slowest duration, with the average marked.')
  })

  it('renders relative speed data instead of the duration range when provided', () => {
    const data = comparisonData('workflow.json')
    data.relativeSpeed = {
      title: 'Relative speed',
      hint: 'Baseline duration / run duration',
      slowerLabel: 'Slower',
      fasterLabel: 'Faster'
    }
    data.runs[0]!.relativeSpeed = {
      durationSeconds: 2,
      factor: 1.5,
      isBaseline: false,
      status: 'Faster'
    }

    const svg = createBenchmarkComparisonSvg(data)

    expect(svg).toContain('Relative speed')
    expect(svg).toContain('Baseline duration / run duration')
    expect(svg).toContain('1.50× Faster')
    expect(svg).toContain('class="relative-bar relative-faster"')
    expect(svg).toContain('.relative-direction { font: 11px system-ui, sans-serif; }')
    expect(svg).not.toContain('>Duration range</text>')
  })

  it('distinguishes equal speed from the baseline and includes unavailable status', () => {
    const data = comparisonData('workflow.json')
    data.relativeSpeed = {
      title: 'Relative speed',
      hint: 'Baseline duration / run duration',
      slowerLabel: 'Slower',
      fasterLabel: 'Faster'
    }
    data.runs = [
      {
        ...data.runs[0]!,
        relativeSpeed: {
          durationSeconds: 2,
          factor: 1,
          isBaseline: true,
          status: 'Baseline'
        }
      },
      {
        ...data.runs[0]!,
        relativeSpeed: {
          durationSeconds: 2,
          factor: 1,
          isBaseline: false,
          status: 'Same speed'
        }
      },
      {
        ...data.runs[0]!,
        relativeSpeed: {
          durationSeconds: null,
          factor: null,
          isBaseline: false,
          status: 'Unavailable'
        }
      }
    ]

    const svg = createBenchmarkComparisonSvg(data)

    expect(svg).toContain('1.00× Baseline')
    expect(svg).toContain('1.00× Same speed')
    expect(svg).toContain('— Unavailable')
    expect(svg.match(/class="relative-baseline-marker"/g)).toHaveLength(1)
  })

  it('keeps shared export content aligned between visualizations', () => {
    const data = comparisonData('workflow.json')
    const durationSvg = createBenchmarkComparisonSvg(data)
    data.relativeSpeed = {
      title: 'Relative speed',
      hint: 'Baseline duration / run duration',
      slowerLabel: 'Slower',
      fasterLabel: 'Faster'
    }
    const speedSvg = createBenchmarkComparisonSvg(data)

    expect(speedSvg.match(/viewBox="([^"]+)"/)?.[1]).toBe(
      durationSvg.match(/viewBox="([^"]+)"/)?.[1]
    )
    expect(textCoordinates(speedSvg, 'run-title')).toEqual(
      textCoordinates(durationSvg, 'run-title')
    )
    expect(textCoordinates(speedSvg, 'run-property')).toEqual(
      textCoordinates(durationSvg, 'run-property')
    )
    expect(textCoordinates(speedSvg, 'chart-hint')).toEqual(
      textCoordinates(durationSvg, 'chart-hint')
    )
  })

  it('rejects a comparison that would exceed the safe export run count', () => {
    const data = comparisonData('workflow.json')
    data.runs = Array.from(
      { length: MAX_BENCHMARK_COMPARISON_EXPORT_RUNS + 1 },
      () => data.runs[0]!
    )

    expect(() => createBenchmarkComparisonSvg(data)).toThrow(
      `support up to ${MAX_BENCHMARK_COMPARISON_EXPORT_RUNS} runs`
    )
  })
})
