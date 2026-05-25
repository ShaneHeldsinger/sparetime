<script setup lang="ts">
/**
 * PersonAvatar - Colored-initials avatar for a person.
 *
 * Renders the circle + initials as inline SVG: vector text is centered
 * geometrically (text-anchor=middle, dominant-baseline=central) and scales
 * crisply at any browser zoom, unlike HTML text whose line-box metrics and
 * device-pixel rounding leave it visibly off-centre in a tiny circle.
 *
 * Renders a neutral "?" avatar when no person resolves (e.g. deleted assignee).
 */
import { computed } from 'vue'
import type { Person } from '@/types/person'
import { getPersonColor, getInitials } from '@/utils/personColors'

const props = withDefaults(
  defineProps<{
    person?: Person | null
    size?: 'xs' | 'sm' | 'md'
    showName?: boolean
  }>(),
  { size: 'sm', showName: false }
)

const color = computed(() => getPersonColor(props.person?.color))
const initials = computed(() => (props.person ? getInitials(props.person.name) : '?'))
const isDeleted = computed(() => !!props.person?.deletedAt)

const sizeClass = computed(() => {
  switch (props.size) {
    case 'xs':
      return 'w-5 h-5'
    case 'md':
      return 'w-9 h-9'
    default:
      return 'w-6 h-6'
  }
})
</script>

<template>
  <span class="inline-flex items-center gap-1.5" :title="person?.name">
    <svg
      viewBox="0 0 20 20"
      class="flex-shrink-0"
      :class="[sizeClass, { 'opacity-40': isDeleted }]"
      role="img"
      :aria-label="person ? person.name : 'Unassigned'"
    >
      <circle cx="10" cy="10" r="10" :fill="color.hex" />
      <text
        x="10"
        y="10"
        text-anchor="middle"
        dominant-baseline="central"
        font-size="9"
        font-weight="700"
        font-family="ui-sans-serif, system-ui, sans-serif"
        :fill="color.textHex"
      >{{ initials }}</text>
    </svg>
    <span
      v-if="showName"
      class="text-sm text-gray-700 truncate"
      :class="{ 'line-through text-gray-400': isDeleted }"
    >
      {{ person ? person.name : 'Unknown' }}
    </span>
  </span>
</template>
