import { constants } from 'node:os'
import path from 'node:path'
import { getSystemErrorName } from 'node:util'

type Rename = (source: string, destination: string) => Promise<void>

const WINDOWS_ERRORS = new Map([
  [1, 'ENOTSUP'],
  [2, 'ENOENT'],
  [3, 'ENOENT'],
  [5, 'EACCES'],
  [17, 'EXDEV'],
  [19, 'EROFS'],
  [21, 'EIO'],
  [23, 'EIO'],
  [29, 'EIO'],
  [30, 'EIO'],
  [32, 'EBUSY'],
  [39, 'ENOSPC'],
  [50, 'ENOTSUP'],
  [80, 'EEXIST'],
  [112, 'ENOSPC'],
  [123, 'EINVAL'],
  [183, 'EEXIST'],
  [206, 'ENAMETOOLONG'],
  [267, 'ENOTDIR'],
  [1314, 'EPERM']
])

function renameError(code: string, status: number): NodeJS.ErrnoException {
  return Object.assign(new Error(`Exclusive rename failed: ${code} (system error ${status})`), {
    code,
    errno: status
  })
}

async function loadRename(): Promise<Rename> {
  try {
    const { default: koffi } = await import('koffi')
    if (process.platform === 'win32') {
      const kernel = koffi.load('kernel32.dll')
      const move = kernel.func('int32_t __stdcall MoveFileExW(str16, str16, uint32_t)')
      const lastError = kernel.func('uint32_t __stdcall GetLastError()')
      return (source, destination) =>
        new Promise((resolve, reject) => {
          move.async(
            path.toNamespacedPath(source),
            path.toNamespacedPath(destination),
            0,
            (err: unknown, moved: number) => {
              if (err) reject(err)
              else if (moved) resolve()
              else {
                const status = lastError() as number
                reject(renameError(WINDOWS_ERRORS.get(status) ?? 'EIO', status))
              }
            }
          )
        })
    }

    const libc = koffi.load(null)
    let move: ReturnType<typeof libc.func>
    let args: (source: string, destination: string) => (number | string)[]
    if (process.platform === 'linux') {
      const AT_FDCWD = -100
      const RENAME_NOREPLACE = 1
      move = libc.func('int renameat2(int, str, int, str, uint32_t)')
      args = (source, destination) => [AT_FDCWD, source, AT_FDCWD, destination, RENAME_NOREPLACE]
    } else if (process.platform === 'darwin') {
      const RENAME_EXCL = 4
      move = libc.func('int renamex_np(str, str, uint32_t)')
      args = (source, destination) => [source, destination, RENAME_EXCL]
    } else {
      throw new Error(`Unsupported platform ${process.platform}`)
    }

    return (source, destination) =>
      new Promise((resolve, reject) => {
        move.async(...args(source, destination), (err: unknown, result: number) => {
          if (err) reject(err)
          else if (result === 0) resolve()
          else {
            const status = koffi.errno()
            const unsupported =
              status === constants.errno.ENOTSUP ||
              status === constants.errno.EOPNOTSUPP ||
              status === constants.errno.ENOSYS
            reject(
              renameError(
                unsupported ? 'ENOTSUP' : status ? getSystemErrorName(-status) : 'EIO',
                status
              )
            )
          }
        })
      })
  } catch (cause) {
    throw Object.assign(new Error('Native exclusive rename is unavailable', { cause }), {
      code: 'ENOSYS'
    })
  }
}

let nativeRename: Promise<Rename> | undefined

export async function renameNoReplace(source: string, destination: string): Promise<void> {
  const rename = await (nativeRename ??= loadRename())
  await rename(source, destination)
}
