<script setup lang="ts">
import { computed } from 'vue'
import { Check, LoaderCircle, X } from 'lucide-vue-next'
import type { ProgressStepVM } from '../lib/progressViewModel'

/**
 * Focus stepper — replaces the caption for stepped ops. Fixed viewport, track
 * translates so the active row sits on the centre line; done steps fade up,
 * pending steps wait below.
 */
const props = defineProps<{ steps: ProgressStepVM[] }>()

const ROW_H = 46
const VISIBLE_ROWS = 3

const activeIndex = computed(() => {
  const i = props.steps.findIndex((s) => s.status === 'active')
  if (i >= 0) return i
  // No active step yet (brief gap, or all done). Anchor to the FIRST step, not
  // the last — otherwise the stepper centres on the final phase then jerks
  // back to the top when the first real phase fires.
  if (props.steps.every((s) => s.status === 'done')) return props.steps.length - 1
  return 0
})

const trackStyle = computed(() => ({
  transform: `translateY(${(Math.floor(VISIBLE_ROWS / 2) - activeIndex.value) * ROW_H}px)`
}))

function rowOpacity(index: number): number {
  const dist = Math.abs(index - activeIndex.value)
  if (dist === 0) return 1
  if (dist === 1) return 0.38
  return Math.max(0.08, 0.22 - (dist - 2) * 0.1)
}
</script>

<template>
  <div
    v-if="steps.length"
    class="bpv relative mx-auto h-[138px] w-full max-w-[38rem] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent_0%,#000_18%,#000_82%,transparent_100%)]"
    aria-live="polite"
  >
    <ul
      class="bpv__track m-0 flex list-none flex-col p-0 transition-transform duration-420 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none"
      :style="trackStyle"
    >
      <li
        v-for="(step, i) in steps"
        :key="step.phase"
        class="bpv__row flex h-[46px] items-center justify-center px-1 transition-opacity duration-300 ease-[ease]"
        :class="[
          `is-${step.status}`,
          {
            'is-focused': i === activeIndex
          }
        ]"
        :style="{ opacity: rowOpacity(i) }"
        :aria-current="i === activeIndex ? 'step' : undefined"
      >
        <span class="bpv__row-inner flex max-w-full justify-center">
          <span
            class="bpv__text flex min-w-0 max-w-[min(34rem,88vw)] flex-col items-center gap-px text-center"
          >
            <span class="bpv__line inline-flex max-w-full items-center justify-center gap-2">
              <span
                :class="
                  i === activeIndex
                    ? 'text-comfy-yellow'
                    : step.status === 'done'
                      ? 'text-[var(--brand-success,#3ecf8e)]'
                      : 'text-neutral-500'
                "
                class="bpv__icon inline-flex size-4 flex-[0_0_16px] items-center justify-center"
                aria-hidden="true"
              >
                <Check v-if="step.status === 'done'" :size="12" stroke-width="2.5" />
                <LoaderCircle
                  v-else-if="step.status === 'active'"
                  :size="14"
                  class="bpv__spin animate-spin [animation-duration:900ms] motion-reduce:animate-none"
                />
                <span
                  v-else
                  class="bpv__dot size-1.5 rounded-[50%] border-[1.5px] border-solid border-neutral-500"
                />
              </span>
              <span
                :class="
                  i === activeIndex
                    ? 'text-sm font-medium text-neutral-100 [text-shadow:0_1px_3px_rgba(0,0,0,0.75),0_0_24px_rgba(25,19,29,0.95)]'
                    : 'text-[0.8125rem] font-normal text-neutral-300 [text-shadow:0_1px_2px_rgba(0,0,0,0.7),0_0_18px_rgba(25,19,29,0.9)]'
                "
                class="bpv__label truncate leading-[1.25] tracking-[0.005em]"
                >{{ step.label }}</span
              >
            </span>
            <span
              v-if="i === activeIndex && step.detail"
              class="bpv__detail inline-flex max-w-full items-center gap-1 overflow-hidden text-[0.6875rem] leading-[1.3] tracking-[0.01em] text-ellipsis whitespace-nowrap tabular-nums [text-shadow:0_1px_2px_rgba(0,0,0,0.65),0_0_16px_rgba(25,19,29,0.85)]"
              :class="
                step.isError ? 'is-error font-semibold text-[var(--danger)]' : 'text-neutral-400'
              "
            >
              <X
                v-if="step.isError"
                :size="11"
                stroke-width="2.5"
                class="bpv__detail-icon flex-none"
              />
              {{ step.detail }}
            </span>
          </span>
        </span>
      </li>
    </ul>
  </div>
</template>
