import { screen } from 'electron'

export interface WorkArea {
  x: number
  y: number
  width: number
  height: number
}

export interface DefaultWindowBounds extends WorkArea {
  maximize: boolean
}

export const SHARE_OF_WORK_AREA = 0.85
export const MIN_DEFAULT_WIDTH = 1024
export const MIN_DEFAULT_HEIGHT = 700
export const MAX_DEFAULT_WIDTH = 2400
export const MAX_DEFAULT_HEIGHT = 1500
export const MAXIMIZE_BELOW_WIDTH = 1600
export const MAXIMIZE_BELOW_HEIGHT = 900
export const MIN_WINDOW_WIDTH = 800
export const MIN_WINDOW_HEIGHT = 600

export interface FittedWindow extends WorkArea {
  minWidth: number
  minHeight: number
}

function fitSide(available: number, min: number, max: number): number {
  const share = Math.round(available * SHARE_OF_WORK_AREA)
  return Math.min(available, Math.max(min, Math.min(max, share)))
}

export function defaultWindowBounds(workArea: WorkArea): DefaultWindowBounds {
  const width = fitSide(workArea.width, MIN_DEFAULT_WIDTH, MAX_DEFAULT_WIDTH)
  const height = fitSide(workArea.height, MIN_DEFAULT_HEIGHT, MAX_DEFAULT_HEIGHT)
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) * 0.45),
    width,
    height,
    maximize: workArea.width < MAXIMIZE_BELOW_WIDTH || workArea.height < MAXIMIZE_BELOW_HEIGHT
  }
}

export function defaultWindowBoundsNear(point: Electron.Point): DefaultWindowBounds {
  return defaultWindowBounds(screen.getDisplayNearestPoint(point).workArea)
}

export function defaultWindowBoundsUnderCursor(): DefaultWindowBounds {
  return defaultWindowBoundsNear(screen.getCursorScreenPoint())
}

export function fitWindowToWorkArea(bounds: WorkArea, workArea: WorkArea): FittedWindow {
  const width = Math.min(bounds.width, workArea.width)
  const height = Math.min(bounds.height, workArea.height)
  return {
    x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height)),
    width,
    height,
    minWidth: Math.min(MIN_WINDOW_WIDTH, workArea.width),
    minHeight: Math.min(MIN_WINDOW_HEIGHT, workArea.height)
  }
}

export function fitWindowToDisplay(bounds: WorkArea): FittedWindow {
  return fitWindowToWorkArea(bounds, screen.getDisplayMatching(bounds).workArea)
}
