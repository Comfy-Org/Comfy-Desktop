import { app, Menu } from 'electron'
import type { BaseWindow, MenuItemConstructorOptions } from 'electron'

export type AppMenuDevOverrides = {
  toggleEmbeddedDevTools?: (focusedWindow?: BaseWindow | null) => void
}

export type AppMenuHandlers = {
  onCheckForUpdates?: () => void
}

export function installAppMenu(
  platform: NodeJS.Platform = process.platform,
  devOverrides?: AppMenuDevOverrides,
  handlers?: AppMenuHandlers
): void {
  const routedDevTools =
    typeof devOverrides?.toggleEmbeddedDevTools === 'function'
      ? devOverrides.toggleEmbeddedDevTools
      : undefined

  if (platform !== 'darwin') {
    const viewSubmenu: MenuItemConstructorOptions[] = [{ role: 'togglefullscreen' }]
    if (routedDevTools) {
      viewSubmenu.push(
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Control+Shift+I',
          click: (_menuItem, bw) => {
            routedDevTools(bw)
          }
        }
      )
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'View', submenu: viewSubmenu }]))
    return
  }
  const onCheckForUpdates =
    typeof handlers?.onCheckForUpdates === 'function' ? handlers.onCheckForUpdates : undefined

  const appMenu: MenuItemConstructorOptions = onCheckForUpdates
    ? {
        label: app.name,
        submenu: [
          { role: 'about' },
          {
            label: 'Check for Updates…',
            click: () => {
              onCheckForUpdates()
            }
          },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      }
    : { role: 'appMenu' }

  const template: MenuItemConstructorOptions[] = [
    appMenu,
    { role: 'editMenu' },
    ...(routedDevTools
      ? ([
          {
            label: 'View',
            submenu: [
              { role: 'reload' },
              { role: 'forceReload' },
              {
                label: 'Toggle Developer Tools',
                accelerator: 'Alt+Command+I',
                click: (_menuItem, bw) => {
                  routedDevTools(bw)
                }
              }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
