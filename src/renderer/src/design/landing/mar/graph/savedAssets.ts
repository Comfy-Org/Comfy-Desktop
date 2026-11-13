import { reactive } from 'vue'

/** What Save to Assets added this session, newest first (mock assets). */
export const savedAssets = reactive<{ name: string; src: string }[]>([])
