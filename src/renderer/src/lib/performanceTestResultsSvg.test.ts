import { describe, expect, it } from 'vitest'
import { createPerformanceTestResultsSvg } from './performanceTestResultsSvg'

describe('createPerformanceTestResultsSvg', () => {
  it('renders the result metrics and escapes system values as valid XML', () => {
    const svg = createPerformanceTestResultsSvg({
      title: 'Performance test results',
      aggregateTitle: 'Run duration aggregates',
      systemInformationTitle: 'System information',
      metrics: [
        { label: 'Measured runs', value: '5' },
        { label: 'Fastest run', value: '1.250 s', durationSeconds: 1.25 }
      ],
      hardware: [{ label: 'Compute device', value: 'GPU <fast> & efficient' }],
      system: [{ label: 'CPU', value: 'Example CPU' }]
    })

    expect(svg).toContain('<svg')
    expect(svg).toContain('Measured runs')
    expect(svg).toContain('Run duration aggregates')
    expect(svg).toContain('GPU &lt;fast&gt; &amp; efficient')
    expect(svg).not.toContain('GPU <fast>')
  })
})
