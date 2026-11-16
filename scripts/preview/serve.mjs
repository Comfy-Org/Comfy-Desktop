import { startPreviewServer } from './server.mjs'

const { url } = await startPreviewServer({
  port: 5199,
  watch: true,
  open: process.argv.includes('--open')
})
console.log(`Comfy Desktop preview: ${url}`)
