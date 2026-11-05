const PLATFORM_MAP = {
  'windows-x64': 'win-x64',
  'windows-arm64': 'win-arm64',
  'mac-arm64': 'mac-arm64',
  'linux-x64': 'linux-x64'
}

const PYTHON_BINARY = {
  'win-x64': 'python.exe',
  'win-arm64': 'python.exe',
  'mac-arm64': 'bin/python3',
  'linux-x64': 'bin/python3'
}

const UV_BINARY = {
  'win-x64': 'uv.exe',
  'win-arm64': 'uv.exe',
  'mac-arm64': 'bin/uv',
  'linux-x64': 'bin/uv'
}

module.exports = async ({ appDir, platform, arch }) => {
  const { execSync } = await import('node:child_process')
  const fs = await import('node:fs')
  const path = await import('node:path')

  const key = `${platform}-${arch}`
  const bootstrapPlatform = PLATFORM_MAP[key]
  if (!bootstrapPlatform) {
    console.log(`[todesktop:beforeBuild] No bootstrap python for ${key}, skipping`)
    return
  }

  console.log(`[todesktop:beforeBuild] Fetching bootstrap python for ${bootstrapPlatform}`)
  const script = path.join(appDir, 'scripts', 'fetch-bootstrap-python.mjs')
  const outDir = path.join(appDir, '..', 'extraResources', 'bootstrap-python')
  execSync(`node "${script}" --platform ${bootstrapPlatform} --output-dir "${outDir}"`, {
    stdio: 'inherit',
    cwd: appDir
  })

  const expectedPython = path.join(outDir, bootstrapPlatform, PYTHON_BINARY[bootstrapPlatform])
  if (!fs.existsSync(expectedPython)) {
    throw new Error(
      `[todesktop:beforeBuild] fetch script returned success but ${expectedPython} is missing. ` +
        `Refusing to build — the installer would not provide a git backend and "Latest Stable" ` +
        `installs would silently strand on the bundled ComfyUI version.`
    )
  }
  const expectedUv = path.join(outDir, bootstrapPlatform, UV_BINARY[bootstrapPlatform])
  if (!fs.existsSync(expectedUv)) {
    throw new Error(
      `[todesktop:beforeBuild] fetch script returned success but ${expectedUv} is missing. ` +
        `Refusing to build — the bootstrap archive predates bootstrap-v2 (no bundled uv). ` +
        `Bump the default tag in fetch-bootstrap-python.mjs or publish the v2 archives.`
    )
  }
  console.log(`[todesktop:beforeBuild] Verified ${expectedPython} and ${expectedUv}`)
}
