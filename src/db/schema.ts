/**
 * Database Schema - Dexie.js schema definitions
 * Per data-model.md specification
 *
 * Index Strategy:
 * - [status+type]: Filter active/completed tasks by type
 * - [recurringPattern.nextDueDate+status]: Query active recurring tasks by due date
 * - dependsOnId: Quickly find tasks that depend on a given task
 * - deletedAt: Filter soft-deleted tasks
 */

import type { Priority } from '@/types/task'

/**
 * Schema version 1 - UUID-based IDs with soft delete support
 *
 * Note: Tasks use string UUIDs as primary keys (not auto-increment).
 * UUIDs are generated in the store layer using crypto.randomUUID().
 */
export const SCHEMA_VERSION_1 = {
  tasks:
    'id, name, type, status, deadline, [status+type], dependsOnId, recurringPattern.nextDueDate, [recurringPattern.nextDueDate+status], effortLevel, location, deletedAt',
  suggestionSessions: '++id, timestamp',
  syncState: 'id'
} as const

/**
 * Schema version 2 - Priority changed from number (0-10) to enum
 * Migration converts: 0-3 -> 'optional', 4-7 -> 'important', 8-10 -> 'critical'
 */
export const SCHEMA_VERSION_2 = {
  ...SCHEMA_VERSION_1
} as const

/**
 * Schema version 3 - People & task assignment
 * - Adds the `people` table
 * - Adds an `assigneeId` index on tasks (additive; existing rows need no migration)
 */
export const SCHEMA_VERSION_3 = {
  tasks:
    'id, name, type, status, deadline, [status+type], dependsOnId, recurringPattern.nextDueDate, [recurringPattern.nextDueDate+status], effortLevel, location, deletedAt, assigneeId',
  suggestionSessions: '++id, timestamp',
  syncState: 'id',
  people: 'id, name, deletedAt'
} as const

/**
 * Current schema version
 */
export const CURRENT_SCHEMA_VERSION = 3

/**
 * Convert numeric priority (0-10) to Priority enum
 */
export function migrateNumericPriority(numericPriority: number): Priority {
  if (numericPriority >= 8) return 'critical'
  if (numericPriority >= 4) return 'important'
  return 'optional'
}

/**
 * Get schema for a specific version
 */
export function getSchemaForVersion(version: number): Record<string, string> {
  switch (version) {
    case 1:
      return { ...SCHEMA_VERSION_1 }
    case 2:
      return { ...SCHEMA_VERSION_2 }
    case 3:
      return { ...SCHEMA_VERSION_3 }
    default:
      throw new Error(`Unknown schema version: ${version}`)
  }
}
