<script setup lang="ts">
import { computed } from 'vue'
import {
  Bell,
  Check,
  Download,
  ListFilter,
  MoreHorizontal,
  Pencil,
  Trash2,
  Video,
  Workflow,
  X
} from 'lucide-vue-next'
import portraitSun from '../../assets/portrait-sun.jpg'
import hillsFog from '../../assets/hills-fog.jpg'
import Button from '../../../ui/Button.vue'
import { ComfyWorkflow } from '../../icons/comfyIcons'
import MarEmpty from '../../pages/MarEmpty.vue'
import { EMPTY_PICS } from '../../pages/emptyArt'
import MarItem from '../../pages/MarItem.vue'
import MarSeg from '../../pages/MarSeg.vue'
import MarStatus from '../../pages/MarStatus.vue'
import MarTitleTabs from '../../shell/MarTitleTabs.vue'
import type { TitleBarState } from '../../../titleBarBridge'
import { CONTENT } from '../content'
// The type tabs' counts and the media badge are styled by the Assets page.
import '../../pages/MarAssetsPage.vue'

/**
 * A page's Do / Don't pairs, side by side, each with one line. Every
 * picture is the real component; the Don't is it used the wrong way.
 */
const { page } = defineProps<{ page: string }>()

const pairs = computed(() => CONTENT[page]?.pairs ?? [])
const TABS = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'shared', label: 'Shared' }
]
// Assets' type tabs, with and without their counts.
const KINDS = [
  { value: 'all', label: 'All', count: 29 },
  { value: 'image', label: 'Images', count: 11 },
  { value: 'video', label: 'Videos', count: 10 },
  { value: '3d', label: '3D', count: 1 }
]
const PLACES = ['All places', 'This computer', 'Comfy Cloud']
/** The tabs title bar (shell/MarTitleTabs.vue): a workflow's tab, named
 *  after the workflow or, wrongly, after its build. */
const bar = (name: string): TitleBarState => ({
  milestone: 10,
  home: false,
  menuOpen: false,
  front: null,
  builds: [],
  options: [],
  runsOn: { name: 'My Local 1', kind: 'local' },
  tabs: [{ id: 'w', name, build: 'My Local 1', kind: 'local' }],
  tabFront: 'w'
})
</script>

