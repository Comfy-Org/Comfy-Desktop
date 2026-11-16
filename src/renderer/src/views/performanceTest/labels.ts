import type { DurationKey, SystemFactKey } from '../../lib/performanceTestResults'

type Translate = (key: string) => string

export function durationLabels(t: Translate): Record<DurationKey, string> {
  return {
    fastest: t('performanceTest.fastestRun'),
    median: t('performanceTest.medianRunDuration'),
    average: t('performanceTest.averageRunDuration'),
    slowest: t('performanceTest.slowestRun')
  }
}

export function systemFactLabels(t: Translate): Record<SystemFactKey, string> {
  return {
    device: t('performanceTest.device'),
    vram: t('performanceTest.vram'),
    ram: t('performanceTest.ram'),
    pytorchVersion: t('performanceTest.pytorchVersion'),
    xformersVersion: t('performanceTest.xformersVersion'),
    cpu: t('performanceTest.cpu'),
    cpuCores: t('performanceTest.cpuCores'),
    operatingSystem: t('performanceTest.operatingSystem'),
    architecture: t('performanceTest.architecture')
  }
}
