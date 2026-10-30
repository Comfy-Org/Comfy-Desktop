import fs from 'fs'
import path from 'path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

// Packaging config lives at the repo root; these tests sit under src/ because
// vitest only collects `src/**/*.test.ts`. They assert the rules ToDesktop and
// electron-builder impose on the resource lists, not the spelling of any one
// path — a release must not break because a path was quoted differently.
interface ExtraResource {
  from: string
  to: string
}

interface ToDesktopConfig {
  extraResources?: ExtraResource[]
  targetOverrides?: Record<string, Record<string, { extraResources?: ExtraResource[] }>>
  platformOverrides?: Record<string, { extraResources?: ExtraResource[] }>
}

const repoRoot = process.cwd()

function readToDesktopConfig(): ToDesktopConfig {
  return JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'todesktop.json'), 'utf-8')
  ) as ToDesktopConfig
}

const destinations = (resources: ExtraResource[] = []): string[] =>
  resources.map((resource) => resource.to).sort()

/** What ToDesktop compares across a platform's targets: the destination and
 *  the basename of the source, in declaration order. */
const resourceShape = (resources: ExtraResource[] = []): string[] =>
  resources.map((resource) => path.posix.join(resource.to, path.posix.basename(resource.from)))

/** Every target directory staged under `todesktop-targets/`, as declared by
 *  the config that packaging reads. */
function stagedTargetDirs(config: ToDesktopConfig): string[] {
  const lists = [
    ...Object.values(config.targetOverrides ?? {}).flatMap((archs) =>
      Object.values(archs).map((target) => target.extraResources)
    ),
    ...Object.values(config.platformOverrides ?? {}).map((p) => p.extraResources),
    config.extraResources
  ]
  const dirs = new Set<string>()
  for (const list of lists) {
    for (const resource of list ?? []) {
      const match = /^\.\/todesktop-targets\/([^/]+)\//.exec(resource.from)
      if (match) dirs.add(match[1]!)
    }
  }
  return [...dirs].sort()
}

describe('ToDesktop resource packaging', () => {
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

  // ToDesktop permits architecture-specific sources, but every target of a
  // platform must declare the same destinations and source basenames in the
  // same order. Checked for every platform, so Windows is covered too.
  it('gives every architecture of a platform the same resource shape', () => {
    const config = readToDesktopConfig()

    for (const [platform, archs] of Object.entries(config.targetOverrides ?? {})) {
      const entries = Object.entries(archs)
      expect(
        entries.length,
        `targetOverrides.${platform} declares no architectures`
      ).toBeGreaterThan(1)
      const [firstArch, firstTarget] = entries[0]!
      for (const [arch, target] of entries.slice(1)) {
        expect(
          resourceShape(target.extraResources),
          `targetOverrides.${platform}.${arch} must match .${firstArch}`
        ).toEqual(resourceShape(firstTarget.extraResources))
      }
      for (const [arch, target] of entries) {
        for (const resource of target.extraResources ?? []) {
          expect(
            path.posix.basename(resource.from),
            `targetOverrides.${platform}.${arch} source basename must equal its destination`
          ).toBe(resource.to)
        }
      }
    }
  })

  // Staging directories are named after the target they serve, so a target
  // reaching into another one is how an architecture ends up shipping a
  // foreign interpreter — the ARM64 bug this branch fixes for Linux, and the
  // Windows one #1484 fixed. The shape rule above cannot see it: every
  // source basename is `bootstrap-python` either way.
  it('sources each target from the staging directory named after it', () => {
    const config = readToDesktopConfig()
    let checked = 0

    for (const [platform, archs] of Object.entries(config.targetOverrides ?? {})) {
      for (const [arch, target] of Object.entries(archs)) {
        for (const resource of target.extraResources ?? []) {
          const match = /^\.\/todesktop-targets\/([^/]+)\//.exec(resource.from)
          if (!match) continue
          checked++
          expect(match[1], `targetOverrides.${platform}.${arch} stages from ${match[1]}`).toBe(
            `${platform}-${arch}`
          )
        }
      }
    }

    expect(checked, 'no targets source from todesktop-targets/').toBeGreaterThan(0)
  })

  // The release workflow stages these directories before `todesktop build`;
  // a target declared here but never staged uploads an empty resource.
  it('stages every declared target directory in the release workflow', () => {
    const config = readToDesktopConfig()
    const workflow = parse(
      fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'build-release.yml'), 'utf-8')
    ) as { jobs: Record<string, { steps?: { name?: string; run?: string }[] }> }

    const steps = Object.values(workflow.jobs).flatMap((job) => job.steps ?? [])
    const staging = steps.find((step) => step.name?.includes('Stage bootstrap-python'))
    expect(staging?.run, 'no bootstrap-python staging step in build-release.yml').toBeTruthy()

    const targets = stagedTargetDirs(config)
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      expect(staging!.run, `staging step never mentions ${target}`).toContain(target)
    }
  })
})

describe('electron-builder resource packaging', () => {
  // Local Linux builds must resolve the bootstrap for the architecture being
  // packaged; a hardcoded directory puts an x64 interpreter in an ARM64 app.
  it('resolves the Linux bootstrap from the target architecture', () => {
    const config = parse(fs.readFileSync(path.join(repoRoot, 'electron-builder.yml'), 'utf-8')) as {
      linux?: { extraResources?: ExtraResource[] }
    }
    const bootstrap = config.linux?.extraResources?.find(
      (resource) => resource.to === 'bootstrap-python'
    )

    expect(bootstrap?.from).toContain('${arch}')
    expect(bootstrap?.from).not.toContain('linux-x64')
  })
})
