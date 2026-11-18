import { describe, it, expect } from 'vitest'
import si from 'systeminformation'

describe('deviceId — systeminformation on Windows', () => {
  it.runIf(process.platform === 'win32')(
    'reads the same hardware UUID through si.uuid() as through si.system(), so the installation id stays stable',
    async () => {
      const [uuid, system] = await Promise.all([si.uuid(), si.system()])

      expect(uuid.hardware, 'si.uuid().hardware came back empty').not.toBe('')
      expect(uuid.hardware).toBe(system.uuid)
    },
    60_000
  )
})
