# UI rules

Rules the Desktop UI follows on top of `@comfyorg/design-system`. Each rule names the components to use and the tests that pin it.

## Destructive actions

A destructive action deletes files or data that cannot be brought back: Uninstall, Delete snapshot, Delete benchmark files, Delete asset, Delete workflow, Remove Comfy Desktop data.

1. **The control that starts it is red text with its icon.** In a menu: a DS `MenuItem` with `text-destructive` (or `style: 'danger'` in the menu item lists) and its icon, usually `Trash2`. On a page or settings row: the DS `Button` with `variant="destructive-textonly"` and its icon. It is never a filled button.
2. **It always opens a confirm first.** Use the shared confirm box: `useDialogs().confirm({ tone: 'danger' })` in the panel, or `useModal().confirm({ confirmStyle: 'danger' })` where the panel's dialogs are not mounted (title popup, system modal). The message says what goes and, when true, that it cannot be undone.
3. **Only the final action in that confirm is filled red.** It is the DS `Button` `variant="destructive"`, labelled with the action (Uninstall, Delete, Remove and quit). Cancel sits next to it as the neutral `secondary` button.
4. **Nothing destructive runs from a single click.** The one repeat that skips the confirm is Try again after a failed uninstall, because the user already confirmed it.

A confirm for something that is not destructive uses the white primary button (`inverted`), never red and never blue.

Pinned by `BuildMenu.test.ts` (Uninstall), `PerformanceTestView.test.ts` (Delete workflow) and `RemoveAppDataSection.test.ts` (Remove Comfy Desktop data).
