import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './launchApp'

const FEEDBACK_BUTTON = '.title-feedback-button'
const FEEDBACK_FRAME = '[data-testid="feedback-widget"] iframe'
const FEEDBACK_CLOSE = '.feedback-modal-panel [data-testid="base-modal-close"]'
const FEEDBACK_LOADING = '.feedback-modal-loading'
const FORM_ID = 'VhOXmuaL'

let ctx: AppContext

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ctx = await launchApp({ settings: { firstUseCompleted: true, telemetryEnabled: false } })
  await ctx.app.context().route('https://form.typeform.com/**', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html>
<html>
  <body>
    <button id="submit">Submit feedback</button>
    <script>
      const embedId = new URL(location.href).searchParams.get('typeform-embed-id')
      const formId = '${FORM_ID}'
      parent.postMessage({ type: 'form-ready', embedId, formId, isClosed: false }, '*')
      document.querySelector('#submit').addEventListener('click', () => {
        const message = { type: 'form-submit', embedId, formId, responseId: 'feedback-e2e' }
        parent.postMessage(message, '*')
        parent.postMessage(message, '*')
      })
    </script>
  </body>
</html>`
    })
  })
  await ctx.panel.evaluate(`(() => {
    document.body.dataset.feedbackSubmissions = '0'
    window.addEventListener('launcher-telemetry-action', (event) => {
      if (event.detail.actionName === 'comfy.desktop.feedback.submitted') {
        document.body.dataset.feedbackSubmissions = String(Number(document.body.dataset.feedbackSubmissions) + 1)
      }
    })
  })()`)
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

async function openFeedback(): Promise<URL> {
  expect(await ctx.titleBar.click(FEEDBACK_BUTTON)).toBe(true)
  await ctx.panel.waitForVisible(FEEDBACK_FRAME)
  await expect.poll(() => ctx.panel.exists(FEEDBACK_LOADING)).toBe(false)
  return new URL(
    await ctx.panel.evaluate<string>(`document.querySelector('${FEEDBACK_FRAME}').src`)
  )
}

async function submissions(): Promise<number> {
  return ctx.panel.evaluate<number>('Number(document.body.dataset.feedbackSubmissions)')
}

async function inFeedbackFrame(script: string): Promise<void> {
  await ctx.app.evaluate(async ({ webContents }, expression) => {
    const panel = webContents.getAllWebContents().find((wc) => wc.getURL().includes('panel.html'))
    const frame = panel?.mainFrame.frames.find((child) =>
      child.url.startsWith('https://form.typeform.com/')
    )
    if (!frame) throw new Error('Feedback iframe is missing')
    await frame.executeJavaScript(expression)
  }, script)
}

test('feedback opens the SDK form with version and platform metadata and can be dismissed @windows @macos @linux', async () => {
  const url = await openFeedback()
  expect(url.pathname).toBe(`/to/${FORM_ID}`)
  expect(url.searchParams.get('typeform-embed')).toBe('embed-widget')
  expect(url.searchParams.get('typeform-embed-id')).toBeTruthy()
  const hiddenFields = new URLSearchParams(url.hash.slice(1))
  expect(hiddenFields.get('ver')).toBe(await ctx.panel.evaluate('window.api.getAppVersion()'))
  expect(hiddenFields.get('platform')).toBe(
    process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'
  )
  expect(await submissions()).toBe(0)

  expect(await ctx.panel.click(FEEDBACK_CLOSE)).toBe(true)
  await expect.poll(() => ctx.panel.exists(FEEDBACK_FRAME)).toBe(false)
})

test('only a successful SDK submission closes feedback, including after reopening @windows @macos @linux', async () => {
  const firstUrl = await openFeedback()
  await inFeedbackFrame(`parent.postMessage({ type: 'form-submitting', embedId, formId }, '*')`)
  await inFeedbackFrame(
    `parent.postMessage({ type: 'form-submit', embedId: 'another-form', formId }, '*')`
  )
  await ctx.panel.evaluate('new Promise(resolve => setTimeout(resolve, 2200))')
  expect(await submissions()).toBe(0)
  expect(await ctx.panel.isVisible(FEEDBACK_FRAME)).toBe(true)

  await inFeedbackFrame(`document.querySelector('#submit').click()`)
  await expect.poll(submissions).toBe(1)
  await expect.poll(() => ctx.panel.exists(FEEDBACK_FRAME)).toBe(false)

  const secondUrl = await openFeedback()
  const previousEmbedId = firstUrl.searchParams.get('typeform-embed-id')
  expect(secondUrl.searchParams.get('typeform-embed-id')).not.toBe(previousEmbedId)
  await inFeedbackFrame(
    `parent.postMessage({ type: 'form-submit', embedId: ${JSON.stringify(previousEmbedId)}, formId }, '*')`
  )
  await ctx.panel.evaluate('new Promise(resolve => setTimeout(resolve, 2200))')
  expect(await submissions()).toBe(1)
  expect(await ctx.panel.isVisible(FEEDBACK_FRAME)).toBe(true)

  await inFeedbackFrame(`document.querySelector('#submit').click()`)
  await expect.poll(submissions).toBe(2)
  await expect.poll(() => ctx.panel.exists(FEEDBACK_FRAME)).toBe(false)
})
