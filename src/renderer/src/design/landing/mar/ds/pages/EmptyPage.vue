<script setup lang="ts">
import { CloudOff, RotateCw, SearchX, Star } from 'lucide-vue-next'
import Button from '../../../ui/Button.vue'
import { ComfyWorkflow } from '../../icons/comfyIcons'
import MarEmpty from '../../pages/MarEmpty.vue'
import { EMPTY_PICS } from '../../pages/emptyArt'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
</script>

<template>
  <Section
    title="A page with nothing yet"
    note="A fan of three pictures of what will live here, the place's icon on a round badge, a title, one line, and the one action that fills it (a quieter second is optional). Every library page uses it."
  >
    <Cells :min="440">
      <Cell label="one action" fill>
        <MarEmpty
          :icon="ComfyWorkflow"
          title="No workflows yet"
          text="Start from a template, or open ComfyUI and save what you make."
          action="Browse templates"
          :pics="EMPTY_PICS.workflows"
        />
      </Cell>
      <Cell label="with a second action" fill>
        <MarEmpty
          :icon="Star"
          title="Star things to keep them here"
          text="Star a template, an app or an asset and it shows up here and in your sidebar."
          action="Browse Explore"
          second="Learn more"
          :pics="EMPTY_PICS.apps"
        />
      </Cell>
    </Cells>
  </Section>
  <Section
    title="Inside a page"
    note="`compact`: a project's or a space's empty tab. No pictures shows the badge alone."
  >
    <Cells :min="300">
      <Cell label="compact, with pictures" fill>
        <MarEmpty
          :icon="ComfyWorkflow"
          title="No workflows in this project"
          text="Move one here or start a new one."
          action="New workflow"
          :pics="EMPTY_PICS.projects"
          compact
        />
      </Cell>
      <Cell label="compact, badge alone" fill>
        <MarEmpty
          :icon="ComfyWorkflow"
          title="Nothing here yet"
          text="What you add shows up here."
          compact
        />
      </Cell>
    </Cells>
  </Section>
  <Section
    title="No results and errors"
    note='`tone="error"`: the badge reads as a problem, not an invitation. The action clears or retries.'
  >
    <Cells :min="300">
      <Cell label="no results" fill>
        <MarEmpty
          :icon="SearchX"
          title="Nothing matches"
          text="Try another word, or clear the filters to see everything."
          action="Clear filters"
          compact
          tone="error"
        />
      </Cell>
      <Cell label="couldn't load" fill>
        <MarEmpty
          :icon="CloudOff"
          title="Couldn't load your workflows"
          text="Check your connection and try again."
          tone="error"
        >
          <Button><RotateCw :size="14" />Try again</Button>
        </MarEmpty>
      </Cell>
    </Cells>
  </Section>
</template>
