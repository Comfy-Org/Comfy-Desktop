# UI rules

Rules the Desktop UI follows on top of `@comfyorg/design-system`. Each rule names the components to use and the tests that pin it.

## Destructive actions

A destructive action deletes files or data that cannot be brought back: Uninstall, Delete snapshot, Delete benchmark files, Delete asset, Delete workflow, Remove Comfy Desktop data.

1. **The control that starts it is red text with its icon.** In a menu: a DS `MenuItem` with `DESTRUCTIVE_MENU_ITEM_CLASS` from `lib/destructiveStyles.ts` (or `style: 'danger'` in the menu item lists) and its icon, usually `Trash2`. On a page or settings row: the DS `Button` with `variant="destructive-textonly"` and its icon. It is never a filled button, not even on hover.
2. **It always opens a confirm first.** Use the shared confirm box: `useDialogs().confirm({ tone: 'danger' })` in the panel, or `useModal().confirm({ confirmStyle: 'danger' })` where the panel's dialogs are not mounted (title popup, system modal). The message says what goes and, when true, that it cannot be undone.
3. **Only the final action in that confirm is filled red.** It is the DS `Button` `variant="destructive"`, labelled with the action (Uninstall, Delete, Remove and quit). Cancel sits next to it as the neutral `secondary` button.
4. **Nothing destructive runs from a single click.** The one repeat that skips the confirm is Try again after a failed uninstall, because the user already confirmed it.

A confirm for something that is not destructive uses the white primary button (`inverted`), never red and never blue. That is the default: a confirm is only red when it asks for `danger`. Stop, Restart, Quit, Close window, Back to Home, Cancel operation, Quit setup and Discard setup all stop or undo work in progress but delete nothing, so they confirm with the white button and start from plain items.

An error or info notice closes with the white OK. It never takes a tone, because pressing OK changes nothing.

## Decided cases

- **Forget build** takes the build off the list. Its folder stays on the computer and it can be added again with Add existing build. It starts from a plain item and confirms with the white Forget button, and its message says the folder stays and how to add it back.
- **Remove models folder** (Settings > Folders and a build's Storage tab) takes the folder off the list. Its confirm says it won't delete any files. It starts from a plain item and confirms with the white Remove button.
- **Retry** after builds fail to load is plain text, not red.

Pinned by `BuildMenu.test.ts` (Uninstall, Restart, Stop), `PerformanceTestView.test.ts` (Delete workflow), `RemoveAppDataSection.test.ts` (Remove Comfy Desktop data), `DialogHost.test.ts` and `useModal.test.ts` (white by default, white OK on notices), `actionShoppingList.test.ts` and `actions.test.ts` (Forget), and `GlobalSettingsView.test.ts` and `StoragePane.test.ts` (Remove models folder).