<template>
  <div class="ds-dd">
    <template v-for="p in pairs" :key="p.id">
      <figure
        v-for="side in ['do', 'dont'] as const"
        :key="side"
        :class="['ds-dd-cell', `is-${side}`]"
      >
        <div class="ds-dd-pic proto-main">
          <!-- Pairs drawn by their own id (a page with several pairs). -->
          <div v-if="p.id === 'ask'" class="ds-dd-col">
            <div v-if="side === 'do'" role="menu" class="ds-dd-menu">
              <div class="mar-menu-ask">
                <p class="mar-menu-ask-text">Remove “portrait” from 4 assets?</p>
                <span class="mar-menu-ask-actions">
                  <button type="button" class="mar-menu-ask-btn">Cancel</button>
                  <button type="button" class="mar-menu-ask-btn is-danger">Delete tag</button>
                </span>
              </div>
            </div>
            <div v-else class="ds-dd-box">
              <p>Remove “portrait” from 4 assets?</p>
              <div class="ds-dd-row">
                <Button variant="ghost">Cancel</Button>
                <Button variant="destructive">Delete tag</Button>
              </div>
            </div>
          </div>
          <div v-else-if="p.id === 'red'" role="menu" class="ds-dd-menu">
            <div role="menuitem" class="ds-dd-mi"><Pencil :size="15" />Rename tag</div>
            <div v-if="side === 'dont'" role="menuitem" class="ds-dd-mi mar-menu-danger">
              <Trash2 :size="15" />Delete tag
            </div>
            <div role="menuitem" class="ds-dd-mi"><Download :size="15" />Download</div>
            <template v-if="side === 'do'">
              <div role="separator" class="mar-menu-sep -mx-1.5 my-1.5 h-px bg-border-default" />
              <div role="menuitem" class="ds-dd-mi mar-menu-danger">
                <Trash2 :size="15" />Delete tag
              </div>
            </template>
          </div>
          <div v-else-if="p.id === 'pick'" role="menu" class="ds-dd-menu">
            <div
              v-for="(o, i) in PLACES"
              :key="o"
              role="menuitem"
              :class="['ds-dd-mi', side === 'do' && i === 1 && 'is-picked']"
            >
              <span class="flex-1">{{ o }}</span>
              <template v-if="side === 'dont'"
                ><Check v-if="i === 1" :size="14" /><span v-else class="ds-dd-tick"
              /></template>
            </div>
          </div>
          <div v-else-if="p.id === 'centred'" class="ds-dd-wide">
            <Button variant="primary" :class="['w-full', side === 'dont' && 'justify-start!']"
              ><Download :size="14" />Download</Button
            >
          </div>
          <div v-else-if="p.id === 'square'" class="ds-dd-row">
            <Button
              data-ds-force="hover"
              variant="ghost"
              size="icon-sm"
              aria-label="More"
              :class="side === 'dont' && 'rounded-full!'"
              ><MoreHorizontal :size="16"
            /></Button>
          </div>
          <div v-else-if="p.id === 'chips'" class="ds-dd-col is-start">
            <div class="ds-dd-row">
              <span class="ds-dd-field"
                ><ListFilter :size="14" />Filters<span class="aff-badge">2</span></span
              >
            </div>
            <div v-if="side === 'dont'" class="ds-dd-row">
              <span class="ds-dd-chip">Video <X :size="12" /></span>
              <span class="ds-dd-chip">Past week <X :size="12" /></span>
            </div>
          </div>
          <div v-else-if="p.id === 'counts'" class="ds-dd-col is-start">
            <p class="ds-dd-title">
              Assets<span v-if="side === 'dont'" class="ds-dd-aside">29 assets</span>
            </p>
            <MarSeg
              model-value="all"
              :options="side === 'do' ? KINDS : KINDS.map((k) => ({ ...k, count: undefined }))"
              label="Type"
              class="mar-asset-seg"
            />
          </div>
          <div
            v-else-if="p.id === 'badge'"
            class="ds-dd-media"
            :style="{ backgroundImage: `url(${side === 'do' ? portraitSun : hillsFog})` }"
          >
            <span class="mar-asset-len"
              ><template v-if="side === 'do'"><Video :size="12" />0:07</template
              ><template v-else>PNG</template></span
            >
          </div>
          <div v-else-if="p.id === 'named'" class="ds-dd-bar">
            <MarTitleTabs :state="bar(side === 'do' ? 'Portrait relight' : 'My Local 1')" />
          </div>
          <div
            v-else-if="p.id === 'lines'"
            class="ds-dd-panel"
            :class="side === 'dont' && 'is-lined'"
          >
            <p class="ds-dd-label">Asset details</p>
            <p class="ds-dd-kv"><span>Type</span><span>Image · PNG</span></p>
            <p class="ds-dd-kv"><span>Size</span><span>1.9 MB</span></p>
          </div>
          <div v-else-if="p.id === 'text'" class="ds-dd-panel">
            <p class="ds-dd-label">Prompt</p>
            <p :class="side === 'do' ? 'ds-dd-textbox' : 'ds-dd-loose'">
              A fox in fresh snow at dawn, soft rim light, shallow depth of field.
            </p>
          </div>
          <template v-else-if="page === 'buttons'">
            <div class="ds-dd-row">
              <Button variant="primary">Create</Button>
              <Button :variant="side === 'do' ? 'ghost' : 'primary'">Cancel</Button>
            </div>
          </template>
          <template v-else-if="page === 'tooltip'">
            <div class="ds-dd-col">
              <Button v-if="side === 'do'" variant="ghost" size="icon-sm" aria-label="Notifications"
                ><Bell :size="15"
              /></Button>
              <Button v-else variant="ghost">Delete</Button>
              <span class="mar-tip">{{ side === 'do' ? 'Notifications' : 'Delete' }}</span>
            </div>
          </template>
          <MarStatus
            v-else-if="page === 'status'"
            status="executing"
            :label="side === 'do' ? undefined : 'Running 42%'"
          />
          <div v-else-if="page === 'items'" class="ds-dd-item">
            <MarItem
              data-ds-force="hover"
              name="Product shots"
              meta="Local · 2h ago"
              :thumb="portraitSun"
              :icon="ComfyWorkflow"
              :fav="false"
              :lines="[]"
              :style="side === 'dont' ? { transform: 'scale(1.06)' } : undefined"
            />
          </div>
          <div
            v-else-if="page === 'tabs-filters'"
            :style="
              side === 'dont'
                ? { '--mar-tab-radius': '999px', '--mar-tab-item-radius': '999px' }
                : undefined
            "
          >
            <MarSeg model-value="all" :options="TABS" label="Scope" />
          </div>
          <MarEmpty
            v-else-if="page === 'empty'"
            :icon="ComfyWorkflow"
            title="No workflows yet"
            text="Start from a template."
            :action="side === 'do' ? 'Browse templates' : undefined"
            :pics="side === 'do' ? EMPTY_PICS.workflows : []"
            compact
          >
            <template v-if="side === 'dont'">
              <div class="ds-dd-row">
                <Button variant="primary">Browse</Button>
                <Button variant="primary">Import</Button>
                <Button variant="secondary">Open ComfyUI</Button>
              </div>
            </template>
          </MarEmpty>
          <div v-else-if="page === 'menus'" role="menu" class="ds-dd-menu">
            <div role="menuitem" class="ds-dd-mi">Open in Cloud</div>
            <template v-if="side === 'do'">
              <div role="menuitem" class="ds-dd-mi">Duplicate</div>
              <div role="menuitem" class="ds-dd-mi">Move to project</div>
            </template>
          </div>
          <div v-else-if="page === 'icons'" class="ds-dd-row">
            <component :is="side === 'do' ? ComfyWorkflow : Workflow" :size="28" />
            <span>Workflows</span>
          </div>
        </div>
        <figcaption>
          <b
            ><component :is="side === 'do' ? Check : X" :size="13" :stroke-width="2.5" />{{
              side === 'do' ? 'Do' : 'Don’t'
            }}</b
          >
          <span>{{ side === 'do' ? p.do : p.dont }}</span>
        </figcaption>
      </figure>
    </template>
  </div>
