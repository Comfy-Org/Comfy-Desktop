import { reactive, watch } from 'vue'

export type AssetFolderLayout = 'off' | 'tree'

export const ASSET_FOLDER_LAYOUTS: { value: AssetFolderLayout; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'tree', label: 'Tree' }
]

const KEY = 'comfy.design.mar.assetFolderLayout'
const RAIL_KEY = 'comfy.design.mar.assetFolderLayout.railBefore'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    return
  }
}

export const assetFolderLayout = reactive<{ id: AssetFolderLayout }>({
  id: read(KEY) === 'tree' ? 'tree' : 'off'
})

watch(
  () => assetFolderLayout.id,
  (id) => write(KEY, id)
)

export const railBeforeTree = {
  get: (): boolean | null => {
    const v = read(RAIL_KEY)
    return v === null ? null : v === 'rail'
  },
  set: (rail: boolean | null): void =>
    write(RAIL_KEY, rail === null ? null : rail ? 'rail' : 'open')
}
