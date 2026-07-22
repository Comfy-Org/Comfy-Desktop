<script setup lang="ts">
/**
 * Comfy Builder sign-in step. Renders inside a parent-owned
 * `BrandTakeoverLayout` as a centred `.brand-hero` column.
 *
 * Sign-in is an RFC 8252 handoff to the SYSTEM browser, so there is no
 * email/password form — the UI is designed around the round trip out of and
 * back into the app. `waiting-for-browser` is the state that matters most and
 * always keeps a Cancel. Timeout is a soft, retryable state, not an error;
 * only the error phase gets danger tone, and only on the message line.
 */
import { onBeforeUnmount, ref } from 'vue'
import { Check, Clock3, Info, TriangleAlert } from 'lucide-vue-next'
import { useAuthStore } from '../../stores/authStore'

const emit = defineEmits<{ (e: 'signed-in'): void; (e: 'skip'): void }>()

const store = useAuthStore()

/** Inline "What's a distribution?" explainer — an expander, not a modal. */
const whyOpen = ref(false)

/** Hold the success confirmation briefly so the return-from-browser moment
 *  reads as "it worked" instead of a flash. */
const SUCCESS_HOLD_MS = 1500
let successTimer: ReturnType<typeof setTimeout> | undefined

async function onSignIn(): Promise<void> {
  whyOpen.value = false
  try {
    await store.signIn()
  } catch {
    // Outcome is carried by `signInPhase`.
  }
  if (store.signInPhase !== 'success') return
  successTimer = setTimeout(() => emit('signed-in'), SUCCESS_HOLD_MS)
}

function onCancel(): void {
  store.cancelSignIn()
}

onBeforeUnmount(() => {
  if (successTimer !== undefined) clearTimeout(successTimer)
})
</script>

<template>
  <div class="brand-hero signin-step">
    <!-- ONE persistent live region wraps every phase, outside the Transition,
         so phase swaps are announced reliably. -->
    <div class="signin-step__phases" role="status" aria-live="polite">
      <Transition name="signin-phase" mode="out-in">
        <!-- idle — the one CTA owns both sign in and create account. -->
        <div v-if="store.signInPhase === 'idle'" key="idle" class="signin-step__phase">
          <h1 class="brand-title">{{ $t('devPlatform.signIn.title') }}</h1>
          <p class="brand-lead signin-step__lead">{{ $t('devPlatform.signIn.lead') }}</p>

          <div class="signin-step__why">
            <button
              type="button"
              class="signin-step__why-toggle"
              :aria-expanded="whyOpen"
              aria-controls="signin-why-body"
              data-testid="devplatform-signin-why"
              @click="whyOpen = !whyOpen"
            >
              <Info :size="14" aria-hidden="true" />
              <span>{{ $t('devPlatform.signIn.explainerTitle') }}</span>
            </button>
            <p
              v-show="whyOpen"
              id="signin-why-body"
              class="signin-step__why-body"
              data-testid="devplatform-signin-why-body"
            >
              {{ $t('devPlatform.signIn.explainerBody') }}
            </p>
          </div>

          <div class="signin-step__actions">
            <button
              type="button"
              class="brand-primary"
              data-testid="devplatform-signin-cta"
              @click="onSignIn"
            >
              {{ $t('devPlatform.signIn.cta') }}
            </button>
            <button
              type="button"
              class="brand-ghost"
              data-testid="devplatform-signin-skip"
              @click="emit('skip')"
            >
              {{ $t('devPlatform.signIn.skip') }}
            </button>
          </div>
        </div>

        <!-- waiting-for-browser — honest about where the user is, with a way out. -->
        <div
          v-else-if="store.signInPhase === 'waiting-for-browser'"
          key="waiting"
          class="signin-step__phase"
        >
          <h1 class="brand-title">{{ $t('devPlatform.signIn.waitingTitle') }}</h1>
          <p class="brand-lead signin-step__lead" data-testid="devplatform-signin-waiting-body">
            {{ $t('devPlatform.signIn.waitingBody') }}
          </p>

          <div
            class="signin-step__progress"
            role="progressbar"
            :aria-label="$t('devPlatform.signIn.waitingTitle')"
            data-testid="devplatform-signin-progress"
          >
            <span class="signin-step__progress-bar" aria-hidden="true" />
          </div>

          <div class="signin-step__actions">
            <button
              type="button"
              class="brand-ghost"
              data-testid="devplatform-signin-cancel"
              @click="onCancel"
            >
              {{ $t('devPlatform.signIn.cancel') }}
            </button>
          </div>
        </div>

        <!-- success — confirm WHO you are: the browser may have had another
             account signed in. -->
        <div v-else-if="store.signInPhase === 'success'" key="success" class="signin-step__phase">
          <span class="signin-step__glyph signin-step__glyph--success" aria-hidden="true">
            <Check :size="18" :stroke-width="2" />
          </span>
          <h1 class="brand-title" data-testid="devplatform-signin-success">
            {{ $t('devPlatform.signIn.successTitle', { email: store.status.email ?? '' }) }}
          </h1>
        </div>

        <!-- timeout — soft, retryable, neutral tone. -->
        <div v-else-if="store.signInPhase === 'timeout'" key="timeout" class="signin-step__phase">
          <span class="signin-step__glyph" aria-hidden="true">
            <Clock3 :size="18" :stroke-width="1.75" />
          </span>
          <h1 class="brand-title">{{ $t('devPlatform.signIn.timeoutTitle') }}</h1>
          <p class="brand-lead signin-step__lead">{{ $t('devPlatform.signIn.timeoutBody') }}</p>
          <div class="signin-step__actions">
            <button
              type="button"
              class="brand-primary"
              data-testid="devplatform-signin-retry"
              @click="onSignIn"
            >
              {{ $t('devPlatform.signIn.retry') }}
            </button>
            <button
              type="button"
              class="brand-ghost"
              data-testid="devplatform-signin-skip-timeout"
              @click="emit('skip')"
            >
              {{ $t('devPlatform.signIn.skip') }}
            </button>
          </div>
        </div>

        <!-- error — same shape as timeout; danger tone on the message only. -->
        <div v-else key="error" class="signin-step__phase">
          <span class="signin-step__glyph signin-step__glyph--danger" aria-hidden="true">
            <TriangleAlert :size="18" :stroke-width="1.75" />
          </span>
          <h1 class="brand-title">{{ $t('devPlatform.signIn.errorTitle') }}</h1>
          <p class="brand-lead signin-step__lead signin-step__lead--danger" role="alert">
            {{ $t('devPlatform.signIn.errorBody') }}
          </p>
          <div class="signin-step__actions">
            <button
              type="button"
              class="brand-primary"
              data-testid="devplatform-signin-retry-error"
              @click="onSignIn"
            >
              {{ $t('devPlatform.signIn.retry') }}
            </button>
            <button
              type="button"
              class="brand-ghost"
              data-testid="devplatform-signin-skip-error"
              @click="emit('skip')"
            >
              {{ $t('devPlatform.signIn.skip') }}
            </button>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.signin-step {
  gap: var(--takeover-gap-md);
}

