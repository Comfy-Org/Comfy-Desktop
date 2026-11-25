<script setup lang="ts">
import { onMounted } from 'vue'
import LandingPrototypes from '../../../LandingPrototypes.vue'
import { goIn, type Mode, type Page } from '../../../useProto'
import { pageState, type PageState } from '../../pages/pageState'
import { APP_ACTIONS, type AppAction } from '../appActions'

/** The whole prototype, routed and set up from the URL (kit/AppShot.vue). */
const url = new URLSearchParams(location.search)
const page = url.get('page') as Page | null
const mode = (url.get('mode') ?? 'create') as Mode
const state = url.get('pageState') as PageState | null
const run = APP_ACTIONS[url.get('run') as AppAction]

if (page) goIn(mode, page)
if (state) pageState.id = state
// Opened once the app is up, the way a person would open it.
onMounted(() => setTimeout(() => run?.(), 300))
</script>

<template>
  <LandingPrototypes standalone />
</template>
