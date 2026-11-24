export const RHYTHM_GRID_CLASS =
  'm-0 grid list-none grid-cols-2 gap-3.5 p-0 @3xl:grid-cols-6 @5xl:grid-cols-12'

export function rhythmSpanClass(index: number): string {
  const medium = index % 5 < 2 ? '@3xl:col-span-3' : '@3xl:col-span-2'
  const wide = index % 7 < 3 ? '@5xl:col-span-4' : '@5xl:col-span-3'
  return `${medium} ${wide}`
}
