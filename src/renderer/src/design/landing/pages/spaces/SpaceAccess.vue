<script setup lang="ts">
import { computed } from 'vue'
import Card from '../../ui/Card.vue'
import Input from '../../ui/Input.vue'
import SettingsRow from '../../ui/SettingsRow.vue'
import Switch from '../../ui/Switch.vue'
import Select from '../../ui/Select.vue'
import { ACCESS_LABEL, spaceById, type Access } from '../../spaces'

/** Who can get into the space. */
const { spaceId } = defineProps<{ spaceId: string }>()
const space = computed(() => spaceById(spaceId)!)
const p = computed(() => space.value.policies)
const ACCESS_HINT: Record<Access, string> = {
  invite: 'Only people you or space admins invite.',
  link: 'Anyone with the link signs in with a Comfy account and joins.',
  public: 'Listed and open to anyone. Pair with "Members pay" to sell your tools.'
}
</script>

<template>
  <Card class="divide-y divide-border-default">
    <SettingsRow label="Who can get in" :hint="ACCESS_HINT[space.access]" layout="inline">
      <Select
        v-model="space.access"
        class="w-52"
        :options="
          (Object.keys(ACCESS_LABEL) as Access[]).map((a) => ({ value: a, label: ACCESS_LABEL[a] }))
        "
      />
    </SettingsRow>
    <SettingsRow
      label="Allowed email domains"
      hint="Anyone with these addresses can request access. Leave empty for invite only."
    >
      <Input v-model="p.domains" placeholder="company.com" mono />
    </SettingsRow>
    <div class="flex flex-col gap-3 px-5 py-4">
      <Switch v-model="p.sso" label="Require single sign-on (SAML / OIDC)" />
      <Switch v-model="p.memberInvites" label="Space admins can invite their own people" />
    </div>
  </Card>
</template>
