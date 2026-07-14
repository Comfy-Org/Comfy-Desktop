/**
 * Parses ComfyUI's `python main.py --help` output into a structured schema
 * for the args-builder UI. Supports caching per installation version.
 */

import { execFile } from 'child_process'
import * as path from 'path'


export interface ComfyArgDef {
  /** CLI flag without leading dashes, e.g. "port" */
  name: string
  /** The full flag string, e.g. "--port" */
  flag: string
  help: string
  type: 'boolean' | 'value' | 'optional-value' | 'multi-value'
  /** Metavar from argparse (e.g. "PORT", "IP") */
  metavar?: string
  choices?: string[]
  /** Mutually exclusive group id (args sharing a group cannot coexist) */
  exclusiveGroup?: string
  /** Stable category key (slug), translated in the renderer for display. */
  category: string
}

export interface ComfyArgsSchema {
  args: ComfyArgDef[]
  knownFlags: Set<string>
}

/**
 * Maps each flag to a stable category key (a slug, not a display string).
 * The renderer translates these keys via i18n (`comfyUISettings.argsCategory.*`),
 * so category headers can be localized without changing this file.
 */
const CATEGORY_MAP: Record<string, string> = {
  'listen': 'network',
  'port': 'network',
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
  'directml': 'gpuVram',
  'oneapi-device-selector': 'gpuVram',
  'disable-ipex-optimize': 'gpuVram',
  'supports-fp8-compute': 'gpuVram',
  'gpu-only': 'gpuVram',
  'highvram': 'gpuVram',
  'normalvram': 'gpuVram',
  'lowvram': 'gpuVram',
  'novram': 'gpuVram',
  'cpu': 'gpuVram',
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
  'enable-triton-backend': 'performance',
  'disable-triton-backend': 'performance',
  'disable-xformers': 'performance',
  'force-upcast-attention': 'performance',
  'dont-upcast-attention': 'performance',
  'deterministic': 'performance',
  'fast': 'performance',
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

  'verbose': 'logging',
  'log-stdout': 'logging',
  'dont-print-server': 'logging',
  'debug-hang': 'logging',

  'default-hashing-function': 'advanced',
  'quick-test-for-ci': 'advanced',
  'comfy-api-base': 'advanced',
  'database-url': 'advanced',
}

const CATEGORY_ORDER = [
  'network', 'launch', 'gpuVram', 'precision', 'performance',
  'cache', 'preview', 'manager', 'frontend', 'features',
  'paths', 'logging', 'advanced', 'other',
]

/**
 * Flags present in --help but hidden from the suggestion panel (internal launcher use).
 * Still kept in `knownFlags` so user-typed values survive `filterUnsupportedArgs`.
 */
const HIDDEN_ARGS = new Set(['feature-flag', 'list-feature-flags'])

function getCategory(flagName: string): string {
  return CATEGORY_MAP[flagName] || 'other'
}

/** Parse the usage line's mutually exclusive groups: `[--flag1 | --flag2 | --flag3]`.
 *  Walks brackets depth-first so nested optional metavars (e.g. `--cache-ram [GB ...]`)
 *  don't prematurely close the surrounding group and drop later members. */
