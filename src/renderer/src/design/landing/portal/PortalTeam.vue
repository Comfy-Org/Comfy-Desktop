<script setup lang="ts">
import { ref } from 'vue'
import { UserPlus } from 'lucide-vue-next'
import PageHeader from '../ui/PageHeader.vue'
import BrandButton from '../parts/space/BrandButton.vue'
import MembersTable from '../parts/space/MembersTable.vue'
import { currentSpace } from '../spaces'

/** Space admins manage their own team. */
const table = ref<InstanceType<typeof MembersTable>>()
</script>

<template>
  <div class="mx-auto w-full max-w-280 px-10 pb-16">
    <PageHeader title="Team" :description="`People who can use ${currentSpace.name}.`">
      <template #actions
        ><BrandButton size="lg" @click="table?.invite()"
          ><UserPlus :size="15" />Invite</BrandButton
        ></template
      >
    </PageHeader>
    <MembersTable ref="table" :space-id="currentSpace.id" />
  </div>
</template>
