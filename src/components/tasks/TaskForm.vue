<script setup lang="ts">
/**
 * TaskForm Component
 * T038, T042, T043, T044, T047
 *
 * Redesigned mobile-first form with:
 * - Horizontal tappable options for type, effort, location
 * - Smart time/session field positioning
 * - Side-by-side effort/location with divider
 * - Sticky footer with Cancel/Save buttons
 * - Scrollable content area with visual overflow indicators
 */

import { ref, computed, watch, onMounted } from 'vue'
import { useTaskStore } from '@/stores/taskStore'
import { usePeopleStore } from '@/stores/peopleStore'
import type { Task, TaskType, EffortLevel, Location, IntervalUnit, CreateTaskInput, Priority } from '@/types/task'
import { todayISO } from '@/utils/dateHelpers'

// Props
const props = defineProps<{
  task?: Task // If provided, we're editing
  onClose: () => void
  onSave?: (task: Task) => void
}>()

// Stores
const taskStore = useTaskStore()
const peopleStore = usePeopleStore()

// Form state
const name = ref('')
const type = ref<TaskType>('one-off')
const timeEstimateMinutes = ref(15)
const effortLevel = ref<EffortLevel>('medium')
const location = ref<Location>('home')
const priority = ref<Priority>('important')
const deadline = ref('')
const dependsOnId = ref<string | undefined>(undefined)

// Assignment state
const assigneeId = ref<string | null | undefined>(undefined)
// For recurring tasks: 'series' sets the default assignee; 'occurrence' overrides
// only the current occurrence (auto-clears on completion).
const assignmentScope = ref<'series' | 'occurrence'>('series')

// Recurring pattern state
const recurringIntervalValue = ref(1)
const recurringIntervalUnit = ref<IntervalUnit>('days')
const recurringLastCompleted = ref(todayISO().split('T')[0])

// Project session state
const minSessionDuration = ref(30)

// UI state
const isSubmitting = ref(false)
const errorMessage = ref('')

// Computed
const isEditing = computed(() => !!props.task)
const title = computed(() => (isEditing.value ? 'Edit Task' : 'Add Task'))
const submitText = computed(() => (isEditing.value ? 'Save Changes' : 'Add Task'))

const showRecurringFields = computed(() => type.value === 'recurring')
const showProjectFields = computed(() => type.value === 'project')

// Available tasks for dependency dropdown (exclude current task)
const availableDependencies = computed(() => {
  return taskStore.activeTasks.filter((t) => t.id !== props.task?.id)
})

// People available as assignees
const availablePeople = computed(() => peopleStore.activePeople)
const showAssigneeField = computed(() => availablePeople.value.length > 0 || assigneeId.value != null)

// Options
const typeOptions: { value: TaskType; label: string; icon: string }[] = [
  { value: 'one-off', label: 'One-off', icon: '📌' },
  { value: 'recurring', label: 'Recurring', icon: '🔁' },
  { value: 'project', label: 'Project', icon: '📂' }
]

const effortOptions: { value: EffortLevel; label: string; icon: string }[] = [
  { value: 'low', label: 'Low', icon: '😌' },
  { value: 'medium', label: 'Med', icon: '💪' },
  { value: 'high', label: 'High', icon: '🔥' }
]

const locationOptions: { value: Location; label: string; icon: string }[] = [
  { value: 'home', label: 'Home', icon: '🏠' },
  { value: 'outside', label: 'Away', icon: '🚶' },
  { value: 'anywhere', label: 'Any', icon: '📍' }
]

const priorityOptions: { value: Priority; label: string; icon: string }[] = [
  { value: 'optional', label: 'Optional', icon: '💤' },
  { value: 'important', label: 'Important', icon: '⭐' },
  { value: 'critical', label: 'Critical', icon: '🔥' }
]

