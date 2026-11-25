import { computed, reactive } from 'vue'

export type Connection = 'online' | 'offline'

export const CONNECTIONS: { value: Connection; label: string }[] = [
  { value: 'online', label: 'Online' },
  { value: 'offline', label: 'Offline' }
]

export const connection = reactive<{ id: Connection }>({ id: 'online' })

export const offline = computed(() => connection.id === 'offline')

export const CLOUD_HOST = 'cloud.comfy.org'

export const OFFLINE_COPY = {
  homeApps: "Apps couldn't be loaded. Check your connection and try again.",
  homeWorkflows: "Example workflows couldn't be loaded. Check your connection and try again.",
  retry: 'Try again',
  appsTitle: "Apps didn't load",
  appsBody: 'Check your internet connection, then try again.',
  appTitle: (app: string): string => `${app} didn't load`,
  connecting: (secs: number): string => `Connecting to ${CLOUD_HOST}… (${secs}s)`,
  cannotConnect: `Could not connect to ${CLOUD_HOST}. Make sure ComfyUI is running at that address.`
} as const
