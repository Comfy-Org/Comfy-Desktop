<script setup lang="ts">
import { computed } from 'vue'
import { Bell, Check, Workflow, X } from 'lucide-vue-next'
import portraitSun from '../../assets/portrait-sun.jpg'
import Button from '../../../ui/Button.vue'
import { ComfyWorkflow } from '../../icons/comfyIcons'
import MarEmpty from '../../pages/MarEmpty.vue'
import { EMPTY_PICS } from '../../pages/emptyArt'
import MarItem from '../../pages/MarItem.vue'
import MarSeg from '../../pages/MarSeg.vue'
import MarStatus from '../../pages/MarStatus.vue'
import { CONTENT } from '../content'

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
          <template v-if="page === 'buttons'">
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
  padding: 6px 8px;
  border-radius: 8px;
  font-size: 13px;
}
</style>
