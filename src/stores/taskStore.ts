/**
 * Task Store - Pinia state management for tasks
 * Per plan.md - handles task CRUD operations with IndexedDB persistence
 */

import { defineStore } from 'pinia'
import { ref, computed, toRaw } from 'vue'
import { db } from '@/db/database'
import type { Task, TaskStatus, TaskType, CreateTaskInput, UpdateTaskInput } from '@/types/task'
import { validateTask, detectCircularDependency } from '@/utils/validation'
import { calculateNextDueDateFromPattern, nowISO } from '@/utils/dateHelpers'
import { useSyncStore } from '@/stores/syncStore'

/**
 * Generate a UUID for new tasks
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback: generate UUID v4 using getRandomValues
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Task store for managing task state and operations
 */
export const useTaskStore = defineStore('task', () => {
  // State
  const tasks = ref<Task[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Getters - filter out soft-deleted tasks
  const activeTasks = computed(() =>
    tasks.value.filter((t) => t.status === 'active' && !t.deletedAt)
  )

  const completedTasks = computed(() =>
    tasks.value.filter((t) => t.status === 'completed' && !t.deletedAt)
  )

  const archivedTasks = computed(() =>
    tasks.value.filter((t) => t.status === 'archived' && !t.deletedAt)
  )

  const tasksByType = computed(
    () => (type: TaskType) => tasks.value.filter((t) => t.type === type && !t.deletedAt)
  )

  const taskById = computed(() => (id: string) => tasks.value.find((t) => t.id === id))

  const taskCount = computed(() => tasks.value.filter((t) => !t.deletedAt).length)

  const activeTaskCount = computed(() => activeTasks.value.length)

  // Actions

  /**
   * Load all tasks from IndexedDB
   */
  async function loadTasks(): Promise<void> {
    loading.value = true
    error.value = null

    try {
      tasks.value = await db.tasks.toArray()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load tasks'
      console.error('Failed to load tasks:', e)
    } finally {
      loading.value = false
    }
  }

  /**
   * Create a new task
   *
   * @param input - Task creation input
   * @returns Created task or undefined if validation fails
   */
  async function create(input: CreateTaskInput): Promise<Task | undefined> {
    loading.value = true
    error.value = null

    try {
      // Validate input
      const validation = validateTask(input)
      if (!validation.valid) {
        error.value = validation.errors.join(', ')
        return undefined
      }

      // Check for circular dependency
      if (input.dependsOnId !== undefined) {
        if (detectCircularDependency(undefined, input.dependsOnId, tasks.value)) {
          error.value = 'Circular dependency detected'
          return undefined
        }
      }

      // Generate UUID for new task
      const id = generateUUID()

      // Build the task object
      const now = nowISO()
      const task: Task = {
        id,
        name: input.name,
        type: input.type,
        timeEstimateMinutes: input.timeEstimateMinutes,
        effortLevel: input.effortLevel,
        location: input.location,
        status: 'active',
        priority: input.priority,
        deadline: input.deadline?.toISOString(),
        dependsOnId: input.dependsOnId,
        assigneeId: input.assigneeId,
        occurrenceAssigneeId: input.occurrenceAssigneeId,
        createdAt: now,
        updatedAt: now
      }

      // Add recurring pattern with computed nextDueDate
      if (input.recurringPattern) {
        task.recurringPattern = {
          ...input.recurringPattern,
          nextDueDate: calculateNextDueDateFromPattern(input.recurringPattern)
        }
      }

      // Add project session if provided
      if (input.projectSession) {
        task.projectSession = input.projectSession
      }

      // Save to IndexedDB
      await db.tasks.add(task)

      // Update local state
      tasks.value.push(task)

      // Track pending change for sync
      const syncStore = useSyncStore()
      if (syncStore.isBackupEnabled) {
        await syncStore.addPendingChange(id, 'create', toRaw(task))
        syncStore.scheduleDebouncedSync()
      }

      return task
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create task'
      console.error('Failed to create task:', e)
      return undefined
    } finally {
      loading.value = false
    }
  }

  /**
   * Update an existing task
   *
   * @param input - Task update input (id required, other fields optional)
   * @returns Updated task or undefined if not found/validation fails
   */
  async function update(input: UpdateTaskInput): Promise<Task | undefined> {
    loading.value = true
    error.value = null

    try {
      const existingTask = tasks.value.find((t) => t.id === input.id)
      if (!existingTask) {
        error.value = 'Task not found'
        return undefined
      }

      // Check for circular dependency if dependsOnId is being changed
      if (input.dependsOnId !== undefined && input.dependsOnId !== existingTask.dependsOnId) {
        if (detectCircularDependency(input.id, input.dependsOnId, tasks.value)) {
          error.value = 'Circular dependency detected'
          return undefined
        }
      }

      // Build update object
      const updates: Partial<Task> = {
        updatedAt: nowISO()
      }

      if (input.name !== undefined) updates.name = input.name
      if (input.type !== undefined) {
        updates.type = input.type
        // Clear type-specific fields when changing type
        if (input.type !== 'recurring') {
          updates.recurringPattern = undefined
          // Occurrence overrides only make sense for recurring tasks
          updates.occurrenceAssigneeId = undefined
        }
        if (input.type !== 'project') {
          updates.projectSession = undefined
        }
      }
      if (input.timeEstimateMinutes !== undefined)
        updates.timeEstimateMinutes = input.timeEstimateMinutes
      if (input.effortLevel !== undefined) updates.effortLevel = input.effortLevel
      if (input.location !== undefined) updates.location = input.location
      if (input.priority !== undefined) updates.priority = input.priority
      if (input.dependsOnId !== undefined) updates.dependsOnId = input.dependsOnId
      // Assignment fields: use `in` so an explicit undefined clears the value
      // (Dexie deletes a property set to undefined), while callers that omit the
      // key entirely — e.g. complete() — leave the assignee untouched.
      if ('assigneeId' in input) updates.assigneeId = input.assigneeId
      if ('occurrenceAssigneeId' in input) updates.occurrenceAssigneeId = input.occurrenceAssigneeId

      // Handle deadline - can be Date, string, or undefined
      if (input.deadline !== undefined) {
        updates.deadline =
          input.deadline instanceof Date ? input.deadline.toISOString() : input.deadline
      }

      // Handle recurring pattern update (use toRaw to avoid proxy issues)
      if (input.recurringPattern !== undefined) {
        updates.recurringPattern = {
          ...toRaw(input.recurringPattern),
          nextDueDate: calculateNextDueDateFromPattern(input.recurringPattern)
        }
      }

      // Handle project session update (use toRaw to avoid proxy issues)
      if (input.projectSession !== undefined) {
        updates.projectSession = toRaw(input.projectSession)
      }

      // Update in IndexedDB
      await db.tasks.update(input.id, updates)

      // Update local state
      const index = tasks.value.findIndex((t) => t.id === input.id)
      if (index !== -1) {
        tasks.value[index] = { ...tasks.value[index], ...updates }
        
        // Track pending change for sync
        const syncStore = useSyncStore()
        if (syncStore.isBackupEnabled) {
          await syncStore.addPendingChange(input.id, 'update', toRaw(tasks.value[index]))
          syncStore.scheduleDebouncedSync()
        }
        
        return tasks.value[index]
      }

      return undefined
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update task'
      console.error('Failed to update task:', e)
      return undefined
    } finally {
      loading.value = false
    }
  }

  /**
   * Delete a task (soft delete - sets deletedAt timestamp)
   *
   * @param id - Task ID to delete
   * @returns true if deleted, false otherwise
   */
  async function remove(id: string): Promise<boolean> {
    loading.value = true
    error.value = null

    try {
      const now = nowISO()
      
      // Soft delete: set deletedAt timestamp
      await db.tasks.update(id, { deletedAt: now, updatedAt: now })

      // Update local state
      const index = tasks.value.findIndex((t) => t.id === id)
      if (index !== -1) {
        tasks.value[index] = { ...tasks.value[index], deletedAt: now, updatedAt: now }

        // Track pending change for sync
        const syncStore = useSyncStore()
        if (syncStore.isBackupEnabled) {
          await syncStore.addPendingChange(id, 'delete', toRaw(tasks.value[index]))
          syncStore.scheduleDebouncedSync()
        }

        return true
      }

      return false
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete task'
      console.error('Failed to delete task:', e)
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Mark a task as complete
   * For recurring tasks, this updates lastCompletedDate and calculates next due date
   *
   * @param id - Task ID to complete
   * @returns Updated task or undefined if not found
   */
  async function complete(id: string): Promise<Task | undefined> {
    const task = tasks.value.find((t) => t.id === id)
    if (!task) {
      error.value = 'Task not found'
      return undefined
    }

    const now = nowISO()

    if (task.type === 'recurring' && task.recurringPattern) {
      // For recurring tasks: reset with new due date calculated from completion time
      const rawPattern = toRaw(task.recurringPattern)
      const updatedPattern = {
        ...rawPattern,
        lastCompletedDate: now,
        nextDueDate: calculateNextDueDateFromPattern({
          ...rawPattern,
          lastCompletedDate: now
        })
      }

      return update({
        id,
        // Advancing to the next occurrence: drop the one-time override so the
        // task reverts to its series-default assignee.
        occurrenceAssigneeId: undefined,
        recurringPattern: {
          intervalValue: updatedPattern.intervalValue,
          intervalUnit: updatedPattern.intervalUnit,
          lastCompletedDate: updatedPattern.lastCompletedDate
        }
      })
    } else {
      // For one-off and project tasks: mark as completed
      return updateStatus(id, 'completed')
    }
  }

  /**
   * Update task status
   *
   * @param id - Task ID
   * @param status - New status
   * @returns Updated task or undefined if not found
   */
  async function updateStatus(id: string, status: TaskStatus): Promise<Task | undefined> {
    loading.value = true
    error.value = null

    try {
      const now = nowISO()

      await db.tasks.update(id, { status, updatedAt: now })

      const index = tasks.value.findIndex((t) => t.id === id)
      if (index !== -1) {
        tasks.value[index] = { ...tasks.value[index], status, updatedAt: now }
        
        // Track pending change for sync
        const syncStore = useSyncStore()
        if (syncStore.isBackupEnabled) {
          await syncStore.addPendingChange(id, 'update', toRaw(tasks.value[index]))
          syncStore.scheduleDebouncedSync()
        }
        
        return tasks.value[index]
      }

      return undefined
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update task status'
      console.error('Failed to update task status:', e)
      return undefined
    } finally {
      loading.value = false
    }
  }

  /**
   * Get task by ID (async version that checks IndexedDB)
   *
   * @param id - Task ID
   * @returns Task or undefined if not found
   */
  async function getById(id: string): Promise<Task | undefined> {
    // First check local state
    const cached = tasks.value.find((t) => t.id === id)
    if (cached) return cached

    // Fall back to IndexedDB
    try {
      return await db.tasks.get(id)
    } catch (e) {
      console.error('Failed to get task by ID:', e)
      return undefined
    }
  }

  /**
   * Check if a task has incomplete dependencies
   *
   * @param taskId - Task ID to check
   * @returns true if task has incomplete dependencies
   */
  function hasIncompleteDependencies(taskId: string): boolean {
    const task = tasks.value.find((t) => t.id === taskId)
    if (!task || !task.dependsOnId) return false

    const dependency = tasks.value.find((t) => t.id === task.dependsOnId)
    if (!dependency) return false

    return dependency.status !== 'completed'
  }

  /**
   * Permanently delete soft-deleted tasks older than the retention period
   * Default retention is 30 days
   *
   * @param retentionDays - Number of days to retain soft-deleted tasks (default: 30)
   * @returns Number of tasks permanently deleted
   */
  async function cleanupDeletedTasks(retentionDays = 30): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
    const cutoffISO = cutoffDate.toISOString()

    // Find all soft-deleted tasks older than cutoff
    const tasksToDelete = tasks.value.filter(
      (t) => t.deletedAt && t.deletedAt < cutoffISO
    )

    if (tasksToDelete.length === 0) {
      return 0
    }

    // Permanently delete from IndexedDB
    const idsToDelete = tasksToDelete.map((t) => t.id)
    await db.tasks.bulkDelete(idsToDelete)

    // Remove from local state
    tasks.value = tasks.value.filter((t) => !idsToDelete.includes(t.id))

    console.log(`Cleaned up ${idsToDelete.length} soft-deleted tasks older than ${retentionDays} days`)
    return idsToDelete.length
  }

  return {
    // State
    tasks,
    loading,
    error,

    // Getters
    activeTasks,
    completedTasks,
    archivedTasks,
    tasksByType,
    taskById,
    taskCount,
    activeTaskCount,

    // Actions
    loadTasks,
    create,
    update,
    remove,
    complete,
    updateStatus,
    getById,
    hasIncompleteDependencies,
    cleanupDeletedTasks
  }
})
