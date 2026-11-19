import { vi } from 'vitest'
import type { ElectronApi } from '../types/ipc'

type AnyFunction = (...args: never[]) => unknown
type FunctionStub = AnyFunction | ReturnType<typeof vi.fn>

type ApiStub<T> = {
  [K in keyof T]?: T[K] extends AnyFunction
    ? FunctionStub
    : T[K] extends object
      ? ApiStub<T[K]>
      : T[K]
}

export function stubWindowApi(api: ApiStub<ElectronApi>): void {
  vi.stubGlobal('api', api)
}
