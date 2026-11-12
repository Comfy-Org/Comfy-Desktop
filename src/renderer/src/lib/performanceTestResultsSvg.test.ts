import { describe, expect, it } from 'vitest'
import { createPerformanceTestResultsSvg, estimateTextWidth } from './performanceTestResultsSvg'

describe('createPerformanceTestResultsSvg', () => {
  it('renders the result metrics and escapes system values as valid XML', () => {
    const svg = createPerformanceTestResultsSvg({
      title: 'Performance Test: cat-workflow.json',
      aggregateTitle: 'Run duration',
      systemInformationTitle: 'System information',
      testDateTime: 'Sep 11, 2026, 12:34 PM',
      headline: { label: 'Median run · 5 measured · 0 failed', value: '1.500 s' },
      durations: [
        { label: 'Fastest run', value: '1.250 s', durationSeconds: 1.25 },
        { label: 'Median run', value: '1.500 s', durationSeconds: 1.5, highlight: true },
        { label: 'Slowest run', value: '2.500 s', durationSeconds: 2.5 }
      ],
      system: [
        { label: 'Compute device', value: 'GPU <fast> & efficient' },
        { label: 'CPU', value: 'Example CPU' }
      ]
    })

    expect(svg).toContain('<svg')
    expect(svg).toContain('role="img" aria-label="Comfy"')
    expect(svg).toContain('fill="#ffffff"')
    expect(svg).toContain('<path d="M170.474')
    expect(svg).toContain('Performance Test: cat-workflow.json')
    expect(svg).toContain('Sep 11, 2026, 12:34 PM')
    expect(svg).toContain('scale(0.65)')
    expect(svg).toContain('Median run · 5 measured · 0 failed')
    expect(svg).toContain('RUN DURATION')
    expect(svg).toContain('SYSTEM INFORMATION')
    expect(svg).toContain('GPU &lt;fast&gt; &amp; efficient')
    expect(svg).not.toContain('GPU <fast>')
    expect(svg).not.toContain('stroke')
  })

  it('scales each duration bar against the slowest run and highlights only the median', () => {
    const svg = createPerformanceTestResultsSvg({
      title: 'Performance Test: cat-workflow.json',
      aggregateTitle: 'Run duration',
      systemInformationTitle: 'System information',
      testDateTime: 'Sep 11, 2026, 12:34 PM',
      headline: { label: 'Median run · 2 measured · 0 failed', value: '2.000 s' },
      durations: [
        { label: 'Fastest run', value: '1.000 s', durationSeconds: 1 },
        { label: 'Median run', value: '2.000 s', durationSeconds: 2, highlight: true }
      ],
      system: [{ label: 'CPU', value: 'Example CPU' }]
    })

    const bars = [...svg.matchAll(/width="([\d.]+)" height="8" rx="4" class="chart-bar-(\w+)"/g)]
    expect(bars.map((bar) => bar[2])).toEqual(['soft', 'strong'])
    expect(Number(bars[0]![1]) * 2).toBeCloseTo(Number(bars[1]![1]))
  })

  it('shrinks a slow median so it stays clear of the duration chart', () => {
    const image = (median: string) =>
      createPerformanceTestResultsSvg({
        title: 'Performance Test: video.json',
        aggregateTitle: 'Run duration',
        systemInformationTitle: 'System information',
        testDateTime: 'Sep 11, 2026, 12:34 PM',
        headline: { label: 'Median run · 5 measured · 0 failed', value: median },
        durations: [{ label: 'Median run', value: median, durationSeconds: 1, highlight: true }],
        system: [{ label: 'CPU', value: 'Example CPU' }]
      })
    const headlineSize = (svg: string) =>
      Number(svg.match(/\.headline \{[^}]*font-size: (\d+)px/)![1])
    const chartLeft = Number(image('1.875 s').match(/<text x="(\d+)"[^>]*class="chart-label"/)![1])

    expect(headlineSize(image('1.875 s'))).toBe(64)
    for (const median of ['123.456 s', '1234.567 s']) {
      const size = headlineSize(image(median))
      expect(size).toBeLessThan(64)
      expect(56 + estimateTextWidth(median, size)).toBeLessThan(chartLeft)
    }
  })

  it('shortens long system values so they stay inside their column', () => {
    const svg = createPerformanceTestResultsSvg({
      title: 'Performance Test: cat-workflow.json',
      aggregateTitle: 'Run duration',
      systemInformationTitle: 'System information',
      testDateTime: 'Sep 11, 2026, 12:34 PM',
      headline: { label: 'Median run · 1 measured · 0 failed', value: '1.000 s' },
      durations: [{ label: 'Median run', value: '1.000 s', durationSeconds: 1, highlight: true }],
      system: [{ label: 'Operating system', value: 'A'.repeat(80) }]
    })

    expect(svg).not.toContain('A'.repeat(80))
    expect(svg).toContain('…')
  })
})
