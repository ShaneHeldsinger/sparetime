<script setup lang="ts">
/**
 * PeopleManager - Settings section to add / edit / delete people.
 * People are used as task assignees.
 */
import { ref, computed } from 'vue'
import { usePeopleStore } from '@/stores/peopleStore'
import { PERSON_COLORS, nextPersonColor } from '@/utils/personColors'
import PersonAvatar from './PersonAvatar.vue'

const peopleStore = usePeopleStore()

const people = computed(() => peopleStore.activePeople)
const usedColors = computed(() => people.value.map((p) => p.color))

// Add state
const showAdd = ref(false)
const newName = ref('')
const newColor = ref(nextPersonColor([]))
const addError = ref('')

// Edit state
const editingId = ref<string | null>(null)
const editName = ref('')
const editColor = ref('')
const editError = ref('')

// Delete confirmation
const confirmingDeleteId = ref<string | null>(null)

function openAdd() {
  showAdd.value = true
  newName.value = ''
  newColor.value = nextPersonColor(usedColors.value)
  addError.value = ''
}

function cancelAdd() {
  showAdd.value = false
  addError.value = ''
}

async function submitAdd() {
  addError.value = ''
  const person = await peopleStore.create({ name: newName.value, color: newColor.value })
  if (person) {
    showAdd.value = false
    newName.value = ''
  } else {
    addError.value = peopleStore.error || 'Could not add person'
  }
}

function startEdit(id: string, name: string, color: string) {
  editingId.value = id
  editName.value = name
  editColor.value = color
  editError.value = ''
  confirmingDeleteId.value = null
}

function cancelEdit() {
  editingId.value = null
  editError.value = ''
}

async function submitEdit(id: string) {
  editError.value = ''
  const updated = await peopleStore.update({ id, name: editName.value, color: editColor.value })
  if (updated) {
    editingId.value = null
  } else {
    editError.value = peopleStore.error || 'Could not save changes'
  }
}

async function confirmDelete(id: string) {
  await peopleStore.remove(id)
  confirmingDeleteId.value = null
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-3">
      <div>
        <h3 class="text-base font-semibold text-gray-900">People</h3>
        <p class="text-xs text-gray-500">Add people you can assign tasks to</p>
      </div>
      <button
        v-if="!showAdd"
        type="button"
        class="btn btn-secondary text-sm px-3 py-1.5"
        data-testid="add-person-button"
        @click="openAdd"
      >
        Add Person
      </button>
    </div>

    <!-- Empty state -->
    <p v-if="people.length === 0 && !showAdd" class="text-sm text-gray-400 py-2">
      No people yet. Add someone to start assigning tasks.
    </p>

    <!-- People list -->
    <ul class="divide-y divide-gray-100">
      <li v-for="person in people" :key="person.id" class="py-2">
        <!-- Edit mode -->
        <div v-if="editingId === person.id" class="space-y-2">
          <input
            v-model="editName"
            type="text"
            maxlength="50"
            class="touch-target w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            @keydown.enter="submitEdit(person.id)"
          />
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="c in PERSON_COLORS"
              :key="c.key"
              type="button"
              :aria-label="c.label"
              class="w-7 h-7 rounded-full transition-transform"
              :class="[c.bgClass, editColor === c.key ? 'ring-2 ring-offset-2 ring-gray-800 scale-110' : '']"
              @click="editColor = c.key"
            />
          </div>
          <p v-if="editError" class="text-xs text-red-600">{{ editError }}</p>
          <div class="flex gap-2">
            <button type="button" class="btn btn-ghost text-sm px-3 py-1.5" @click="cancelEdit">Cancel</button>
            <button type="button" class="btn-primary text-sm px-3 py-1.5 rounded-lg" @click="submitEdit(person.id)">
              Save
            </button>
          </div>
        </div>

        <!-- Display mode -->
        <div v-else class="flex items-center justify-between gap-2">
          <PersonAvatar :person="person" size="md" :show-name="true" />
          <div class="flex items-center gap-1 flex-shrink-0">
            <template v-if="confirmingDeleteId === person.id">
              <span class="text-xs text-gray-500 mr-1">
                <template v-if="peopleStore.assignedTaskCount(person.id) > 0">
                  Assigned to {{ peopleStore.assignedTaskCount(person.id) }}
                  {{ peopleStore.assignedTaskCount(person.id) === 1 ? 'task' : 'tasks' }}.
                  Remove and unassign?
                </template>
                <template v-else>Remove?</template>
              </span>
              <button type="button" class="btn btn-ghost text-sm px-2 py-1" @click="confirmingDeleteId = null">
                No
              </button>
              <button
                type="button"
                class="btn-danger text-sm px-2 py-1"
                data-testid="confirm-delete-person"
                @click="confirmDelete(person.id)"
              >
                Yes
              </button>
            </template>
            <template v-else>
              <button
                type="button"
                class="p-1.5 text-gray-400 hover:text-gray-700 rounded"
                :aria-label="`Edit ${person.name}`"
                @click="startEdit(person.id, person.name, person.color)"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                type="button"
                class="p-1.5 text-gray-400 hover:text-red-600 rounded"
                :aria-label="`Remove ${person.name}`"
                @click="confirmingDeleteId = person.id"
              >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </template>
          </div>
        </div>
      </li>
    </ul>

    <!-- Add form -->
    <div v-if="showAdd" class="mt-2 pt-3 border-t border-gray-100 space-y-2">
      <input
        v-model="newName"
        type="text"
        maxlength="50"
        placeholder="Name"
        data-testid="new-person-name"
        class="touch-target w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
        @keydown.enter="submitAdd"
      />
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="c in PERSON_COLORS"
          :key="c.key"
          type="button"
          :aria-label="c.label"
          class="w-7 h-7 rounded-full transition-transform"
          :class="[c.bgClass, newColor === c.key ? 'ring-2 ring-offset-2 ring-gray-800 scale-110' : '']"
          @click="newColor = c.key"
        />
      </div>
      <p v-if="addError" class="text-xs text-red-600">{{ addError }}</p>
      <div class="flex gap-2">
        <button type="button" class="btn btn-ghost text-sm px-3 py-1.5" @click="cancelAdd">Cancel</button>
        <button
          type="button"
          class="btn-primary text-sm px-3 py-1.5 rounded-lg"
          data-testid="save-person-button"
          @click="submitAdd"
        >
          Add
        </button>
      </div>
    </div>
  </div>
</template>
