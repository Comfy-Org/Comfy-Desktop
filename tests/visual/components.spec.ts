import { test, expect, type Page } from '@playwright/test'

async function openScene(page: Page, scene = 'controls') {
  await page.goto(`/?scene=${scene}`)
  await page.evaluate(() => document.fonts.ready)
  await expect(
    page.getByTestId(scene === 'controls' ? 'fixture-ready' : `screen-${scene}`)
  ).toBeVisible()
}

test('input, boolean, environment and disclosure states', async ({ page }) => {
  await openScene(page)
  await expect(page.getByLabel('Readonly path')).toHaveAttribute('readonly', '')
  await expect(page.getByLabel('Restricted setting')).toHaveAttribute('aria-disabled', 'true')
  await expect(page).toHaveScreenshot('controls.png', { fullPage: true })
})

test('edited inputs, duplicate validation and revealed secret', async ({ page }) => {
  await openScene(page)
  await page.getByLabel('Search installations', { exact: true }).fill('Studio')
  await page.getByLabel('Name', { exact: true }).nth(1).fill('API_TOKEN')
  await page.getByRole('heading', { name: 'Environment variables', exact: true }).click()
  await expect(page.getByText('Duplicate key', { exact: true })).toHaveCount(2)
  await page.getByLabel('Reveal value', { exact: true }).first().click()
  await expect(page.getByLabel('Value', { exact: true }).first()).toHaveAttribute('type', 'text')
  await page.getByLabel('Enable previews', { exact: true }).click()
  await expect(page.getByLabel('Enable previews', { exact: true })).toHaveAttribute(
    'aria-checked',
    'false'
  )
  await expect(page).toHaveScreenshot('edited-controls.png', { fullPage: true })
})

test('select popup renders and keyboard selection commits', async ({ page }) => {
  await openScene(page)
  const select = page.getByRole('combobox', { name: 'Release channel', exact: true })
  await select.focus()
  await select.press('ArrowDown')
  await expect(page.getByRole('option', { name: /Nightly/ })).toBeVisible()
  await expect(page).toHaveScreenshot('select-open.png', { fullPage: true })
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Selected: nightly', { exact: true })).toBeVisible()
  await expect(select).toBeFocused()
})

test('menu renders disabled and destructive actions and returns focus', async ({ page }) => {
  await openScene(page)
  const trigger = page.getByRole('button', { name: 'Installation actions', exact: true })
  await trigger.click()
  await expect(page.getByRole('menuitem', { name: 'Update', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await expect(page).toHaveScreenshot('menu-open.png', { fullPage: true })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('tooltip appears for keyboard focus', async ({ page }) => {
  await openScene(page)
  await page.getByRole('button', { name: 'Tooltip trigger', exact: true }).focus()
  await expect(page.getByRole('tooltip')).toContainText('The shared tooltip remains readable')
  await expect(page).toHaveScreenshot('tooltip.png', { fullPage: true })
})

test('dialog dropdown and nested dialog preserve their parent', async ({ page }) => {
  await openScene(page)
  const trigger = page.getByRole('button', { name: 'Open dialog', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Installation options', exact: true })
  await expect(dialog).toBeVisible()
  await page.getByRole('combobox', { name: 'Dialog release channel', exact: true }).click()
  await expect(page.getByRole('option', { name: /Nightly/ })).toBeVisible()
  await expect(page).toHaveScreenshot('dialog-select.png')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: 'Open nested confirmation', exact: true }).click()
  await expect(
    page.getByRole('alertdialog', { name: 'Confirm changes?', exact: true })
  ).toBeVisible()
  await expect(page).toHaveScreenshot('nested-dialog.png')
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('alertdialog', { name: 'Confirm changes?', exact: true })
  ).toHaveCount(0)
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('prompt validation and destructive confirmation', async ({ page }) => {
  await openScene(page)
  await page.getByRole('button', { name: 'Rename installation', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const input = page.getByRole('textbox', { name: 'Installation name', exact: true })
  await input.fill('')
  await input.press('Enter')
  await expect(dialog.getByText('This field is required', { exact: true })).toBeVisible()
  await expect(page).toHaveScreenshot('prompt-invalid.png')
  await input.fill('Studio 2')
  await input.press('Enter')
  await expect(page.getByText('Studio 2', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Delete confirmation', exact: true }).click()
  await expect(
    page.getByRole('alertdialog', { name: 'Delete installation?', exact: true })
  ).toBeVisible()
  await expect(page).toHaveScreenshot('destructive-confirmation.png')
})

test('dashboard layout uses real production view', async ({ page }) => {
  await openScene(page, 'dashboard')
  await expect(page.getByText('Studio', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Experiments with a longer installation name', { exact: true })
  ).toBeVisible()
  await expect(page).toHaveScreenshot('dashboard.png')
})

test('desktop settings layout and dropdown use real production view', async ({ page }) => {
  await openScene(page, 'settings')
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toBeVisible()
  await expect(page).toHaveScreenshot('settings.png')
  await page.getByRole('combobox', { name: 'Language', exact: true }).click()
  await expect(page.getByRole('option', { name: '中文', exact: true })).toBeVisible()
  await expect(page).toHaveScreenshot('settings-language.png')
})

test('action sheet choices commit and restore focus', async ({ page }) => {
  await openScene(page)
  const trigger = page.getByRole('button', { name: 'Choose action', exact: true })
  await trigger.click()
  await expect(page.getByRole('dialog', { name: 'Choose an action', exact: true })).toBeVisible()
  await expect(page).toHaveScreenshot('action-sheet.png')
  await page.getByRole('button', { name: /Copy installation/ }).click()
  await expect(page.getByText('copy', { exact: true })).toBeVisible()
  await expect(trigger).toBeFocused()
})

test('settings remain usable at the compact window width', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 })
  await openScene(page, 'settings')
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toBeVisible()
  await expect(page).toHaveScreenshot('settings-compact.png')
})

test('first-use takeover keeps a coherent full-window layout', async ({ page }) => {
  await openScene(page, 'first-use')
  await expect(page.getByTestId('first-use-pick-local')).toBeVisible()
  await expect(page.getByTestId('first-use-pick-cloud')).toBeVisible()
  await expect(page).toHaveScreenshot('first-use.png')
})

test('first-use consent prevents enabling beta without telemetry by keyboard', async ({ page }) => {
  await openScene(page, 'first-use')
  const telemetry = page.getByRole('checkbox', { name: /Help improve Comfy/ })
  const beta = page.getByRole('checkbox', { name: /Opt in to beta features/ })
  await telemetry.uncheck()
  await expect(beta).not.toBeChecked()
  await expect(beta).toHaveAttribute('aria-readonly', 'true')
  await beta.focus()
  await beta.press('Space')
  await expect(beta).not.toBeChecked()
  await expect(page).toHaveScreenshot('first-use-restricted-beta.png')
})