const intervalUnitOptions: { value: IntervalUnit; label: string }[] = [
  { value: 'hours', label: 'Hours' },
  { value: 'days', label: 'Days' },
  { value: 'weeks', label: 'Weeks' },
  { value: 'months', label: 'Months' },
  { value: 'years', label: 'Years' }
]

// Time presets for quick selection - more common short durations
const timePresets = [5, 15, 30, 60]

// Initialize form with task data if editing
onMounted(() => {
  if (props.task) {
    name.value = props.task.name
    type.value = props.task.type
    timeEstimateMinutes.value = props.task.timeEstimateMinutes
    effortLevel.value = props.task.effortLevel
    location.value = props.task.location
    priority.value = props.task.priority
    deadline.value = props.task.deadline?.split('T')[0] || ''
    dependsOnId.value = props.task.dependsOnId

    // Assignment: an existing occurrence override means we're editing "this time only"
    if (props.task.type === 'recurring' && props.task.occurrenceAssigneeId !== undefined) {
      assignmentScope.value = 'occurrence'
      assigneeId.value = props.task.occurrenceAssigneeId
    } else {
      assignmentScope.value = 'series'
      assigneeId.value = props.task.assigneeId
    }

    if (props.task.recurringPattern) {
      recurringIntervalValue.value = props.task.recurringPattern.intervalValue
      recurringIntervalUnit.value = props.task.recurringPattern.intervalUnit
      recurringLastCompleted.value = props.task.recurringPattern.lastCompletedDate.split('T')[0]
    }

    if (props.task.projectSession) {
      minSessionDuration.value = props.task.projectSession.minSessionDurationMinutes
    }
  }
})

// Reset type-specific fields when type changes
watch(type, (newType) => {
  if (newType !== 'recurring') {
    recurringIntervalValue.value = 1
    recurringIntervalUnit.value = 'days'
  }
  if (newType !== 'project') {
    minSessionDuration.value = 30
  }
  // Clear deadline for non-one-off tasks
  if (newType !== 'one-off') {
    deadline.value = ''
  }
})

function formatTimeLabel(minutes: number): string {
  // Always show in minutes for consistency
  return `${minutes}m`
}

// Form submission
async function handleSubmit() {
  isSubmitting.value = true
  errorMessage.value = ''

  try {
    const effectiveTimeEstimate = type.value === 'project'
      ? minSessionDuration.value
      : timeEstimateMinutes.value

    const input: CreateTaskInput = {
      name: name.value.trim(),
      type: type.value,
      timeEstimateMinutes: effectiveTimeEstimate,
      effortLevel: effortLevel.value,
      location: location.value,
      priority: priority.value,
      deadline: deadline.value ? new Date(deadline.value) : undefined,
      dependsOnId: dependsOnId.value
    }

    // Assignment: recurring tasks distinguish series default vs occurrence override
    if (type.value === 'recurring' && assignmentScope.value === 'occurrence') {
      // Override just the current occurrence; leave the series default untouched
      input.occurrenceAssigneeId = assigneeId.value ?? null
    } else {
      input.assigneeId = assigneeId.value ?? undefined
      // Setting/clearing the series default supersedes any occurrence override
      if (type.value === 'recurring') {
        input.occurrenceAssigneeId = undefined
      }
    }

    if (type.value === 'recurring') {
      input.recurringPattern = {
        intervalValue: recurringIntervalValue.value,
        intervalUnit: recurringIntervalUnit.value,
        lastCompletedDate: new Date(recurringLastCompleted.value).toISOString()
      }
    }

    if (type.value === 'project') {
      input.projectSession = {
        minSessionDurationMinutes: minSessionDuration.value
      }
    }

    let result: Task | undefined

    if (isEditing.value && props.task?.id) {
      result = await taskStore.update({
        id: props.task.id,
        ...input
      })
    } else {
      result = await taskStore.create(input)
    }

    if (result) {
      props.onSave?.(result)
      props.onClose()
    } else {
      errorMessage.value = taskStore.error || 'Failed to save task'
    }
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : 'An error occurred'
  } finally {
    isSubmitting.value = false
  }
}

