import { createApp, type App } from 'vue'
import SystemModalApp from './SystemModalApp.vue'
import { createAppI18n } from '../lib/i18nFactory'
import { systemModalBridge } from './systemModalBridge'

export function createSystemModalApp(): App {
  const app = createApp(SystemModalApp).use(createAppI18n())
  app.config.errorHandler = (error) => {
    console.error(error)
    systemModalBridge()?.notifyRenderFailed()
  }
  return app
}
