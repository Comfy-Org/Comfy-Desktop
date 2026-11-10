import { reactive } from 'vue'

/**
 * The runs a Performance Test leaves behind, as Benchmarks lists them
 * (Desktop's BenchmarksView). Durations are seconds per measured run.
 */
export interface BenchRun {
  id: string
  session: string
  date: string
  workflow: string
  build: string
  workspace: string
  hardware: string
  runs: number
  failed: number
  durations: number[]
}

const stats = (d: number[]) => {
  const s = [...d].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return {
    fastest: s[0]!,
    slowest: s[s.length - 1]!,
    average: s.reduce((a, b) => a + b, 0) / s.length,
    median: s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
  }
}
export const statsOf = (r: BenchRun) => stats(r.durations)
export const fmtSec = (s: number): string => `${s.toFixed(2)} s`

export const BENCH_RUNS = reactive<BenchRun[]>([
  {
    id: 'r1',
    session: 'flux-dev-baseline',
    date: 'Nov 10, 09:42',
    workflow: 'Flux.1 Dev · 1024²',
    build: 'My Local 1',
    workspace: 'Personal',
    hardware: 'RTX 4090 · 24 GB',
    runs: 5,
    failed: 0,
    durations: [11.84, 11.62, 11.71, 11.93, 11.66]
  },
  {
    id: 'r2',
    session: 'flux-dev-nightly',
    date: 'Nov 10, 10:15',
    workflow: 'Flux.1 Dev · 1024²',
    build: 'Video Lab',
    workspace: 'Personal',
    hardware: 'RTX 4090 · 24 GB',
    runs: 5,
    failed: 0,
    durations: [9.12, 9.4, 8.96, 9.21, 9.05]
  },
  {
    id: 'r3',
    session: 'sdxl-turbo',
    date: 'Nov 9, 18:03',
    workflow: 'SDXL Turbo · 512²',
    build: 'My Local 1',
    workspace: 'Personal',
    hardware: 'RTX 4090 · 24 GB',
    runs: 10,
    failed: 1,
    durations: [0.62, 0.58, 0.61, 0.6, 0.66, 0.59, 0.63, 0.6, 0.61]
  },
  {
    id: 'r4',
    session: 'wan-i2v-check',
    date: 'Nov 8, 14:27',
    workflow: 'Wan 2.2 · image to video',
    build: 'Flux Sandbox',
    workspace: 'Design team',
    hardware: 'M3 Max · 64 GB',
    runs: 3,
    failed: 0,
    durations: [214.3, 209.8, 221.6]
  },
  {
    id: 'r5',
    session: 'flux-dev-mac',
    date: 'Nov 7, 11:50',
    workflow: 'Flux.1 Dev · 1024²',
    build: 'Flux Sandbox',
    workspace: 'Design team',
    hardware: 'M3 Max · 64 GB',
    runs: 5,
    failed: 0,
    durations: [48.2, 47.6, 49.9, 48.8, 47.9]
  }
])
