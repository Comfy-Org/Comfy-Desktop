import '../../../assets/main.css'
import { createApp, h } from 'vue'
import LandingPrototypes from '../LandingPrototypes.vue'

// Browser-only preview of the landing prototypes (mock data, no window.api).
createApp({ render: () => h(LandingPrototypes, { standalone: true }) }).mount('#app')
