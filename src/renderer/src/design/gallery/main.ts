import '../../assets/main.css'
import { createApp } from 'vue'
import GalleryApp from './GalleryApp.vue'

// Dev-only design gallery for the landing prototype's UI kit. Self-contained:
// delete this folder to remove it. Nothing outside imports from here.
createApp(GalleryApp).mount('#app')
