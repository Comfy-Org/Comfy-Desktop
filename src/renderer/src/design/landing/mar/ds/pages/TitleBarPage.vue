<script setup lang="ts">
import DesktopTitleBar from '../../../parts/DesktopTitleBar.vue'
import Cell from '../kit/Cell.vue'
import Cells from '../kit/Cells.vue'
import Section from '../kit/Section.vue'
import Stage from '../kit/Stage.vue'
</script>

<template>
  <Section
    title="Title bar"
    note="The browser stand-in for the app's bar: Home, the build breadcrumb, the icons."
  >
    <Cells :min="560">
      <Cell label="idle" on="bare" fill><DesktopTitleBar /></Cell>
      <Cell label="Home hover" on="bare" fill force="hover" target="header button::text(Home)">
        <DesktopTitleBar />
      </Cell>
      <Cell
        label="Open a build · focus"
        on="bare"
        fill
        force="focus"
        target="header button::text(Open a build)"
      >
        <DesktopTitleBar />
      </Cell>
    </Cells>
  </Section>
  <Section title="Build switch" note="Opens from Open a build.">
    <Cells :min="560"><Stage id="build-switch" label="open" /></Cells>
  </Section>
</template>