function parseExclusiveGroups(usageLine: string): Map<string, string> {
  const flagToGroup = new Map<string, string>()
  let groupId = 0
  for (let i = 0; i < usageLine.length; i++) {
    const open = usageLine[i]
    if (open !== '[' && open !== '(') continue
    // Find the matching close bracket, tracking nesting of both [] and ().
    let depth = 0
    let j = i
    for (; j < usageLine.length; j++) {
      const c = usageLine[j]
      if (c === '[' || c === '(') depth++
      else if ((c === ']' || c === ')') && --depth === 0) break
    }
    const content = usageLine.slice(i + 1, j)
    // A mutually exclusive group is a bracket containing `|`-separated alternatives.
    if (content.includes('|')) {
      const flags = content.match(/--[\w_-]+/g)
      if (flags && flags.length > 1) {
        const gid = `group_${groupId++}`
        for (const flag of flags) {
          flagToGroup.set(flag.slice(2), gid)
        }
      }
    }
    i = j // skip the whole group; nested brackets are part of it
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

  // argparse formats options as:
  //   --flag-name METAVAR    Help text starts here
  //                          continuation of help
  //   --another-flag         Help text on same line
  //
  // Flag definitions start at column 2. Help text is aligned ~column 24+.
  // We split on the large whitespace gap between flag and help.
  const lines = optionsText.split('\n')
  let current: { flagLine: string; helpLines: string[] } | null = null

  for (const line of lines) {
    // New option starts with 2-space indent + --
    const optMatch = line.match(/^ {2}(--\S+(?:\s+(?:\[?\S+\]?(?:\s+\.\.\.)?))*)\s{2,}(.*)$/)
    if (optMatch) {
      if (current) results.push(parseOptionBlock(current.flagLine, current.helpLines.join(' ')))
      current = { flagLine: optMatch[1]!, helpLines: [] }
      if (optMatch[2]!.trim()) current.helpLines.push(optMatch[2]!.trim())
    } else {
      // Flag-only line (no help on this line, e.g. long flag names)
      const flagOnly = line.match(/^ {2}(--\S+(?:\s+\S+)*)\s*$/)
      if (flagOnly) {
        if (current) results.push(parseOptionBlock(current.flagLine, current.helpLines.join(' ')))
        current = { flagLine: flagOnly[1]!, helpLines: [] }
      } else if (current) {
        // Continuation (help text), usually indented more
        const trimmed = line.trim()
        if (trimmed) current.helpLines.push(trimmed)
      }
    }
  }
  if (current) results.push(parseOptionBlock(current.flagLine, current.helpLines.join(' ')))

  return results
}

function parseOptionBlock(flagLine: string, helpText: string): ParsedOption {
  // Examples of flagLine patterns:
  //   --listen [IP]
  //   --port PORT
  //   --force-fp32
  //   --preview-method [none,auto,latent2rgb,taesd]
  //   --verbose [{DEBUG,INFO,WARNING,ERROR,CRITICAL}]
  //   --cache-lru CACHE_LRU
  //   --async-offload [NUM_STREAMS]
  //   --default-hashing-function {md5,sha1,sha256,sha512}
  //   --fast [FAST ...]
  //   --whitelist-custom-nodes WHITELIST_CUSTOM_NODES [WHITELIST_CUSTOM_NODES ...]

  // Extract the primary flag (first --xxx token)
  const flagMatch = flagLine.match(/--([\w_][\w_-]*)/)
  if (!flagMatch) {
    return { name: 'unknown', flag: '--unknown', type: 'boolean', help: helpText }
  }

  const name = flagMatch[1]!
  const flag = `--${name}`
  const afterFlag = flagLine.slice(flagLine.indexOf(flag) + flag.length).trim()

  // A `...` marks a variadic flag (argparse nargs `*`/`+`), e.g. `--cache-ram [GB ...]`
  // or `--whitelist-custom-nodes WL [WL ...]`, which accept several space-separated values.
  const isMulti = afterFlag.includes('...')

  // Choices: {a,b,c} or [a,b,c] or [{a,b,c}]
  const choicesMatch = afterFlag.match(/\[?\{([^}]+)\}\]?/) || afterFlag.match(/\[([\w,]+)\]/)
  if (choicesMatch) {
    const choices = choicesMatch[1]!.split(',').map((s) => s.trim())
    // Brackets [] mean optional (usable without a value)
    const isOptional = afterFlag.startsWith('[')
    return {
      name, flag, help: helpText, choices,
      type: isMulti ? 'multi-value' : isOptional ? 'optional-value' : 'value',
      metavar: undefined,
    }
  }

  // Metavar: UPPER_CASE or [UPPER_CASE] or [UPPER_CASE ...]
  const metaMatch = afterFlag.match(/\[?([A-Z][A-Z0-9_]*(?:\s+\.\.\.)?)(?:\s+\[.*\])?\]?/)
  if (metaMatch) {
    const isOptional = afterFlag.startsWith('[')
    return {
      name, flag, help: helpText,
      type: isMulti ? 'multi-value' : isOptional ? 'optional-value' : 'value',
      metavar: metaMatch[1]!.replace(/\s+\.\.\./, ''),
    }
  }

  // No metavar, no choices = boolean flag
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
      category: getCategory(opt.name),
    })
  }

  // Sort by category order, then by original order within category
  args.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a.category)
    const bi = CATEGORY_ORDER.indexOf(b.category)
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

  return { args, knownFlags }
}

const schemaCache = new Map<string, { schema: ComfyArgsSchema; version: string }>()

/** Run `python main.py --help` and parse the output, cached per installationId+version. */
export async function getComfyArgsSchema(
  pythonPath: string,
  mainPyPath: string,
  cwd: string,
  installationId: string,
  version?: string
): Promise<ComfyArgsSchema> {
  const cached = schemaCache.get(installationId)
  if (cached && version && cached.version === version) {
    return cached.schema
  }

  const helpText = await runHelp(pythonPath, mainPyPath, cwd)
  const schema = parseHelpOutput(helpText)

  if (version) {
    schemaCache.set(installationId, { schema, version })
  }

  return schema
}

function runHelp(pythonPath: string, mainPyPath: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const mainPyRel = path.relative(cwd, mainPyPath)
    execFile(pythonPath, ['-s', mainPyRel, '--help'], { cwd, timeout: 15000 }, (err, stdout, stderr) => {
      if (stdout && stdout.includes('usage:')) {
        resolve(stdout)
      } else if (stderr && stderr.includes('usage:')) {
        // Some configurations print help to stderr
        resolve(stderr)
      } else if (err) {
        const detail = stderr ? `\nstderr: ${stderr.slice(0, 500)}` : ''
        reject(new Error(`Failed to get ComfyUI --help: ${err.message}${detail}`))
      } else {
        reject(new Error('No help output from ComfyUI'))
      }
    })
  })
}

/** Return the flag names in `userArgs` not recognized by the schema. */
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

/** Return only the args known to ComfyUI, dropping unsupported flags and their values. */
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
      const hasTrailingValue = !hasInlineValue && !isBoolean && i + 1 < userArgs.length && !userArgs[i + 1]!.startsWith('--')
      if (schema.knownFlags.has(name)) {
        result.push(arg)
        if (hasTrailingValue) result.push(userArgs[i + 1]!)
      }
      // Advance past trailing value if present (whether known or skipped)
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

/** Clear the schema cache for an installation (e.g. after version update). */
export function clearSchemaCache(installationId: string): void {
  schemaCache.delete(installationId)
}
