import { reactive } from 'vue'

/** Whether Mar's global search (MarSearch.vue) is open. ⌘K toggles it. */
export const search = reactive({ open: false })
