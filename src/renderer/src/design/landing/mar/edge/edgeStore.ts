import { reactive } from 'vue'

export type EdgeCase =
  | 'off'
  | 'e1'
  | 'e2-out'
  | 'e2-credits'
  | 'e2-pick'
  | 'e3'
  | 'e5'
  | 'e6'
  | 'e9'
  | 'e10'
  | 'e11'
  | 'e12'

export const EDGE_CASES: { value: EdgeCase; label: string; where: string }[] = [
  { value: 'off', label: 'Off', where: '' },
  {
    value: 'e1',
    label: 'E1 Offline first launch',
    where: 'First launch › Set up. Try again, then the connection comes back on its own.'
  },
  {
    value: 'e2-out',
    label: 'E2 Download fails · signed out',
    where: 'Template modal › download failed, logged out.'
  },
  {
    value: 'e2-credits',
    label: 'E2 Download fails · no credits',
    where: 'Template modal › download failed, out of credits.'
  },
  {
    value: 'e2-pick',
    label: 'E2 Download fails · pick another build',
    where: 'Template modal › download failed on a workflow Cloud cannot run.'
  },
  { value: 'e3', label: 'E3 Disk full', where: 'Template modal › download stopped, disk full.' },
  {
    value: 'e5',
    label: 'E5 Start fails twice',
    where: 'A build’s tab › ComfyUI still could not start after Restart.'
  },
  {
    value: 'e6',
    label: 'E6 Models not downloadable',
    where: 'ComfyUI › missing models dialog on Krea street.'
  },
  { value: 'e9', label: 'E9 Install fails', where: 'First launch › the install stops halfway.' },
  {
    value: 'e10',
    label: 'E10 Can’t run locally',
    where: 'First launch › Set up on an Intel Mac.'
  },
  {
    value: 'e11',
    label: 'E11 No Cloud credits',
    where: 'Template modal › a Cloud workflow, out of credits.'
  },
  {
    value: 'e12',
    label: 'E12 Login fails',
    where: 'Home › the login banner after a rejected login.'
  }
]

export const edgeCase = reactive<{ id: EdgeCase }>({ id: 'off' })

export const SIMULATED_RECONNECT_MS = 6000
