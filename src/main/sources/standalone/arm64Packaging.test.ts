import fs from 'fs'
import path from 'path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface ExtraResource {
  from: string
  to: string
}

interface ToDesktopConfig {
  extraResources?: ExtraResource[]
  targetOverrides?: Record<string, Record<string, { extraResources?: ExtraResource[] }>>
  platformOverrides?: Record<string, { extraResources?: ExtraResource[] }>
}

function readToDesktopConfig(): ToDesktopConfig {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'todesktop.json'), 'utf-8')
  ) as ToDesktopConfig
}

const destinations = (resources: ExtraResource[] = []): string[] =>
  resources.map((resource) => resource.to).sort()

describe('Linux ARM64 packaging', () => {
  // A target list replaces, rather than merges with, the platform list, and
  // ToDesktop decides server-side which architectures a platform builds. An
  // architecture we did not enumerate falls back to `platformOverrides`, and
  // without one it lands on the top-level list — `./lib` alone, so the
  // package ships with no apparmor-profile and no bootstrap-python.
  it('keeps a platform-level fallback for every platform with per-target overrides', () => {
    const config = readToDesktopConfig()
    const platforms = Object.keys(config.targetOverrides ?? {})
    expect(platforms.length).toBeGreaterThan(0)

    for (const platform of platforms) {
      const fallback = config.platformOverrides?.[platform]
      expect(fallback, `platformOverrides.${platform} is missing`).toBeDefined()
      for (const [arch, target] of Object.entries(config.targetOverrides![platform]!)) {
        expect(
          destinations(fallback!.extraResources),
          `platformOverrides.${platform} must cover every destination of targetOverrides.${platform}.${arch}`
        ).toEqual(destinations(target.extraResources))
      }
    }
  })

  it('uses matching ToDesktop resource paths with a separate ARM64 placeholder', () => {
    const config = readToDesktopConfig()
    const linuxTargets = config.targetOverrides?.linux
    const x64Resources = linuxTargets?.x64?.extraResources ?? []
    const arm64Resources = linuxTargets?.arm64?.extraResources ?? []
    const x64Bootstrap = x64Resources.find((resource) => resource.to === 'bootstrap-python')
    const arm64Bootstrap = arm64Resources.find((resource) => resource.to === 'bootstrap-python')

    // ToDesktop permits architecture-specific sources, but every target must
    // have the same destinations and source basenames, in the same order.
    const resourcePaths = (resources: ExtraResource[]): string[] =>
      resources.map((resource) => path.posix.join(resource.to, path.posix.basename(resource.from)))
    expect(resourcePaths(arm64Resources)).toEqual(resourcePaths(x64Resources))

    expect(x64Bootstrap).toEqual({
      from: './todesktop-targets/linux-x64/bootstrap-python',
      to: 'bootstrap-python'
    })
    expect(path.posix.basename(x64Bootstrap!.from)).toBe(x64Bootstrap!.to)
    expect(arm64Bootstrap).toEqual({
      from: './todesktop-targets/linux-arm64/bootstrap-python',
      to: 'bootstrap-python'
    })
  })

  it('stages the Linux x64 bootstrap at the target-specific ToDesktop path', () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'build-release.yml'),
      'utf-8'
    )

    expect(workflow).toContain(
      'mv bootstrap-python/linux-x64 todesktop-targets/linux-x64/bootstrap-python'
    )
  })

  it('resolves local electron-builder bootstraps from the target architecture', () => {
    const config = parse(
      fs.readFileSync(path.join(process.cwd(), 'electron-builder.yml'), 'utf-8')
    ) as { linux?: { extraResources?: ExtraResource[] } }
    const bootstrap = config.linux?.extraResources?.find(
      (resource) => resource.to === 'bootstrap-python'
    )

    expect(bootstrap?.from).toBe('bootstrap-python/linux-${arch}')
  })
})
