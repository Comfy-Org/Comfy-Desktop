import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as tar from 'tar'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const outputBase = path.join(projectRoot, 'bootstrap-python')

const PLATFORMS = ['win-x64', 'win-arm64', 'mac-arm64', 'linux-x64']
const DEFAULT_TAG = 'bootstrap-v3'
const REPO = 'Comfy-Org/Comfy-Desktop'

const PYTHON_BINARY = {
  'win-x64': 'python.exe',
  'win-arm64': 'python.exe',
  'mac-arm64': path.join('bin', 'python3'),
  'linux-x64': path.join('bin', 'python3')
}

const UV_BINARY = {
  'win-x64': 'uv.exe',
  'win-arm64': 'uv.exe',
  'mac-arm64': path.join('bin', 'uv'),
  'linux-x64': path.join('bin', 'uv')
}

function parseArgs() {
  const args = process.argv.slice(2)
  let tag = DEFAULT_TAG
  let platform = null
  let outputDir = null
  let softFail = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--tag' && args[i + 1]) {
      tag = args[++i]
    } else if (args[i] === '--platform' && args[i + 1]) {
      platform = args[++i]
    } else if (args[i] === '--output-dir' && args[i + 1]) {
      outputDir = args[++i]
    } else if (args[i] === '--soft-fail') {
      softFail = true
    }
  }
  return { tag, platform, outputDir, softFail }
}

function assetUrl(tag, platform) {
  return `https://github.com/${REPO}/releases/download/${tag}/bootstrap-python-${platform}.tar.gz`
}

async function downloadAndExtract(url, destDir) {
  const response = await fetch(url, { headers: { Accept: 'application/octet-stream' } })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText} (${url})`)
  }

  fs.mkdirSync(path.dirname(destDir), { recursive: true })
  const tmpFile = `${destDir}.tar.gz`
  try {
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tmpFile))
    await tar.x({ file: tmpFile, cwd: path.dirname(destDir) })
  } finally {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile)
  }
}

function verifyPlatform(outBase, platform) {
  const destDir = path.join(outBase, platform)
  const pythonRel = PYTHON_BINARY[platform]
  const uvRel = UV_BINARY[platform]
  if (!pythonRel || !uvRel) {
    throw new Error(`Unknown platform ${platform}: no binary paths configured`)
  }
  const pythonPath = path.join(destDir, pythonRel)
  if (!fs.existsSync(pythonPath)) {
    throw new Error(
      `Expected ${pythonPath} after fetch, but it does not exist. The archive may have been partial, ` +
        `extraction may have failed, or the directory was empty before the fetch ran. This installer ` +
        `would ship without bootstrap pygit2 — refusing to continue.`
    )
  }
  const uvPath = path.join(destDir, uvRel)
  if (!fs.existsSync(uvPath)) {
    throw new Error(
      `Expected ${uvPath} after fetch, but it does not exist. The bootstrap archive predates ` +
        `bootstrap-v2 (uv was not bundled), or extraction was partial. Bump --tag or rebuild the ` +
        `archive with the current build-bootstrap-python.mjs.`
    )
  }
}

async function main() {
  const { tag, platform: onlyPlatform, outputDir, softFail } = parseArgs()
  const platforms = onlyPlatform ? [onlyPlatform] : PLATFORMS
  const outBase = outputDir || outputBase
  console.log(`Fetching bootstrap-python archives from release ${tag}`)
  if (softFail) console.log('  --soft-fail: failures will be logged but not exit non-zero')

  const failures = []
  const recordFailure = (platform, err) => {
    failures.push({ platform, message: err instanceof Error ? err.message : String(err) })
    console.error(`  ${platform}: FAILED — ${err instanceof Error ? err.message : err}`)
  }

  for (const platform of platforms) {
    const destDir = path.join(outBase, platform)

    if (fs.existsSync(destDir)) {
      try {
        verifyPlatform(outBase, platform)
        console.log(`  ${platform}: already exists and verified, skipping`)
        continue
      } catch (err) {
        recordFailure(platform, err)
        continue
      }
    }

    const url = assetUrl(tag, platform)
    console.log(`  ${platform}: downloading ${url}`)
    try {
      await downloadAndExtract(url, destDir)
      verifyPlatform(outBase, platform)
      console.log(`  ${platform}: OK`)
    } catch (err) {
      recordFailure(platform, err)
    }
  }

  exitWithFailures(failures, softFail)
}

function exitWithFailures(failures, softFail) {
  if (failures.length === 0) {
    console.log('Done.')
    return
  }
  console.error('')
  console.error(`bootstrap-python fetch finished with ${failures.length} failure(s):`)
  for (const { platform, message } of failures) {
    console.error(`  - ${platform}: ${message}`)
  }
  if (softFail) {
    console.error(
      '--soft-fail was set: exiting 0 despite failures. Do not use this flag in production builds.'
    )
    return
  }
  console.error('')
  console.error(
    'Refusing to continue. A build that proceeds without bootstrap-python ships an installer that ' +
      'cannot resolve "Latest Stable" on first launch (no git backend), and new installs are stranded ' +
      'on the bundled ComfyUI version with the UI claiming "Already up to date". Fix the fetch (token / ' +
      'network / asset name) or rerun with --soft-fail for local dev only.'
  )
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
