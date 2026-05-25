/**
 * Validation Utilities
 * Task validation and dependency checking per data-model.md
 */

import type { CreateTaskInput, Task, EffortLevel, Location, TaskType, Priority } from '@/types/task'
import type { CreatePersonInput } from '@/types/person'
import { PERSON_COLOR_KEYS } from '@/utils/personColors'

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  sanitizedInput?: CreateTaskInput
}

/**
 * Validation rules per data-model.md
 */
export const TaskValidation = {
  name: {
    minLength: 1,
    maxLength: 200,
    required: true
  },
  timeEstimateMinutes: {
    min: 1,
    max: 480, // 8 hours
    required: true
  },
  effortLevel: {
    values: ['low', 'medium', 'high'] as EffortLevel[],
    required: true
  },
  location: {
    values: ['home', 'outside', 'anywhere'] as Location[],
    required: true
  },
  priority: {
    values: ['optional', 'important', 'critical'] as Priority[],
    default: 'important' as Priority,
    required: true
  },
  type: {
    values: ['one-off', 'recurring', 'project'] as TaskType[],
    required: true
  },
  recurringPattern: {
    intervalValue: {
      min: 1,
      max: 999
    },
    intervalUnit: {
      values: ['hours', 'days', 'weeks', 'months', 'years']
    }
  },
  projectSession: {
    minSessionDurationMinutes: {
      min: 1,
      max: 480
    }
  }
} as const

/**
 * Person validation rules
 */
export const PersonValidation = {
  name: { minLength: 1, maxLength: 50, required: true }
} as const

/**
 * Validate a person input
 *
 * @param input - CreatePersonInput to validate
 * @returns ValidationResult with errors if invalid
 */
