/**
 * People Store - Pinia state management for people and task assignment
 * Mirrors taskStore.ts: IndexedDB persistence with soft delete + sync nudge.
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/db/database'
import type { Person, CreatePersonInput, UpdatePersonInput } from '@/types/person'
import type { Task } from '@/types/task'
import { validatePerson } from '@/utils/validation'
import { nowISO } from '@/utils/dateHelpers'
import { useSyncStore } from '@/stores/syncStore'
import { useTaskStore } from '@/stores/taskStore'

/**
 * Generate a UUID for new people
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * People store for managing person records used as task assignees
 */
export const usePeopleStore = defineStore('people', () => {
  // State
  const people = ref<Person[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Getters - exclude soft-deleted people
  const activePeople = computed(() => people.value.filter((p) => !p.deletedAt))

  const personById = computed(() => (id: string | undefined) =>
    id ? people.value.find((p) => p.id === id) : undefined
  )

  /** Nudge a debounced backup if cloud sync is enabled (people ride along in the payload). */
  function scheduleSync(): void {
    const syncStore = useSyncStore()
    if (syncStore.isBackupEnabled) {
      syncStore.scheduleDebouncedSync()
    }
  }

  /**
   * Load all people from IndexedDB
   */
  async function loadPeople(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      people.value = await db.people.toArray()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load people'
      console.error('Failed to load people:', e)
    } finally {
      loading.value = false
    }
  }

  /**
   * Create a new person
   */
  async function create(input: CreatePersonInput): Promise<Person | undefined> {
    loading.value = true
    error.value = null

    try {
      const validation = validatePerson(input)
      if (!validation.valid) {
        error.value = validation.errors.join(', ')
        return undefined
      }

      const now = nowISO()
      const person: Person = {
        id: generateUUID(),
        name: input.name.trim(),
        color: input.color,
        createdAt: now,
        updatedAt: now
      }

      await db.people.add(person)
      people.value.push(person)
      scheduleSync()

      return person
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create person'
      console.error('Failed to create person:', e)
      return undefined
    } finally {
      loading.value = false
    }
  }

  /**
   * Update an existing person
   */
  async function update(input: UpdatePersonInput): Promise<Person | undefined> {
    loading.value = true
    error.value = null

    try {
      const existing = people.value.find((p) => p.id === input.id)
      if (!existing) {
        error.value = 'Person not found'
        return undefined
      }

      const validation = validatePerson({
        name: input.name ?? existing.name,
        color: input.color ?? existing.color
      })
      if (!validation.valid) {
        error.value = validation.errors.join(', ')
        return undefined
      }

      const updates: Partial<Person> = { updatedAt: nowISO() }
      if (input.name !== undefined) updates.name = input.name.trim()
      if (input.color !== undefined) updates.color = input.color

      await db.people.update(input.id, updates)

      const index = people.value.findIndex((p) => p.id === input.id)
      if (index !== -1) {
        people.value[index] = { ...people.value[index], ...updates }
        scheduleSync()
        return people.value[index]
      }
      return undefined
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update person'
      console.error('Failed to update person:', e)
      return undefined
    } finally {
      loading.value = false
    }
  }

  /**
   * Count active (non-deleted) tasks assigned to a given person.
   * Checks both assigneeId and occurrenceAssigneeId.
   */
  function assignedTaskCount(id: string): number {
    const taskStore = useTaskStore()
    return taskStore.tasks.filter(
      (t) => !t.deletedAt && (t.assigneeId === id || t.occurrenceAssigneeId === id)
    ).length
  }

  /**
   * Delete a person (soft delete - sets deletedAt timestamp) and clear that
   * person from any tasks they were assigned to.
   */
  async function remove(id: string): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      const now = nowISO()
      const index = people.value.findIndex((p) => p.id === id)
      if (index === -1) {
        error.value = 'Person not found'
        return false
      }

      const taskStore = useTaskStore()
      const affectedTasks = taskStore.tasks.filter(
        (t) => !t.deletedAt && (t.assigneeId === id || t.occurrenceAssigneeId === id)
      )
      const taskUpdates = affectedTasks.map((task) => {
        const updates: Partial<Task> = { updatedAt: nowISO() }
        if (task.assigneeId === id) updates.assigneeId = undefined
        if (task.occurrenceAssigneeId === id) updates.occurrenceAssigneeId = undefined
        return { taskId: task.id, updates }
      })

      await db.transaction('rw', [db.people, db.tasks], async () => {
        await db.people.update(id, { deletedAt: now, updatedAt: now })
        for (const { taskId, updates } of taskUpdates) {
          await db.tasks.update(taskId, updates)
        }
      })

      people.value[index] = { ...people.value[index], deletedAt: now, updatedAt: now }
      for (const { taskId, updates } of taskUpdates) {
        const taskIndex = taskStore.tasks.findIndex((task) => task.id === taskId)
        if (taskIndex !== -1) {
          taskStore.tasks[taskIndex] = { ...taskStore.tasks[taskIndex], ...updates }
        }
      }

      scheduleSync()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete person'
      console.error('Failed to delete person:', e)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Get a person by ID (checks local state, then IndexedDB)
   */
  async function getById(id: string): Promise<Person | undefined> {
    const cached = people.value.find((p) => p.id === id)
    if (cached) return cached
    try {
      return await db.people.get(id)
    } catch (e) {
      console.error('Failed to get person by ID:', e)
      return undefined
    }
  }

  return {
    // State
    people,
    loading,
    error,

    // Getters
    activePeople,
    personById,

    // Actions
    loadPeople,
    create,
    update,
    remove,
    getById,
    assignedTaskCount
  }
})
