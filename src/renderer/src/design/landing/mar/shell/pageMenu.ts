import { AppWindow, SquareArrowOutUpRight } from 'lucide-vue-next'
import { toast } from '../../useProto'
import { can } from '../../milestones'
import { openMenuAt } from '../build/buildMenu'
import type { MenuLine } from '../pages/menu'

/**
 * A right-click on a page in the sidebar (Home, Apps, Assets, the Builds
 * title) opens one line at the pointer: Open in new window, on that page
 * (Comfy-Desktop#2177). Desktop has no tabs, so Open in new tab joins it
 * only once builds share one window (One window). Build rows keep the
 * build menu.
 */
export function openPageMenu(e: MouseEvent, label: string): void {
  openMenuAt(e, (): MenuLine[] => [
    ...(can.value.oneWindow
      ? [
          {
            label: 'Open in new tab',
            icon: AppWindow,
            run: () => toast(`Opened ${label} in a new tab`)
          }
        ]
      : []),
    {
      label: 'Open in new window',
      icon: SquareArrowOutUpRight,
      run: () => toast(`Opened ${label} in a new window`)
    }
  ])
}
