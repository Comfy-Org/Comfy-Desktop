import '../../../../assets/main.css'
import './kit/ds.css'
import { createApp, type Component } from 'vue'

/**
 * Four kinds of document share this entry, picked by `?frame=`:
 *   (none)  the page itself: nav, About, and the theme frames
 *   page    one component page in one theme (an iframe per theme)
 *   stage   one component opened (a menu, a tooltip), inside a page
 *   app     the whole prototype on one page, state or knob (kit/AppShot.vue)
 *   play    one component with props from the Playground (kit/PlayFrame.vue)
 *
 * `?playground` (or a path ending in /playground) is the Theme playground,
 * full screen (studio/ThemeStudio.vue): `app` frames with `?pg`, which
 * apply its tokens (theme/apply.ts) in that frame and the frames it holds.
 *
 * `?seed={"key":"value"}` starts a frame with those prototype settings
 * (the in-memory storage, main.ts), so it can show any knob's value.
 *
 * Mar's styles hang off <html> (`data-ds-theme`, `data-mar-ui`…), so a
 * theme can't be scoped to a pane: each theme renders in its own frame.
 */
const url = new URLSearchParams(location.search)
const frame = url.get('frame')

async function boot(): Promise<void> {
  let root: Component
  if (frame === 'page' || frame === 'stage' || frame === 'app' || frame === 'play') {
    for (const [k, v] of Object.entries(JSON.parse(url.get('seed') ?? '{}')))
      localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
    const theme = url.get('theme') === 'light' ? 'light' : 'dark'
    const html = document.documentElement
    html.dataset.dsDirection = 'original'
    html.dataset.dsTheme = theme
    html.classList.add('ds-frame')
    if (frame === 'app') html.classList.add('ds-app-frame')
    if (frame === 'play') html.classList.add('ds-play-frame')
    // The same modules the prototype loads for Mar's proposal, so every
    // knob sets its <html> attribute and stylesheet at its default.
    await import('./defaults')
    const { installForcedStates } = await import('./kit/force')
    installForcedStates()
    const { installPlayback } = await import('./kit/playback')
    installPlayback()
    if (url.has('pg')) (await import('./theme/apply')).applyPlaygroundCss(theme)
    root =
      frame === 'page'
        ? (await import('./kit/PageFrame.vue')).default
        : frame === 'stage'
          ? (await import('./kit/StageFrame.vue')).default
          : frame === 'play'
            ? (await import('./kit/PlayFrame.vue')).default
            : (await import('./kit/AppFrame.vue')).default
  } else if (url.has('playground') || /\/playground\/?$/.test(location.pathname)) {
    root = (await import('./studio/ThemeStudio.vue')).default
  } else {
    // The site's own tabs and theme switch slide like the app's.
    await import('../motion/tabSlide')
    await import('../motion/motion.css')
    root = (await import('./DsApp.vue')).default
  }
  createApp(root).mount('#app')
}

void boot()