</template>

<style>
.ds-dd {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 28px 16px;
}
.ds-dd-cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 12px;
}
.ds-dd-pic.proto-main.proto-main.proto-main {
  position: relative;
  display: flex;
  min-height: 200px;
  margin: 0;
  align-items: center;
  justify-content: center;
  padding: 24px;
  border-radius: 12px;
  overflow: hidden;
}
.ds-dd-cell.is-do .ds-dd-pic {
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 6%, transparent),
    inset 0 -3px 0 var(--color-status-running);
}
.ds-dd-cell.is-dont .ds-dd-pic {
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 6%, transparent),
    inset 0 -3px 0 var(--color-status-danger);
}
.ds-dd-cell figcaption {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 2px;
  color: var(--color-muted-foreground);
  font-size: 13px;
  line-height: 20px;
  text-wrap: pretty;
}
.ds-dd-cell figcaption b {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  font-weight: 600;
}
.ds-dd-cell.is-do b {
  color: var(--color-status-running);
}
.ds-dd-cell.is-dont b {
  color: var(--color-status-danger);
}
.ds-dd-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ds-dd-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.ds-dd-item {
  width: 200px;
}
.ds-dd-menu {
  width: 200px;
}
.ds-dd-mi {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 13px;
}
/* A single choice: the pick fills its row, as ui/Select.vue does. */
.ds-dd-mi.is-picked {
  background: var(--color-secondary-background);
  font-weight: 500;
}
.ds-dd-tick {
  width: 14px;
}
.ds-dd-col.is-start {
  align-items: flex-start;
}
.ds-dd-wide {
  width: 240px;
}
.ds-dd-box {
  display: flex;
  width: 260px;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  background: var(--color-card-background);
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.3);
  font-size: 13px;
}
.ds-dd-field {
  display: inline-flex;
  height: 32px;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-radius: var(--mar-tab-radius, 10px);
  background: color-mix(in oklch, var(--color-base-foreground) 6%, transparent);
  font-size: 13px;
}
.ds-dd-chip {
  display: inline-flex;
  height: 26px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-base-foreground) 9%, transparent);
  font-size: 12px;
}
.ds-dd-title {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 22px;
  font-weight: 600;
}
.ds-dd-aside {
  color: var(--color-subtle-foreground);
  font-size: 13px;
  font-weight: 400;
}
.ds-dd-media {
  position: relative;
  width: 220px;
  height: 150px;
  border-radius: 12px;
  background-position: center 30%;
  background-size: cover;
}
.ds-dd-bar {
  display: flex;
  width: 100%;
  padding: 8px;
  border-radius: 10px;
  background: var(--color-titlebar-background);
}
/* A panel a step lighter than what's behind it (UI-RULES › Surfaces). */
.ds-dd-panel {
  display: flex;
  width: 240px;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-radius: 14px;
  background: color-mix(in oklch, var(--color-base-foreground) 6%, var(--color-content-background));
  font-size: 13px;
}
.ds-dd-panel.is-lined {
  background: transparent;
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-base-foreground) 18%, transparent);
}
.ds-dd-label {
  color: var(--color-subtle-foreground);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.ds-dd-kv {
  display: flex;
  justify-content: space-between;
  color: var(--color-muted-foreground);
}
.ds-dd-kv span:last-child {
  color: var(--color-base-foreground);
}
.ds-dd-textbox,
.ds-dd-loose {
  line-height: 19px;
}
.ds-dd-textbox {
  padding: 10px 12px;
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-base-foreground) 5%, transparent);
}
</style>
