import { reactive, watch } from 'vue'

export type AgentOpens = 'create' | 'comfy'

const KEY = 'comfy.design.mar.agentOpens'

export const AGENT_OPENS: { value: AgentOpens; label: string }[] = [
  { value: 'create', label: 'In Create' },
  { value: 'comfy', label: 'In ComfyUI' }
]

export const agentOpens = reactive<{ id: AgentOpens }>({
  id: (() => {
    try {
      return localStorage.getItem(KEY) === 'comfy' ? 'comfy' : 'create'
    } catch {
      return 'create'
    }
  })()
})

watch(
  () => agentOpens.id,
  (id) => {
    try {
      localStorage.setItem(KEY, id)
    } catch {
      return
    }
  }
)
