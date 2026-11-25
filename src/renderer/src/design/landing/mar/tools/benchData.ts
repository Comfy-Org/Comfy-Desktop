import { reactive } from 'vue'

/**
 * The runs a Performance Test leaves behind, as Benchmarks lists them
 * (Desktop's BenchmarksView, Comfy-Desktop#2015). Durations are seconds
 * per measured run. A machine is told apart by GPU, CPU, memory and OS.
 */
export interface BenchRun {
  id: string
  session: string
  date: string
  workflow: string
  build: string
  workspace: string
  hardware: string
  cpu: string
  memory: number
  os: string
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
/** Desktop's Benchmarks drops trailing zeros: "1.6 s", "3 s". */
export const fmtS = (s: number): string => `${Number(s.toFixed(2))} s`

const DESK = { hardware: 'RTX 4090', cpu: 'Ryzen 9 7950X', memory: 64, os: 'Windows 11' }
const LAPTOP = { hardware: 'RTX 4070 Laptop', cpu: 'Core i9-13980HX', memory: 32, os: 'Windows 11' }
const MAC = { hardware: 'Apple M3 Max', cpu: 'Apple M3 Max', memory: 64, os: 'macOS 15' }

/** Five measured runs spread around a median. */
const around = (m: number, spread: number): number[] =>
  [-0.6, -0.25, 0, 0.35, 1].map((k) => Number((m + k * spread).toFixed(2)))

export const BENCH_RUNS = reactive<BenchRun[]>([
  {
    id: 'r1',
    session: 'sdxl-nightly-4090',
    date: 'Nov 12, 2026, 1:20 PM',
    workflow: 'sdxl_turbo_api.json',
    build: 'Video Lab',
    workspace: 'Personal',
    ...DESK,
    runs: 5,
    failed: 0,
    durations: around(1.6, 0.4)
  },
  {
    id: 'r2',
    session: 'sdxl-stable-4090',
    date: 'Nov 11, 2026, 12:25 PM',
    workflow: 'sdxl_turbo_api.json',
    build: 'My Local 1',
    workspace: 'Personal',
    ...DESK,
    runs: 5,
    failed: 0,
    durations: around(1.81, 0.3)
  },
  {
    id: 'r3',
    session: 'sdxl-studio-4090',
    date: 'Nov 10, 2026, 11:24 AM',
    workflow: 'sdxl_turbo_api.json',
    build: 'Flux Sandbox',
    workspace: 'Design team',
    ...DESK,
    runs: 5,
    failed: 0,
    durations: around(2.27, 0.35)
  },
  {
    id: 'r4',
    session: 'sdxl-nightly-laptop',
    date: 'Nov 8, 2026, 7:22 PM',
    workflow: 'sdxl_turbo_api.json',
    build: 'Video Lab',
    workspace: 'Personal',
    ...LAPTOP,
    runs: 5,
    failed: 0,
    durations: around(2.74, 0.5)
  },
  {
    id: 'r5',
    session: 'sdxl-stable-laptop',
    date: 'Nov 9, 2026, 8:23 PM',
    workflow: 'sdxl_turbo_api.json',
    build: 'My Local 1',
    workspace: 'Personal',
    ...LAPTOP,
    runs: 5,
    failed: 0,
    durations: around(3, 0.55)
  },
  {
    id: 'r6',
    session: 'sdxl-stable-m3',
    date: 'Nov 2, 2026, 1:22 PM',
    workflow: 'sdxl_turbo_api.json',
    build: 'My Local 1',
    workspace: 'Personal',
    ...MAC,
    runs: 5,
    failed: 0,
    durations: around(6.3, 1.4)
  },
  {
    id: 'r7',
    session: 'flux-studio-4090',
    date: 'Nov 5, 2026, 4:25 PM',
    workflow: 'flux_dev_fp8_api.json',
    build: 'Flux Sandbox',
    workspace: 'Design team',
    ...DESK,
    runs: 5,
    failed: 0,
    durations: around(12.68, 2.4)
  },
  {
    id: 'r8',
    session: 'flux-nightly-4090',
    date: 'Nov 6, 2026, 5:20 PM',
    workflow: 'flux_dev_fp8_api.json',
    build: 'Video Lab',
    workspace: 'Personal',
    ...DESK,
    runs: 5,
    failed: 0,
    durations: around(13.21, 1.7)
  },
  {
    id: 'r9',
    session: 'flux-stable-4090',
    date: 'Nov 7, 2026, 6:21 PM',
    workflow: 'flux_dev_fp8_api.json',
    build: 'My Local 1',
    workspace: 'Personal',
    ...DESK,
    runs: 5,
    failed: 1,
    durations: [13.9, 14.4, 14.7, 15.6]
  },
  {
    id: 'r10',
    session: 'yue2-studio-laptop',
    date: 'Nov 4, 2026, 3:24 PM',
    workflow: 'audio_yue2_text2music.json',
    build: 'Flux Sandbox',
    workspace: 'Design team',
    ...LAPTOP,
    runs: 5,
    failed: 0,
    durations: around(59.57, 6)
  },
  {
    id: 'r11',
    session: 'yue2-stable-laptop',
    date: 'Nov 3, 2026, 2:23 PM',
    workflow: 'audio_yue2_text2music.json',
    build: 'My Local 1',
    workspace: 'Personal',
    ...LAPTOP,
    runs: 5,
    failed: 0,
    durations: around(65.21, 4)
  }
])
