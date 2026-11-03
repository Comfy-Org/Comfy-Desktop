import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createAppI18n } from '../../src/renderer/src/lib/i18nFactory'
import { installFixtureBridge } from './fixtureBridge'
import FixtureApp from './FixtureApp.vue'
import './visual.css'

installFixtureBridge()
createApp(FixtureApp).use(createPinia()).use(createAppI18n()).mount('#app')
