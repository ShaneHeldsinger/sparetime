/**
 * Database - Dexie.js IndexedDB wrapper
 * Per data-model.md specification
 *
 * This is the main database module providing:
 * - Database class extending Dexie
 * - Typed tables for Task, SuggestionSession, SyncState
 * - Schema versioning with migration support
 */

import Dexie, { type Table } from 'dexie'
import type { Task } from '@/types/task'
import type { Person } from '@/types/person'
import type { SuggestionSession } from '@/types/suggestion'
import type { SyncState } from '@/types/sync'
import { SCHEMA_VERSION_1, SCHEMA_VERSION_2, SCHEMA_VERSION_3, CURRENT_SCHEMA_VERSION, migrateNumericPriority } from './schema'

/**
 * SpareTime Database class
 * Extends Dexie to provide typed table access
 */
export class SparetimeDatabase extends Dexie {
  /** Tasks table - uses string UUID as primary key */
  tasks!: Table<Task, string>

  /** Suggestion sessions table */
  suggestionSessions!: Table<SuggestionSession, number>

  /** Sync state table (singleton) */
  syncState!: Table<SyncState, number>

  /** People table - uses string UUID as primary key */
  people!: Table<Person, string>

  constructor() {
    super('SparetimeDB')

    // Version 1 - UUID-based IDs with soft delete support
    this.version(1).stores(SCHEMA_VERSION_1)

    // Version 2 - Priority changed from number to enum
    this.version(2)
      .stores(SCHEMA_VERSION_2)
      .upgrade(async (trans) => {
        // Migrate all tasks: convert numeric priority to enum
        await trans.table('tasks').toCollection().modify((task: { priority: number | string }) => {
          if (typeof task.priority === 'number') {
            task.priority = migrateNumericPriority(task.priority)
          }
        })
      })

    // Version 3 - People & task assignment (additive: new table + index, no data migration)
    this.version(3).stores(SCHEMA_VERSION_3)
  }
}

/**
 * Singleton database instance
 * Use this throughout the app for database access
 */
export const db = new SparetimeDatabase()

/**
 * Initialize the database
 * Opens the database connection and ensures tables are ready
 *
 * @returns Promise that resolves when database is ready
 */
export async function initializeDatabase(): Promise<void> {
  try {
    await db.open()
    console.log('Database initialized successfully')
  } catch (error) {
    console.error('Failed to initialize database:', error)
    throw error
  }
}

/**
 * Close the database connection
 * Call this when the app is shutting down
 */
export async function closeDatabase(): Promise<void> {
  await db.close()
}

/**
 * Clear all data from the database
 * WARNING: This deletes all tasks, sessions, and sync state
 *
 * @returns Promise that resolves when all tables are cleared
 */
export async function clearAllData(): Promise<void> {
  await db.transaction('rw', [db.tasks, db.suggestionSessions, db.syncState, db.people], async () => {
    await db.tasks.clear()
    await db.suggestionSessions.clear()
    await db.syncState.clear()
    await db.people.clear()
  })
}

/**
 * Get database statistics
 *
 * @returns Object with counts for each table
 */
export async function getDatabaseStats(): Promise<{
  taskCount: number
  sessionCount: number
  hasSyncState: boolean
}> {
  const [taskCount, sessionCount, syncStateCount] = await Promise.all([
    db.tasks.count(),
    db.suggestionSessions.count(),
    db.syncState.count()
  ])

  return {
    taskCount,
    sessionCount,
    hasSyncState: syncStateCount > 0
  }
}

/**
 * Export all data as JSON
 * Per FR-013 requirement
 *
 * @returns Object containing all data
 */
export async function exportAllData(): Promise<{
  version: number
  exportTimestamp: string
  tasks: Task[]
  people: Person[]
  suggestionSessions: SuggestionSession[]
}> {
  const [tasks, people, suggestionSessions] = await Promise.all([
    db.tasks.toArray(),
    db.people.toArray(),
    db.suggestionSessions.toArray()
  ])

  return {
    version: CURRENT_SCHEMA_VERSION,
    exportTimestamp: new Date().toISOString(),
    tasks,
    people,
    suggestionSessions
  }
}

// Re-export types for convenience
export type { Task } from '@/types/task'
export type { Person } from '@/types/person'
export type { SuggestionSession } from '@/types/suggestion'
export type { SyncState } from '@/types/sync'
