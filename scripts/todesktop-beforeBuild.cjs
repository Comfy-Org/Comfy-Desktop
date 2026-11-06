// Keys are todesktop's normalized `${platform}-${arch}` strings (matches
// electron-builder's Platform enum: windows / mac / linux), NOT Node's
// process.platform values (win32 / darwin / linux). Until this was fixed,
// every Windows and Mac build silently hit the "skipping" branch below —
// the fetch on todesktop's server never ran, which is why 0.6.4 (and every
// earlier release with this hook) shipped without bootstrap-python.
const PLATFORM_MAP = {
  'windows-x64': 'win-x64',
  // Native Windows on Arm build (NVIDIA RTX Spark). Until bootstrap-v3 this
  // shipped the x64 bootstrap under Prism emulation; the native ARM64
  // python.exe runs git operations without the emulation layer.
  'windows-arm64': 'win-arm64',
  'mac-arm64': 'mac-arm64',
  'linux-x64': 'linux-x64',
}

// Each platform's expected Python binary inside its bootstrap-python dir.
// Mirrors PYTHON_BINARY in fetch-bootstrap-python.mjs and the runtime check
// in src/main/lib/git.ts:tryConfigureBootstrapPygit2. Kept here so a fetch
// script that returns 0 but produces a directory without the binary still
// fails the build instead of silently shipping a broken installer.
// Forward slashes are fine on every platform — these strings are passed to
// path.join() below, which normalizes separators per-OS.
const PYTHON_BINARY = {
  'win-x64': 'python.exe',
  'win-arm64': 'python.exe',
  'mac-arm64': 'bin/python3',
  'linux-x64': 'bin/python3',
}

// Mirrors UV_BINARY in fetch-bootstrap-python.mjs and uvDestRel in
// build-bootstrap-python.mjs. Verified here too so that a fetch returning
// success without uv (e.g. accidentally re-tagging a pre-v2 archive at the
// current default tag) fails the build instead of shipping a launcher whose
// adopted-install flows have no usable package manager.
const UV_BINARY = {
  'win-x64': 'uv.exe',
  'win-arm64': 'uv.exe',
  'mac-arm64': 'bin/uv',
  'linux-x64': 'bin/uv',
}

module.exports = async ({ appDir, platform, arch }) => {
  const { execSync } = await import('node:child_process')
  const fs = await import('node:fs')
  const path = await import('node:path')

  // The `from` path todesktop will actually copy this target's bootstrap-python
  // from, read out of the same config that packaging uses. Resolution order
  // matches todesktop's own: per-target, then per-platform, then the base list.
  // Deriving it here is what keeps the verification below pointed at the tree
  // that ships — hardcoding a path let #1484 move Windows to
  // `todesktop-targets/` while this hook went on verifying the old location.
  function resolveBootstrapFrom() {
    const config = JSON.parse(fs.readFileSync(path.join(appDir, 'todesktop.json'), 'utf-8'))
    const candidates = [
      config.targetOverrides?.[platform]?.[arch]?.extraResources,
      config.platformOverrides?.[platform]?.extraResources,
      config.extraResources,
    ]
    for (const list of candidates) {
      const entry = list?.find((resource) => resource.to === 'bootstrap-python')
      if (entry) return entry.from
    }
    return null
  }

  function moveInto(source, dest) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    try {
      fs.renameSync(source, dest)
    } catch (err) {
      // Cross-device rename fails on todesktop's builders when tmp and the
      // build tree are on different mounts.
      if (err.code !== 'EXDEV') throw err
      fs.cpSync(source, dest, { recursive: true })
      fs.rmSync(source, { recursive: true, force: true })
    }
  }

  const key = `${platform}-${arch}`
  const bootstrapPlatform = PLATFORM_MAP[key]
  if (!bootstrapPlatform) {
    console.log(`[todesktop:beforeBuild] No bootstrap python for ${key}, skipping`)
    return
  }

  const from = resolveBootstrapFrom()
  if (!from) {
    throw new Error(
      `[todesktop:beforeBuild] todesktop.json declares no bootstrap-python resource for ${key}. ` +
      `Refusing to build — the installer would ship without a git backend.`
    )
  }

  // todesktop layout:
  //   <workingDir>/app-wrapper/app/         <- this is `appDir` (electron-builder appDirectory)
  //   <workingDir>/app-wrapper/extraResources/  <- where extraResources.from is staged from
  // extraResources.from in todesktop.json resolves against `app-wrapper/extraResources/`,
  // NOT against the project root. The v0.6.6 mac build log proved this: the hook
  // verified the binary inside `app-wrapper/app/extraResources/...` (correct relative
  // to `appDir`) but electron-builder still warned `file source doesn't exist
  // from=app-wrapper/extraResources/...` — and the dmg shipped without bootstrap-python.
  // Going up one level from `appDir` puts the archive where todesktop actually reads it.
  const destDir = path.join(appDir, '..', 'extraResources', from)

  // CI stages and uploads these directories, so the usual case is "already
  // here" and the fetch is a repair path for an upload that arrived short.
  if (fs.existsSync(destDir)) {
    console.log(`[todesktop:beforeBuild] Found staged bootstrap python at ${destDir}`)
  } else {
    console.log(`[todesktop:beforeBuild] Fetching bootstrap python for ${bootstrapPlatform}`)
    const script = path.join(appDir, 'scripts', 'fetch-bootstrap-python.mjs')
    // The fetch script writes <output-dir>/<platform>, but the shipped path is
    // named by todesktop.json, so fetch into a scratch dir and move it over.
    const scratch = path.join(appDir, '..', 'extraResources', '.bootstrap-fetch')
    // fetch-bootstrap-python.mjs now exits non-zero on failure, which bubbles
    // up here via execSync. Don't wrap in try/catch — a failed fetch must fail
    // the build (see 0.6.4 post-mortem: a swallowed fetch error shipped an
    // installer with no bootstrap-python, stranding new installs).
    execSync(
      `node "${script}" --platform ${bootstrapPlatform} --output-dir "${scratch}"`,
      { stdio: 'inherit', cwd: appDir }
    )
    moveInto(path.join(scratch, bootstrapPlatform), destDir)
    fs.rmSync(scratch, { recursive: true, force: true })
  }

  // Defense-in-depth: whether the directory was staged by CI or fetched just
  // now, verify the expected binaries before handing control back to
  // todesktop. This is the check that has to sit on the shipped path — an
  // upload that dropped the tree, or a fetch whose success criteria drifted
  // from what the app looks for at runtime, both look fine without it.
  const expectedPython = path.join(destDir, PYTHON_BINARY[bootstrapPlatform])
  if (!fs.existsSync(expectedPython)) {
    throw new Error(
      `[todesktop:beforeBuild] ${expectedPython} is missing. Refusing to build — the ` +
      `installer would not provide a git backend and "Latest Stable" installs would ` +
      `silently strand on the bundled ComfyUI version.`
    )
  }
  const expectedUv = path.join(destDir, UV_BINARY[bootstrapPlatform])
  if (!fs.existsSync(expectedUv)) {
    throw new Error(
      `[todesktop:beforeBuild] ${expectedUv} is missing. Refusing to build — the bootstrap ` +
      `tree predates bootstrap-v2 (no bundled uv), or the upload arrived incomplete. Bump ` +
      `the default tag in fetch-bootstrap-python.mjs or publish the v2 archives.`
    )
  }
  console.log(`[todesktop:beforeBuild] Verified ${expectedPython} and ${expectedUv}`)
}
