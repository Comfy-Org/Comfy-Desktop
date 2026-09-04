import fs from 'fs'
import path from 'path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface ExtraResource {
  from: string
  to: string
}

interface ToDesktopConfig {
  targetOverrides?: {
    linux?: Record<string, { extraResources?: ExtraResource[] }>
  }
}

describe('Linux ARM64 packaging', () => {
  it('keeps the x64 bootstrap out of the ToDesktop ARM64 target', () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'todesktop.json'), 'utf-8')
    ) as ToDesktopConfig
    const linuxTargets = config.targetOverrides?.linux
    const x64Resources = linuxTargets?.x64?.extraResources ?? []
    const arm64Resources = linuxTargets?.arm64?.extraResources ?? []
    const x64Bootstrap = x64Resources.find((resource) => resource.to === 'bootstrap-python')

    expect(x64Bootstrap).toEqual({
      from: './todesktop-targets/linux-x64/bootstrap-python',
      to: 'bootstrap-python'
    })
    expect(path.posix.basename(x64Bootstrap!.from)).toBe(x64Bootstrap!.to)
    expect(arm64Resources.some((resource) => resource.to === 'bootstrap-python')).toBe(false)
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
