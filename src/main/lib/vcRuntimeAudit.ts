import fs from 'fs'
import path from 'path'

const REQUIRED_VC_DLLS: string[] = ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']

export async function auditVcRuntime(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  const system32 = path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32')
  const results = await Promise.all(
    REQUIRED_VC_DLLS.map(async (dll) => {
      try {
        await fs.promises.access(path.join(system32, dll), fs.constants.F_OK)
        return null
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'ENOENT' ? dll : null
      }
    })
  )
  return results.filter((dll): dll is string => dll !== null)
}
