export { TID } from '../../src/shared/testIds'
export type { TestIdKey } from '../../src/shared/testIds'

export function byTestId(id: string): string {
  return `[data-testid="${id}"]`
}
