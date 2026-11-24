import { computed } from 'vue'
import { can } from '../milestones'
import { isNewUser } from '../useProto'
import { creditsState, type CreditsState } from './credits'

const RUNNABLE: ReadonlySet<CreditsState> = new Set<CreditsState>([
  'active',
  'yearly',
  'processing',
  'planUsed',
  'stopped'
])

export type RunBlock = {
  title: string
  message: string
  action?: string
  busy?: string
  ownerOnly: boolean
  memberNote?: string
  balance?: boolean
  auto?: boolean
}

export const RUN_BLOCKS: Partial<Record<CreditsState, RunBlock>> = {
  out: {
    title: 'Out of credits',
    message:
      'Your plan and top-up credits are used up. Add credits to run now, or wait for the plan to refill November 1.',
    action: 'Add credits and run',
    busy: 'Adding credits…',
    ownerOnly: true,
    memberNote: 'Only a workspace owner can add credits.',
    balance: true
  },
  negative: {
    title: 'Your balance is below zero',
    message:
      'A run finished past your balance. Add credits to bring it back above zero, then the run starts.',
    action: 'Add credits and run',
    busy: 'Adding credits…',
    ownerOnly: true,
    memberNote: 'Only a workspace owner can add credits.',
    balance: true
  },
  noPlan: {
    title: 'Subscribe to run on Cloud',
    message:
      'Running on Comfy Cloud needs a plan. Buying credits doesn’t start one, so subscribe first.',
    action: 'Subscribe and run',
    busy: 'Subscribing…',
    ownerOnly: true,
    memberNote: 'Only a workspace owner can subscribe.'
  },
  ended: {
    title: 'Your Cloud plan ended',
    message: 'Resubscribe to run workflows on Cloud. Buying credits doesn’t restart your plan.',
    action: 'Resubscribe and run',
    busy: 'Resubscribing…',
    ownerOnly: true,
    memberNote: 'Only a workspace owner can resubscribe.'
  },
  paused: {
    title: 'Your plan is paused',
    message:
      'Cloud runs wait until the payment goes through. Update your payment to pick up where you left off.',
    action: 'Update payment and run',
    busy: 'Updating payment…',
    ownerOnly: true,
    memberNote: 'Ask a workspace owner to update the payment.'
  },
  pastDue: {
    title: 'Your payment is past due',
    message:
      'Your last payment didn’t go through, so your plan credits didn’t refill. Update your payment to run.',
    action: 'Update payment and run',
    busy: 'Updating payment…',
    ownerOnly: true,
    memberNote: 'Ask a workspace owner to update the payment.'
  },
  unavailable: {
    title: 'Couldn’t load your balance',
    message: 'We can’t check your credits right now, so the run waits. Try again in a moment.',
    action: 'Try again',
    busy: 'Checking your credits…',
    ownerOnly: false
  },
  loading: {
    title: 'Checking your credits',
    message: 'Your balance is still loading. The run starts as soon as it’s in.',
    busy: 'Checking your credits…',
    ownerOnly: false,
    auto: true
  }
}

export const runBlock = computed<RunBlock | undefined>(() =>
  can.value.onboarding && !isNewUser.value && !RUNNABLE.has(creditsState.id)
    ? RUN_BLOCKS[creditsState.id]
    : undefined
)
