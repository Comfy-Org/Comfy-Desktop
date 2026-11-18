import { execFile } from 'child_process'
import * as path from 'path'
import { readGitHead } from './git'

export interface ComfyArgDef {
  name: string
  flag: string
  help: string
  type: 'boolean' | 'value' | 'optional-value' | 'multi-value'
  metavar?: string
  choices?: string[]
  exclusiveGroup?: string
  category: string
}

export interface ComfyArgsSchema {
  args: ComfyArgDef[]
  knownFlags: Set<string>
}

const CATEGORY_MAP: Record<string, string> = {
  listen: 'network',
  port: 'network',
  'tls-keyfile': 'network',
  'tls-certfile': 'network',
  'enable-cors-header': 'network',
  'max-upload-size': 'network',
  'multi-user': 'network',
  'enable-compress-response-body': 'network',

  'base-directory': 'paths',
  'extra-model-paths-config': 'paths',
  'output-directory': 'paths',
  'temp-directory': 'paths',
  'input-directory': 'paths',
  'user-directory': 'paths',
  'models-directory': 'paths',
  'front-end-root': 'paths',

  'auto-launch': 'launch',
  'disable-auto-launch': 'launch',
  'windows-standalone-build': 'launch',

  'cuda-device': 'gpuVram',
  'default-device': 'gpuVram',
  'cuda-malloc': 'gpuVram',
  'disable-cuda-malloc': 'gpuVram',
  directml: 'gpuVram',
  'oneapi-device-selector': 'gpuVram',
  'disable-ipex-optimize': 'gpuVram',
  'supports-fp8-compute': 'gpuVram',
  'gpu-only': 'gpuVram',
  highvram: 'gpuVram',
  normalvram: 'gpuVram',
  lowvram: 'gpuVram',
  novram: 'gpuVram',
  cpu: 'gpuVram',
  'reserve-vram': 'gpuVram',
  'vram-headroom': 'gpuVram',
  'async-offload': 'gpuVram',
  'disable-async-offload': 'gpuVram',
  'disable-dynamic-vram': 'gpuVram',
  'enable-dynamic-vram': 'gpuVram',
  'fast-disk': 'gpuVram',
  'force-non-blocking': 'gpuVram',
  'disable-smart-memory': 'gpuVram',
  'disable-pinned-memory': 'gpuVram',

  'force-fp32': 'precision',
  'force-fp16': 'precision',
  'fp32-unet': 'precision',
  'fp64-unet': 'precision',
  'bf16-unet': 'precision',
  'fp16-unet': 'precision',
  'fp8_e4m3fn-unet': 'precision',
  'fp8_e5m2-unet': 'precision',
  'fp8_e8m0fnu-unet': 'precision',
  'fp16-vae': 'precision',
  'fp32-vae': 'precision',
  'bf16-vae': 'precision',
  'cpu-vae': 'precision',
  'fp8_e4m3fn-text-enc': 'precision',
  'fp8_e5m2-text-enc': 'precision',
  'fp16-text-enc': 'precision',
  'fp32-text-enc': 'precision',
  'bf16-text-enc': 'precision',
  'fp16-intermediates': 'precision',
  'force-channels-last': 'precision',

  'use-split-cross-attention': 'performance',
  'use-quad-cross-attention': 'performance',
  'use-pytorch-cross-attention': 'performance',
  'use-sage-attention': 'performance',
  'use-flash-attention': 'performance',
  'use-ck-attention': 'performance',
  'enable-triton-backend': 'performance',
  'disable-triton-backend': 'performance',
  'disable-xformers': 'performance',
  'force-upcast-attention': 'performance',
  'dont-upcast-attention': 'performance',
  deterministic: 'performance',
  fast: 'performance',
  'mmap-torch-files': 'performance',
  'disable-mmap': 'performance',

  'cache-classic': 'cache',
  'cache-lru': 'cache',
  'cache-none': 'cache',
  'cache-ram': 'cache',
  'high-ram': 'cache',

  'preview-method': 'preview',
  'preview-size': 'preview',

  'enable-manager': 'manager',
  'disable-manager-ui': 'manager',
  'enable-manager-legacy-ui': 'manager',

  'front-end-version': 'frontend',

  'disable-metadata': 'features',
  'disable-all-custom-nodes': 'features',
  'whitelist-custom-nodes': 'features',
  'disable-api-nodes': 'features',
  'enable-assets': 'features',
  'enable-asset-hashing': 'features',

  verbose: 'logging',
  'log-stdout': 'logging',
  'dont-print-server': 'logging',
  'debug-hang': 'logging',

  'default-hashing-function': 'advanced',
  'quick-test-for-ci': 'advanced',
  'comfy-api-base': 'advanced',
  'database-url': 'advanced'
}