function handleCancel() {
  props.onClose()
}
</script>

<template>
  <div
    class="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="isEditing ? 'edit-task-title' : 'add-task-title'"
    @click.self="handleCancel"
  >
    <div
      data-testid="task-form"
      class="bg-white w-full max-w-lg max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-2xl shadow-xl"
    >
      <!-- Header (fixed) -->
      <div class="flex-shrink-0 border-b px-4 py-3 flex items-center justify-between bg-white rounded-t-2xl sm:rounded-t-2xl">
        <h2 :id="isEditing ? 'edit-task-title' : 'add-task-title'" class="text-lg font-semibold text-gray-900">{{ title }}</h2>
        <button
          type="button"
          class="touch-target p-2 -mr-2 text-gray-400 hover:text-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
          aria-label="Close form"
          @click="handleCancel"
        >
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Scrollable Content -->
      <div class="flex-1 overflow-y-auto overscroll-contain">
        <form id="task-form" class="p-4 space-y-4" @submit.prevent="handleSubmit">
          <!-- Error message -->
          <div
            v-if="errorMessage"
            class="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"
            role="alert"
            aria-live="polite"
          >
            {{ errorMessage }}
          </div>

          <!-- Task Name -->
          <div>
            <label for="task-name" class="block text-sm font-medium text-gray-700 mb-1">
              Task Name <span class="text-red-500">*</span>
            </label>
            <input
              id="task-name"
              v-model="name"
              data-testid="task-name-input"
              type="text"
              required
              maxlength="200"
              placeholder="What do you need to do?"
              class="touch-target w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <!-- Task Type - Horizontal Tappable Options with grouped background -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Type</label>
            <div class="grid grid-cols-3 gap-1 bg-gray-100 rounded-lg p-1">
              <button
                v-for="opt in typeOptions"
                :key="opt.value"
                type="button"
                data-testid="task-type-select"
                class="touch-target px-3 py-2 rounded-md text-sm font-medium transition-all cursor-pointer"
                :class="type === opt.value
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-transparent text-gray-600 hover:bg-white'"
                :aria-pressed="type === opt.value"
                @click="type = opt.value"
              >
                <span class="block text-base mb-0.5">{{ opt.icon }}</span>
                <span class="block text-xs">{{ opt.label }}</span>
              </button>
            </div>
          </div>

          <!-- Time/Session Duration - Unified section that swaps based on type -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              {{ type === 'project' ? 'Min Session' : 'Time Estimate' }}
              <span class="text-xs text-gray-500 font-normal ml-1">(minutes)</span>
            </label>

            <!-- Quick presets + custom input inline with grouped background -->
            <div class="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
              <!-- Custom input with suffix -->
              <div class="flex items-center bg-white rounded-md shadow-sm">
                <input
                  v-if="type === 'project'"
                  id="min-session"
                  v-model.number="minSessionDuration"
                  data-testid="project-min-session-input"
                  type="number"
                  min="1"
                  max="480"
                  required
                  class="touch-target w-12 rounded-l-md border-0 text-center text-sm focus:ring-2 focus:ring-inset focus:ring-primary-500 py-1.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <input
                  v-else
                  id="time-estimate"
                  v-model.number="timeEstimateMinutes"
                  data-testid="task-time-input"
                  type="number"
                  min="1"
                  max="480"
                  required
                  class="touch-target w-12 rounded-l-md border-0 text-center text-sm focus:ring-2 focus:ring-inset focus:ring-primary-500 py-1.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span class="pr-2 text-sm text-gray-500 bg-white rounded-r-md">m</span>
              </div>

              <!-- Vertical divider -->
              <div class="w-px h-7 bg-gray-300"></div>

              <!-- Presets -->
              <div class="flex gap-1 flex-1">
                <button
                  v-for="preset in timePresets"
                  :key="preset"
                  type="button"
                  class="flex-1 px-2 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer"
                  :class="(type === 'project' ? minSessionDuration : timeEstimateMinutes) === preset
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-white text-gray-700 hover:bg-gray-50'"
                  @click="type === 'project' ? minSessionDuration = preset : timeEstimateMinutes = preset"
                >
                  {{ formatTimeLabel(preset) }}
                </button>
              </div>
            </div>
          </div>

          <!-- Recurring Pattern Fields -->
          <div v-if="showRecurringFields" class="bg-blue-50 rounded-lg p-3 space-y-3">
            <p class="text-sm font-medium text-blue-800">Repeat every</p>
            <div class="flex gap-2 items-center">
              <input
                id="recurring-interval"
                v-model.number="recurringIntervalValue"
                data-testid="recurring-interval-input"
                type="number"
                min="1"
                max="999"
                required
                class="touch-target w-16 px-2 py-2 border border-gray-300 rounded-lg text-center focus:ring-2 focus:ring-blue-500"
              />
              <select
                id="recurring-unit"
                v-model="recurringIntervalUnit"
                data-testid="recurring-unit-select"
                required
                class="touch-target flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option v-for="opt in intervalUnitOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>
            <div>
              <label for="last-completed" class="block text-xs text-blue-600 mb-1">Last done</label>
              <input
                id="last-completed"
                v-model="recurringLastCompleted"
                data-testid="recurring-last-completed-input"
                type="date"
                required
                class="touch-target w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <!-- Project Info (when project selected) -->
          <div v-if="showProjectFields" class="bg-purple-50 rounded-lg p-3">
            <p class="text-xs text-purple-600">
              📂 Projects are ongoing. Only suggested when you have at least the session time available.
            </p>
          </div>

          <!-- Effort - Single row with label and buttons inline -->
          <div class="flex items-center gap-3">
            <label class="text-sm font-medium text-gray-700 w-16 shrink-0">Effort</label>
            <div class="flex gap-1 flex-1 bg-gray-100 rounded-lg p-1">
              <button
                v-for="opt in effortOptions"
                :key="opt.value"
                type="button"
                data-testid="task-effort-select"
                class="touch-target flex-1 px-2 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1"
                :class="effortLevel === opt.value
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-transparent text-gray-600 hover:bg-white'"
                :aria-pressed="effortLevel === opt.value"
                @click="effortLevel = opt.value"
              >
                <span>{{ opt.icon }}</span>
                <span>{{ opt.label }}</span>
              </button>
            </div>
          </div>

          <!-- Location - Single row with label and buttons inline -->
          <div class="flex items-center gap-3">
            <label class="text-sm font-medium text-gray-700 w-16 shrink-0">Location</label>
            <div class="flex gap-1 flex-1 bg-gray-100 rounded-lg p-1">
              <button
                v-for="opt in locationOptions"
                :key="opt.value"
                type="button"
                data-testid="task-location-select"
                class="touch-target flex-1 px-2 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1"
                :class="location === opt.value
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-transparent text-gray-600 hover:bg-white'"
                :aria-pressed="location === opt.value"
                @click="location = opt.value"
              >
                <span>{{ opt.icon }}</span>
                <span>{{ opt.label }}</span>
              </button>
            </div>
          </div>

          <!-- Priority - Single row with label and buttons inline -->
          <div class="flex items-center gap-3">
            <label class="text-sm font-medium text-gray-700 w-16 shrink-0">Priority</label>
            <div class="flex gap-1 flex-1 bg-gray-100 rounded-lg p-1">
              <button
                v-for="opt in priorityOptions"
                :key="opt.value"
                type="button"
                data-testid="priority-select"
                class="touch-target flex-1 px-2 py-1.5 rounded-md text-sm font-medium transition-all cursor-pointer flex items-center justify-center gap-1"
                :class="priority === opt.value
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-transparent text-gray-600 hover:bg-white'"
                :aria-pressed="priority === opt.value"
                @click="priority = opt.value"
              >
                <span>{{ opt.icon }}</span>
                <span>{{ opt.label }}</span>
              </button>
            </div>
          </div>

          <!-- Deadline (optional) - Only for one-off tasks -->
          <div v-if="type === 'one-off'" class="flex items-center gap-3">
            <label for="deadline" class="text-sm font-medium text-gray-700 whitespace-nowrap">
              Deadline
            </label>
            <input
              id="deadline"
              v-model="deadline"
              data-testid="task-deadline-input"
              type="date"
              class="touch-target flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <!-- Assignee (optional) -->
          <div v-if="showAssigneeField">
            <label for="assignee" class="block text-sm font-medium text-gray-700 mb-1">
              Assigned To <span class="text-xs text-gray-500 font-normal">(optional)</span>
            </label>
            <select
              id="assignee"
              v-model="assigneeId"
              data-testid="task-assignee-select"
              class="touch-target w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 cursor-pointer"
            >
              <option :value="null">Unassigned</option>
              <option v-for="p in availablePeople" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select>

            <p v-if="availablePeople.length === 0" class="text-xs text-gray-400 mt-1">
              No active people available. You can clear the current assignment.
            </p>

            <!-- Recurring: choose whether assignment applies to this occurrence or the whole series -->
            <div v-if="type === 'recurring'" class="mt-2">
              <div class="grid grid-cols-2 gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  type="button"
                  data-testid="assign-scope-series"
                  class="touch-target px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer"
                  :class="assignmentScope === 'series'
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-transparent text-gray-600 hover:bg-white'"
                  :aria-pressed="assignmentScope === 'series'"
                  @click="assignmentScope = 'series'"
                >
                  Whole series
                </button>
                <button
                  type="button"
                  data-testid="assign-scope-occurrence"
                  class="touch-target px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer"
                  :class="assignmentScope === 'occurrence'
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-transparent text-gray-600 hover:bg-white'"
                  :aria-pressed="assignmentScope === 'occurrence'"
                  @click="assignmentScope = 'occurrence'"
                >
                  This time only
                </button>
              </div>
              <p class="text-xs text-gray-400 mt-1">
                {{ assignmentScope === 'occurrence'
                  ? 'Applies to the current occurrence; reverts after completion.'
                  : 'Applies to every occurrence going forward.' }}
              </p>
            </div>
          </div>

          <!-- Dependency (optional) -->
          <div>
            <label for="depends-on" class="block text-sm font-medium text-gray-700 mb-1">
              Depends On <span class="text-xs text-gray-500 font-normal">(optional)</span>
            </label>
            <select
              id="depends-on"
              v-model="dependsOnId"
              data-testid="task-depends-on-select"
              class="touch-target w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 cursor-pointer"
            >
              <option :value="undefined">None</option>
              <option v-for="t in availableDependencies" :key="t.id" :value="t.id">
                {{ t.name }}
              </option>
            </select>
          </div>
        </form>
      </div>

      <!-- Sticky Footer (always visible) -->
      <div class="sticky bottom-0 flex-shrink-0 border-t bg-white px-4 py-3 flex gap-3 rounded-b-2xl sm:rounded-b-2xl z-10">
        <button
          type="button"
          class="touch-target flex-1 px-4 py-3 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 cursor-pointer transition-colors"
          @click="handleCancel"
        >
          Cancel
        </button>
        <button
          type="submit"
          form="task-form"
          data-testid="task-submit-button"
          :disabled="isSubmitting"
          class="touch-target flex-1 px-4 py-3 btn-primary rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {{ isSubmitting ? 'Saving...' : submitText }}
        </button>
      </div>
    </div>
  </div>
</template>
