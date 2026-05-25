<script setup lang="ts">
/**
 * TaskCard Component
 * T039, T048
 *
 * Displays a task summary with:
 * - Completion checkbox on left
 * - Task name and type indicator
 * - Time estimate, effort level, location
 * - Urgency indicator for recurring tasks
 * - Priority indicator
 * - Kebab menu for delete action
 */

import { ref, computed } from 'vue'
import type { Task } from '@/types/task'
import { calculateUrgency, isOverdue, isDueToday, formatDateLocale } from '@/utils/dateHelpers'
import { usePeopleStore } from '@/stores/peopleStore'
import { PersonAvatar } from '@/components/people'

const props = defineProps<{
  task: Task
}>()

const emit = defineEmits<{
  click: [task: Task]
  complete: [task: Task]
  delete: [task: Task]
}>()

const peopleStore = usePeopleStore()

// Menu state
const showMenu = ref(false)
const isCompleting = ref(false)

// Effective assignee: occurrence override (recurring) wins over the series default.
// personById includes soft-deleted people so historical assignments still resolve a name.
const assignee = computed(() => {
  const id = props.task.occurrenceAssigneeId !== undefined
    ? props.task.occurrenceAssigneeId
    : props.task.assigneeId
  return id ? peopleStore.personById(id) : undefined
})

const showAssignee = computed(() => {
  if (props.task.occurrenceAssigneeId !== undefined) {
    return props.task.occurrenceAssigneeId !== null
  }

  return !!props.task.assigneeId
})

// Computed properties
const typeLabel = computed(() => {
  switch (props.task.type) {
    case 'recurring':
      return 'Recurring'
    case 'project':
      return 'Project'
    default:
      return 'One-Off'
  }
})

const typeBadgeClass = computed(() => {
  switch (props.task.type) {
    case 'recurring':
      return 'bg-blue-100 text-blue-700'
    case 'project':
      return 'bg-purple-100 text-purple-700'
    default:
      return 'bg-gray-100 text-gray-700'
  }
})

const effortLabel = computed(() => {
  switch (props.task.effortLevel) {
    case 'low':
      return 'Low'
    case 'high':
      return 'High'
    default:
      return 'Med'
  }
})

const effortBadgeClass = computed(() => {
  switch (props.task.effortLevel) {
    case 'low':
      return 'bg-green-100 text-green-700'
    case 'high':
      return 'bg-red-100 text-red-700'
    default:
      return 'bg-yellow-100 text-yellow-700'
  }
})

const locationIcon = computed(() => {
  switch (props.task.location) {
    case 'home':
      return '🏠'
    case 'outside':
      return '🚶'
    default:
      return '📍'
  }
})

// Time display - for projects show session duration, for others show estimate
const timeDisplay = computed(() => {
  if (props.task.type === 'project' && props.task.projectSession) {
    return `${props.task.projectSession.minSessionDurationMinutes}m`
  }
  return `${props.task.timeEstimateMinutes}m`
})

// Urgency for recurring tasks
const urgencyInfo = computed(() => {
  if (props.task.type !== 'recurring' || !props.task.recurringPattern?.nextDueDate) {
    return null
  }

  const nextDue = props.task.recurringPattern.nextDueDate
  const urgency = calculateUrgency(nextDue)

  if (isOverdue(nextDue)) {
    return {
      text: `${urgency}d overdue`,
      class: 'text-red-600 bg-red-50'
    }
  } else if (isDueToday(nextDue)) {
    return {
      text: 'Due today',
      class: 'text-orange-600 bg-orange-50'
    }
  } else {
    const daysUntil = Math.abs(urgency)
    return {
      text: `Due in ${daysUntil}d`,
      class: 'text-green-600 bg-green-50'
    }
  }
})

// Priority display
const priorityDisplay = computed(() => {
  switch (props.task.priority) {
    case 'critical':
      return { label: 'Critical', class: 'text-red-500' }
    case 'important':
      return { label: 'Important', class: 'text-yellow-600' }
    case 'optional':
    default:
      return { label: 'Optional', class: 'text-gray-400' }
  }
})

// Can this task be completed?
const canComplete = computed(() => props.task.type !== 'project')

function handleClick() {
  if (!showMenu.value) {
    emit('click', props.task)
  }
}

