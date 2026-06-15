import { copyFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const outDir = 'packages/comfyui-desktop-bridge-types/.generated'
const packageDir = 'packages/comfyui-desktop-bridge-types'
const packageManager = process.env.npm_execpath
const command = packageManager ? process.execPath : 'corepack'
const args = packageManager
  ? [packageManager, 'exec', 'tsc', '-p', 'tsconfig.comfy-desktop-bridge-types.json']
  : ['pnpm', 'exec', 'tsc', '-p', 'tsconfig.comfy-desktop-bridge-types.json']

rmSync(outDir, { recursive: true, force: true })
execFileSync(command, args, { stdio: 'inherit' })
copyFileSync(`${outDir}/comfyDesktopBridge.d.ts`, `${packageDir}/index.d.ts`)
rmSync(outDir, { recursive: true, force: true })