const CATEGORY_ORDER = [
  'network',
  'launch',
  'gpuVram',
  'precision',
  'performance',
  'cache',
  'preview',
  'manager',
  'frontend',
  'features',
  'paths',
  'logging',
  'advanced',
  'other'
]

const HIDDEN_ARGS = new Set(['feature-flag', 'list-feature-flags'])

function getCategory(flagName: string): string {
  return CATEGORY_MAP[flagName] || 'other'
}

function parseExclusiveGroups(usageLine: string): Map<string, string> {
  const flagToGroup = new Map<string, string>()
  let groupId = 0
  for (let i = 0; i < usageLine.length; i++) {
    const open = usageLine[i]
    if (open !== '[' && open !== '(') continue
    let depth = 0
    let j = i
    for (; j < usageLine.length; j++) {
      const c = usageLine[j]
      if (c === '[' || c === '(') depth++
      else if ((c === ']' || c === ')') && --depth === 0) break
    }
    const content = usageLine.slice(i + 1, j)
    if (content.includes('|')) {
      const flags = content.match(/--[\w_-]+/g)
      if (flags && flags.length > 1) {
        const gid = `group_${groupId++}`
        for (const flag of flags) {
          flagToGroup.set(flag.slice(2), gid)
        }
      }
    }
    i = j
  }
  return flagToGroup
}

interface ParsedOption {
  name: string
  flag: string
  type: 'boolean' | 'value' | 'optional-value' | 'multi-value'
  metavar?: string
  choices?: string[]
  help: string
}

function parseOptionsSection(optionsText: string): ParsedOption[] {
  const results: ParsedOption[] = []

  const lines = optionsText.split('\n')
  let current: { flagLine: string; helpLines: string[] } | null = null

  for (const line of lines) {
    const optMatch = line.match(/^ {2}(--\S+(?:\s+(?:\[?\S+\]?(?:\s+\.\.\.)?))*)\s{2,}(.*)$/)
    if (optMatch) {
      if (current) results.push(parseOptionBlock(current.flagLine, current.helpLines.join(' ')))
      current = { flagLine: optMatch[1]!, helpLines: [] }
      if (optMatch[2]!.trim()) current.helpLines.push(optMatch[2]!.trim())
    } else {
      const flagOnly = line.match(/^ {2}(--\S+(?:\s+\S+)*)\s*$/)
      if (flagOnly) {
        if (current) results.push(parseOptionBlock(current.flagLine, current.helpLines.join(' ')))
        current = { flagLine: flagOnly[1]!, helpLines: [] }
      } else if (current) {
        const trimmed = line.trim()
        if (trimmed) current.helpLines.push(trimmed)
      }
    }
  }
  if (current) results.push(parseOptionBlock(current.flagLine, current.helpLines.join(' ')))

  return results
}

function parseOptionBlock(flagLine: string, helpText: string): ParsedOption {
  const flagMatch = flagLine.match(/--([\w_][\w_-]*)/)
  if (!flagMatch) {
    return { name: 'unknown', flag: '--unknown', type: 'boolean', help: helpText }
  }

  const name = flagMatch[1]!
  const flag = `--${name}`
  const afterFlag = flagLine.slice(flagLine.indexOf(flag) + flag.length).trim()

  const isMulti = afterFlag.includes('...')

  const choicesMatch = afterFlag.match(/\[?\{([^}]+)\}\]?/) || afterFlag.match(/\[([\w,]+)\]/)
  if (choicesMatch) {
    const choices = choicesMatch[1]!.split(',').map((s) => s.trim())
    const isOptional = afterFlag.startsWith('[')
    return {
      name,
      flag,
      help: helpText,
      choices,
      type: isMulti ? 'multi-value' : isOptional ? 'optional-value' : 'value',
      metavar: undefined
    }
  }

  const metaMatch = afterFlag.match(/\[?([A-Z][A-Z0-9_]*(?:\s+\.\.\.)?)(?:\s+\[.*\])?\]?/)
  if (metaMatch) {
    const isOptional = afterFlag.startsWith('[')
    return {
      name,
      flag,
      help: helpText,
      type: isMulti ? 'multi-value' : isOptional ? 'optional-value' : 'value',
      metavar: metaMatch[1]!.replace(/\s+\.\.\./, '')
    }
  }

  if (!afterFlag || afterFlag.startsWith('  ')) {
    return { name, flag, type: 'boolean', help: helpText }
  }

  return { name, flag, type: 'value', help: helpText }
}

