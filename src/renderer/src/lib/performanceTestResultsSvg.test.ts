import { describe, expect, it } from 'vitest'
import { createPerformanceTestResultsSvg } from './performanceTestResultsSvg'

describe('createPerformanceTestResultsSvg', () => {
  it('renders the result metrics and escapes system values as valid XML', () => {
    const svg = createPerformanceTestResultsSvg({
      title: 'Performance Test: cat-workflow.json',
      aggregateTitle: 'Run duration aggregates',
      systemInformationTitle: 'System information',
      testDateTime: 'Sep 11, 2026, 12:34 PM',
      metrics: [
        { label: 'Measured runs', value: '5' },
        { label: 'Fastest run', value: '1.250 s', durationSeconds: 1.25 }
      ],
      hardware: [{ label: 'Compute device', value: 'GPU <fast> & efficient' }],
      system: [{ label: 'CPU', value: 'Example CPU' }]
    })

    expect(svg).toContain('<svg')
    expect(svg).toContain('role="img" aria-label="Comfy"')
    expect(svg).toContain('fill="#F2FF59"')
    expect(svg).toContain('<path d="M170.474')
    expect(svg).toContain('Performance Test: cat-workflow.json')
    expect(svg).toContain('Sep 11, 2026, 12:34 PM')
    expect(svg).toContain('scale(0.65)')
    expect(svg).not.toContain('translate(1110 28)')
    expect(svg).toContain('Measured runs')
    expect(svg).toContain('Run duration aggregates')
    expect(svg).toContain('GPU &lt;fast&gt; &amp; efficient')
    expect(svg).not.toContain('GPU <fast>')
  })
})