export function validatePerson(input: CreatePersonInput): ValidationResult {
  const errors: string[] = []

  if (!input.name || typeof input.name !== 'string' || input.name.trim().length === 0) {
    errors.push('Name is required')
  } else if (input.name.trim().length > PersonValidation.name.maxLength) {
    errors.push('Name must be 50 characters or less')
  }

  if (!input.color || !PERSON_COLOR_KEYS.includes(input.color)) {
    errors.push('A valid color is required')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Validate a task input
 *
 * @param input - CreateTaskInput to validate
 * @returns ValidationResult with errors if invalid
 */
export function validateTask(input: CreateTaskInput): ValidationResult {
  const errors: string[] = []

  // Name validation
  if (!input.name || typeof input.name !== 'string') {
    errors.push('Task name is required')
  } else if (input.name.length < TaskValidation.name.minLength) {
    errors.push('Task name must be at least 1 character')
  } else if (input.name.length > TaskValidation.name.maxLength) {
    errors.push('Task name must be 200 characters or less')
  }

  // Type validation
  if (!input.type) {
    errors.push('Task type is required')
  } else if (!TaskValidation.type.values.includes(input.type)) {
    errors.push('Task type must be one-off, recurring, or project')
  }

  // Time estimate validation
  if (input.timeEstimateMinutes === undefined || input.timeEstimateMinutes === null) {
    errors.push('Time estimate is required')
  } else if (
    input.timeEstimateMinutes < TaskValidation.timeEstimateMinutes.min ||
    input.timeEstimateMinutes > TaskValidation.timeEstimateMinutes.max
  ) {
    errors.push('Time estimate must be between 1 and 480 minutes')
  }

  // Effort level validation
  if (!input.effortLevel) {
    errors.push('Effort level is required')
  } else if (!TaskValidation.effortLevel.values.includes(input.effortLevel)) {
    errors.push('Effort level must be low, medium, or high')
  }

  // Location validation
  if (!input.location) {
    errors.push('Location is required')
  } else if (!TaskValidation.location.values.includes(input.location)) {
    errors.push('Location must be home, outside, or anywhere')
  }

  // Priority validation
  if (!input.priority) {
    errors.push('Priority is required')
  } else if (!TaskValidation.priority.values.includes(input.priority)) {
    errors.push('Priority must be optional, important, or critical')
  }

  // Recurring pattern validation (if provided)
  if (input.recurringPattern) {
    const { intervalValue, intervalUnit } = input.recurringPattern

    if (
      intervalValue < TaskValidation.recurringPattern.intervalValue.min ||
      intervalValue > TaskValidation.recurringPattern.intervalValue.max
    ) {
      errors.push('Recurring interval value must be between 1 and 999')
    }

    if (!TaskValidation.recurringPattern.intervalUnit.values.includes(intervalUnit)) {
      errors.push('Recurring interval unit must be hours, days, weeks, months, or years')
    }

    // Recurring tasks require a pattern
    if (input.type === 'recurring' && !input.recurringPattern.lastCompletedDate) {
      errors.push('Recurring tasks require a last completed date')
    }
  } else if (input.type === 'recurring') {
    errors.push('Recurring tasks require a recurring pattern')
  }

  // Project session validation (if provided)
  if (input.projectSession) {
    const { minSessionDurationMinutes } = input.projectSession

    if (
      minSessionDurationMinutes < TaskValidation.projectSession.minSessionDurationMinutes.min ||
      minSessionDurationMinutes > TaskValidation.projectSession.minSessionDurationMinutes.max
    ) {
      errors.push('Minimum session duration must be between 1 and 480 minutes')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitizedInput: errors.length === 0 ? input : undefined
  }
}

/**
 * Check for circular dependencies in task chain
 * Returns true if adding dependsOnId would create a circular dependency
 *
 * @param taskId - ID of task being checked (or undefined for new task)
 * @param dependsOnId - ID of task this task would depend on
 * @param allTasks - All tasks in the system
 * @returns true if circular dependency would be created
 */
export function detectCircularDependency(
  taskId: string | undefined,
  dependsOnId: string,
  allTasks: Task[]
): boolean {
  // If no taskId (new task), can't have circular dependency pointing to itself
  if (taskId === undefined) {
    return false
  }

  // Can't depend on yourself
  if (taskId === dependsOnId) {
    return true
  }

  // Build a map for quick lookup
  const taskMap = new Map<string, Task>()
  for (const task of allTasks) {
    if (task.id !== undefined) {
      taskMap.set(task.id, task)
    }
  }

  // Follow the dependency chain from dependsOnId
  // If we find taskId, there's a cycle
  const visited = new Set<string>()
  let currentId: string | undefined = dependsOnId

  while (currentId !== undefined) {
    // If we've seen this task, there's a cycle (not involving our task, but still a problem)
    if (visited.has(currentId)) {
      return true
    }

    // If we found our task in the chain, adding this dependency would create a cycle
    if (currentId === taskId) {
      return true
    }

    visited.add(currentId)

    const currentTask = taskMap.get(currentId)
    currentId = currentTask?.dependsOnId
  }

  return false
}

/**
 * Storage quota estimate
 */
export interface StorageEstimate {
  usage: number
  quota: number
  percentUsed: number
  shouldWarn: boolean
}

/**
 * Check storage quota and warn if approaching limit
 * Per data-model.md - warn at 80% usage
 *
 * @returns StorageEstimate with usage information
 */
export async function checkStorageQuota(): Promise<StorageEstimate> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    try {
      const estimate = await navigator.storage.estimate()
      const usage = estimate.usage ?? 0
      const quota = estimate.quota ?? 0
      const percentUsed = quota > 0 ? (usage / quota) * 100 : 0

      return {
        usage,
        quota,
        percentUsed,
        shouldWarn: percentUsed > 80
      }
    } catch {
      // Storage API not available or failed
      return { usage: 0, quota: 0, percentUsed: 0, shouldWarn: false }
    }
  }

  return { usage: 0, quota: 0, percentUsed: 0, shouldWarn: false }
}

/**
 * Format bytes to human-readable string
 *
 * @param bytes - Number of bytes
 * @returns Human-readable string (e.g., "5.2 MB")
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}