export function parseHelpOutput(helpText: string): ComfyArgsSchema {
  helpText = helpText.replace(/\r\n/g, '\n')
  const usageMatch = helpText.match(/^usage:.*?(?=\n\noptions:|$)/s)
  const usageLine = usageMatch ? usageMatch[0].replace(/\n\s+/g, ' ') : ''
  const exclusiveGroups = parseExclusiveGroups(usageLine)

  const optionsMatch = helpText.match(/\noptions:\n([\s\S]*)$/)
  const optionsText = optionsMatch ? optionsMatch[1]! : ''

  const parsedOptions = parseOptionsSection(optionsText)
  const knownFlags = new Set<string>()

  const args: ComfyArgDef[] = []
  for (const opt of parsedOptions) {
    if (opt.name === 'h' || opt.name === 'help') continue
    knownFlags.add(opt.name)
    if (HIDDEN_ARGS.has(opt.name)) continue
    args.push({
      name: opt.name,
      flag: opt.flag,
      help: opt.help,
      type: opt.type,
      metavar: opt.metavar,
      choices: opt.choices,
      exclusiveGroup: exclusiveGroups.get(opt.name),
      category: getCategory(opt.name)
    })
  }

  args.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category)
    const bi = CATEGORY_ORDER.indexOf(b.category)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

  return { args, knownFlags }
}

const schemaCache = new Map<string, { schema: ComfyArgsSchema; revision: string }>()

export async function getComfyArgsSchema(
  pythonPath: string,
  mainPyPath: string,
  cwd: string,
  installationId: string,
  fallbackRevision?: string
): Promise<ComfyArgsSchema> {
  const revision = readGitHead(path.dirname(mainPyPath)) ?? fallbackRevision
  const cached = schemaCache.get(installationId)
  if (cached && revision && cached.revision === revision) {
    return cached.schema
  }

  const helpText = await runHelp(pythonPath, mainPyPath, cwd)
  const schema = parseHelpOutput(helpText)

  if (revision) {
    schemaCache.set(installationId, { schema, revision })
  }

  return schema
}

export function peekComfyArgsSchema(
  mainPyPath: string,
  installationId: string,
  fallbackRevision?: string
): ComfyArgsSchema | null {
  const revision = readGitHead(path.dirname(mainPyPath)) ?? fallbackRevision
  const cached = schemaCache.get(installationId)
  return cached && revision && cached.revision === revision ? cached.schema : null
}

function runHelp(pythonPath: string, mainPyPath: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mainPyRel = path.relative(cwd, mainPyPath)
    execFile(
      pythonPath,
      ['-s', mainPyRel, '--help'],
      { cwd, timeout: 15000 },
      (err, stdout, stderr) => {
        if (stdout && stdout.includes('usage:')) {
          resolve(stdout)
        } else if (stderr && stderr.includes('usage:')) {
          resolve(stderr)
        } else if (err) {
          const detail = stderr ? `\nstderr: ${stderr.slice(0, 500)}` : ''
          reject(new Error(`Failed to get ComfyUI --help: ${err.message}${detail}`))
        } else {
          reject(new Error('No help output from ComfyUI'))
        }
      }
    )
  })
}

export function validateArgs(userArgs: string[], schema: ComfyArgsSchema): string[] {
  const unsupported: string[] = []
  for (const arg of userArgs) {
    if (arg.startsWith('--')) {
      const name = arg.slice(2).replace(/=.*$/, '')
      if (!schema.knownFlags.has(name)) {
        unsupported.push(name)
      }
    }
  }
  return unsupported
}

export function filterUnsupportedArgs(userArgs: string[], schema: ComfyArgsSchema): string[] {
  const argTypes = new Map(schema.args.map((a) => [a.name, a.type]))
  const result: string[] = []
  let i = 0
  while (i < userArgs.length) {
    const arg = userArgs[i]!
    if (arg.startsWith('--')) {
      const name = arg.slice(2).replace(/=.*$/, '')
      const hasInlineValue = arg.includes('=')
      const isBoolean = argTypes.get(name) === 'boolean'
      const hasTrailingValue =
        !hasInlineValue &&
        !isBoolean &&
        i + 1 < userArgs.length &&
        !userArgs[i + 1]!.startsWith('--')
      if (schema.knownFlags.has(name)) {
        result.push(arg)
        if (hasTrailingValue) result.push(userArgs[i + 1]!)
      }
      if (hasTrailingValue) {
        i += 2
        continue
      }
    } else {
      result.push(arg)
    }
    i++
  }
  return result
}

export function clearSchemaCache(installationId: string): void {
  schemaCache.delete(installationId)
}
