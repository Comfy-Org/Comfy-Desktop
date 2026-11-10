export interface ProgressStepVM {
  phase: string
  label: string
  status: 'done' | 'active' | 'pending'
  detail: string | null
  subPercent: number | null
  isError: boolean
}
