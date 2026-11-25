import { HOST } from './buildStart'

/**
 * The samples Get started shows. Each one is something Comfy does today:
 *  - comfy-mcp and its client configs: comfy-desktop McpSetupModal.vue
 *  - POST /prompt with extra_data.api_key_comfy_org: ComfyUI
 *    script_examples/basic_api_example.py and execution.py
 *  - "Workflow › Export (API)": ComfyUI_frontend's workflow menu
 */

export const AGENT_INSTALL = {
  claude: 'pip install comfy-mcp && claude mcp add comfy-mcp -- comfy-mcp',
  json: `{
  "mcpServers": {
    "comfy-mcp": { "command": "comfy-mcp" }
  }
}`
}

export const AGENT_PROMPT =
  'Use the comfy-mcp tools to make a 1024×1024 image of a lighthouse at dusk on my ComfyUI, then tell me which workflow you ran and where the output was saved.'

export function sample(path: 'python' | 'js' | 'curl', key: string): string {
  if (path === 'python')
    return `import json
from urllib import request

# In ComfyUI: Workflow › Export (API)
workflow = json.load(open("workflow_api.json"))

payload = {
    "prompt": workflow,
    # Unlocks API nodes (partner models). Open models run without it.
    "extra_data": {"api_key_comfy_org": "${key}"},
}
req = request.Request("${HOST}/prompt", data=json.dumps(payload).encode())
print(json.loads(request.urlopen(req).read()))  # {"prompt_id": ...}`
  if (path === 'js')
    return `import { readFile } from 'node:fs/promises'

// In ComfyUI: Workflow › Export (API)
const workflow = JSON.parse(await readFile('workflow_api.json', 'utf8'))

const res = await fetch('${HOST}/prompt', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: workflow,
    // Unlocks API nodes (partner models). Open models run without it.
    extra_data: { api_key_comfy_org: '${key}' }
  })
})
const { prompt_id } = await res.json()`
  return `# In ComfyUI: Workflow › Export (API)
jq '{prompt: ., extra_data: {api_key_comfy_org: "${key}"}}' workflow_api.json \\
  | curl -X POST ${HOST}/prompt \\
      -H "Content-Type: application/json" -d @-`
}

export const SAMPLE_FILE = { python: 'first_run.py', js: 'first-run.mjs', curl: 'Terminal' }
export const SAMPLE_LANG = { python: 'python', js: 'js', curl: 'bash' } as const
