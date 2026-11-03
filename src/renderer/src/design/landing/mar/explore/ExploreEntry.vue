<script setup lang="ts">
import ExplorePage from '../../pages/ExplorePage.vue'
import MarExplore from './MarExplore.vue'
import { isMariana } from '../proposal'

/** Explore for the picked proposal: Mar's (MarPage brings its Loading and
 *  Error states), or Pablo's untouched. */
</script>

<template>
  <MarExplore v-if="isMariana" />
  <ExplorePage v-else />
</template>