.signin-step__phases {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

/* Pinned minimum height so phase swaps crossfade in place instead of
 * shunting the column up and down. */
.signin-step__phase {
  --signin-body-min-h: 260px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--takeover-gap-md);
  width: 100%;
  min-height: var(--signin-body-min-h);
}

/* .brand-lead ships a hero-sized bottom margin; here the action row follows,
 * so the gap comes from flex. */
.signin-step__lead {
  margin: 0;
  max-width: 46ch;
}

.signin-step__lead--danger {
  color: var(--danger);
}

/* State glyph — a quiet circular chip, not an alert badge. */
.signin-step__glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: var(--neutral-300);
  background: color-mix(in oklab, var(--neutral-100) 8%, transparent);
}
.signin-step__glyph--success {
  color: var(--success);
  background: color-mix(in oklab, var(--success) 14%, transparent);
}
.signin-step__glyph--danger {
  color: var(--danger);
  background: color-mix(in oklab, var(--danger) 14%, transparent);
}

/* --- inline explainer --- */
.signin-step__why {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--takeover-gap-sm);
  max-width: 52ch;
}

.signin-step__why-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--neutral-300);
  font: inherit;
  font-size: var(--takeover-fs-caption);
  cursor: pointer;
  transition:
    color 120ms ease,
    background 120ms ease;
}
.signin-step__why-toggle:hover {
  color: var(--neutral-100);
  background: color-mix(in oklab, var(--neutral-100) 8%, transparent);
}
.signin-step__why-toggle:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.signin-step__why-body {
  margin: 0;
  font-size: var(--takeover-fs-body);
  line-height: 1.5;
  color: var(--neutral-300);
  text-align: center;
}

.signin-step__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--takeover-gap-sm);
  margin-top: var(--takeover-gap-sm);
}

/* --- indeterminate browser-handoff affordance --- */
.signin-step__progress {
  position: relative;
  width: min(320px, 100%);
  height: 3px;
  border-radius: 999px;
  overflow: hidden;
  background: color-mix(in oklab, var(--neutral-100) 8%, transparent);
}
.signin-step__progress-bar {
  position: absolute;
  inset-block: 0;
  width: 40%;
  border-radius: inherit;
  background: var(--comfy-yellow);
  animation: signin-indeterminate 1400ms cubic-bezier(0.32, 0.72, 0, 1) infinite;
}

@keyframes signin-indeterminate {
  from {
    left: -40%;
  }
  to {
    left: 100%;
  }
}

/* --- phase crossfade: short, no movement --- */
.signin-phase-enter-active,
.signin-phase-leave-active {
  transition:
    opacity 180ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.signin-phase-enter-from,
.signin-phase-leave-to {
  opacity: 0;
  transform: translateY(4px);
}

@media (prefers-reduced-motion: reduce) {
  .signin-phase-enter-active,
  .signin-phase-leave-active {
    transition: none;
  }
  .signin-phase-enter-from,
  .signin-phase-leave-to {
    opacity: 1;
    transform: none;
  }
  .signin-step__progress-bar {
    animation: none;
    left: 0;
    width: 100%;
    opacity: 0.45;
  }
  .signin-step__why-toggle {
    transition: none;
  }
}
</style>
