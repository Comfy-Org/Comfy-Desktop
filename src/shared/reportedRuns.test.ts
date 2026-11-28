import { describe, expect, it } from 'vitest'

import { MAX_REPORTED_RUNS, readReportedRuns } from './reportedRuns'

describe('readReportedRuns', () => {
  it('means the page sends no run list when the value is not a list', () => {
    expect(readReportedRuns(undefined)).toBeNull()
    expect(readReportedRuns({ id: 'a' })).toBeNull()
  })

  it('keeps the known fields of each run and drops the rest', () => {
    expect(
      readReportedRuns([
        {
          id: ' run-1 ',
          where: 'local',
          state: 'running',
          step: '  Loading models ',
          stepIndex: 1,
          stepCount: 3,
          progress: 0.28,
          startedAt: 1_700_000_000_000,
          html: '<b>no</b>'
        }
      ])
    ).toEqual([
      {
        id: 'run-1',
        where: 'local',
        state: 'running',
        step: 'Loading models',
        stepIndex: 1,
        stepCount: 3,
        progress: 0.28,
        startedAt: 1_700_000_000_000
      }
    ])
  })

  it('skips a run with no id, an unknown place or state, or an id it already has', () => {
    const runs = readReportedRuns([
      { where: 'cloud', state: 'running' },
      { id: 'a', where: 'moon', state: 'running' },
      { id: 'b', where: 'cloud', state: 'paused' },
      { id: 'c', where: 'cloud', state: 'queued', ahead: 2 },
      { id: 'c', where: 'local', state: 'done' },
      'c'
    ])

    expect(runs).toEqual([{ id: 'c', where: 'cloud', state: 'queued', ahead: 2 }])
  })

  it('clamps progress, and ignores counts and times that make no sense', () => {
    const [run] =
      readReportedRuns([
        {
          id: 'a',
          where: 'cloud',
          state: 'running',
          progress: 4,
          stepIndex: 0,
          stepCount: 2.5,
          ahead: -1,
          startedAt: Number.NaN,
          endedAt: -5
        }
      ]) ?? []

    expect(run).toEqual({ id: 'a', where: 'cloud', state: 'running', progress: 1 })
  })

  it('keeps canStop only as true, and only for runs still going', () => {
    const runs = readReportedRuns([
      { id: 'a', where: 'cloud', state: 'running', canStop: true },
      { id: 'b', where: 'cloud', state: 'queued', canStop: 'yes' },
      { id: 'c', where: 'cloud', state: 'done', canStop: true }
    ])

    expect(runs).toEqual([
      { id: 'a', where: 'cloud', state: 'running', canStop: true },
      { id: 'b', where: 'cloud', state: 'queued' },
      { id: 'c', where: 'cloud', state: 'done' }
    ])
  })

  it('drops a step number past the step count', () => {
    const [run] =
      readReportedRuns([
        { id: 'a', where: 'local', state: 'running', stepIndex: 5, stepCount: 4 }
      ]) ?? []

    expect(run).toEqual({ id: 'a', where: 'local', state: 'running' })
  })

  it(`keeps at most ${MAX_REPORTED_RUNS} runs`, () => {
    const many = Array.from({ length: MAX_REPORTED_RUNS + 5 }, (_, i) => ({
      id: `r${i}`,
      where: 'cloud',
      state: 'done'
    }))

    expect(readReportedRuns(many)).toHaveLength(MAX_REPORTED_RUNS)
  })
})