async function handleComplete(e: Event) {
  e.stopPropagation()

  if (props.task.type === 'project') {
    // Show toast for projects
    alert('Projects cannot be marked complete. Delete them when finished.')
    return
  }

  isCompleting.value = true

  // Small delay to show the checkmark animation
  setTimeout(() => {
    emit('complete', props.task)
    isCompleting.value = false
  }, 300)
}

function handleDelete(e: Event) {
  e.stopPropagation()
  showMenu.value = false
  emit('delete', props.task)
}

function toggleMenu(e: Event) {
  e.stopPropagation()
  showMenu.value = !showMenu.value
}

function closeMenu() {
  showMenu.value = false
}
</script>

<template>
  <div
    data-testid="task-card"
    class="bg-white rounded-lg shadow-sm border border-gray-200 p-3 cursor-pointer hover:shadow-md transition-shadow"
    role="article"
    tabindex="0"
    :aria-label="`Task: ${task.name}. ${typeLabel}. ${timeDisplay}. Priority: ${priorityDisplay.label}. Press Enter to edit.`"
    @click="handleClick"
    @keydown.enter="handleClick"
    @keydown.space.prevent="handleClick"
    @blur="closeMenu"
  >
    <div class="flex items-start gap-3">
      <!-- Completion Checkbox (left side) -->
      <button
        data-testid="task-complete-button"
        class="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full border-2 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1 cursor-pointer"
        :class="[
          isCompleting
            ? 'bg-green-500 border-green-500'
            : canComplete
              ? 'border-gray-300 hover:border-green-400 hover:bg-green-50'
              : 'border-gray-200 cursor-not-allowed opacity-50'
        ]"
        :aria-label="canComplete ? `Mark ${task.name} as complete` : 'Projects cannot be marked complete'"
        :disabled="!canComplete"
        @click="handleComplete"
      >
        <!-- Checkmark (shows when completing) -->
        <svg
          v-if="isCompleting"
          class="w-full h-full text-white p-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
        </svg>
      </button>

      <!-- Main Content -->
      <div class="flex-1 min-w-0">
        <!-- Header: Name and badges -->
        <div class="flex items-start justify-between gap-2">
          <h3 class="font-medium text-gray-900 text-sm line-clamp-2 flex-1">
            {{ task.name }}
          </h3>

          <!-- Right side: Type badge and kebab menu -->
          <div class="flex items-center gap-1 flex-shrink-0">
            <span :class="[typeBadgeClass, 'text-xs px-1.5 py-0.5 rounded font-medium']">
              {{ typeLabel }}
            </span>

            <!-- Kebab Menu -->
            <div class="relative">
              <button
                class="p-1 rounded hover:bg-gray-100 transition-colors cursor-pointer"
                :aria-label="`More options for ${task.name}`"
                @click="toggleMenu"
              >
                <svg class="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </button>

              <!-- Dropdown Menu -->
              <div
                v-if="showMenu"
                class="absolute right-0 top-full mt-1 w-32 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20"
              >
                <button
                  data-testid="task-delete-button"
                  class="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer"
                  @click="handleDelete"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Meta info (compact) -->
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 mt-1">
          <!-- Time -->
          <span class="flex items-center gap-0.5">
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {{ timeDisplay }}
          </span>

          <!-- Effort -->
          <span :class="[effortBadgeClass, 'px-1.5 py-0.5 rounded text-xs']">
            {{ effortLabel }}
          </span>

          <!-- Location -->
          <span>{{ locationIcon }}</span>

          <!-- Priority -->
          <span :class="[priorityDisplay.class, 'flex items-center gap-0.5']">
            <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path d="M3 6a3 3 0 013-3h10a1 1 0 01.8 1.6L14.25 8l2.55 3.4A1 1 0 0116 13H6a1 1 0 00-1 1v3a1 1 0 11-2 0V6z" />
            </svg>
            {{ priorityDisplay.label }}
          </span>

          <!-- Urgency indicator for recurring tasks -->
          <span v-if="urgencyInfo" :class="[urgencyInfo.class, 'px-1.5 py-0.5 rounded font-medium']">
            {{ urgencyInfo.text }}
          </span>

          <!-- Assignee -->
          <PersonAvatar
            v-if="showAssignee"
            :person="assignee"
            size="xs"
            data-testid="task-assignee-avatar"
          />
        </div>

        <!-- Deadline if set -->
        <div v-if="task.deadline" class="text-xs text-gray-500 mt-1">
          📅 {{ formatDateLocale(task.deadline) }}
        </div>
      </div>
    </div>
  </div>
</template>
