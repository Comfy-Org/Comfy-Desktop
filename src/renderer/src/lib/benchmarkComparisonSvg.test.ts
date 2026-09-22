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

describe('createBenchmarkComparisonSvg', () => {
  it('starts aligned chart tracks after the longest run information', () => {
    const shortLabelStart = chartTrackStart(createBenchmarkComparisonSvg(comparisonData('a.json')))
    const longLabelStart = chartTrackStart(
      createBenchmarkComparisonSvg(comparisonData('considerably-longer-workflow-name.json'))
    )

    expect(longLabelStart).toBeGreaterThan(shortLabelStart)
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
