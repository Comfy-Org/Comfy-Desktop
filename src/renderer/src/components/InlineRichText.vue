<script setup lang="ts">
interface Props {
  text: string
}
const props = defineProps<Props>()

type SegmentKind = 'plain' | 'bold' | 'code'

interface Segment {
  text: string
  kind: SegmentKind
}

function segments(text: string): Segment[] {
  const out: Segment[] = []
  for (const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)) {
    if (!part) continue
    if (part.startsWith('**') && part.endsWith('**')) {
      out.push({ text: part.slice(2, -2), kind: 'bold' })
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      out.push({ text: part.slice(1, -1), kind: 'code' })
    } else {
      out.push({ text: part, kind: 'plain' })
    }
  }
  return out
}
</script>

<template>
  <template v-for="(seg, i) in segments(props.text)" :key="i">
    <strong v-if="seg.kind === 'bold'">{{ seg.text }}</strong>
    <code v-else-if="seg.kind === 'code'">{{ seg.text }}</code>
    <template v-else>{{ seg.text }}</template>
  </template>
</template>
