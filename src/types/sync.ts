/**
 * Sync Types - Interfaces for Google Drive backup/sync
 * Per data-model.md specification
 */

import type { Task } from './task'
import type { Person } from './person'

/**
 * Pending change queued for sync
 */
export interface PendingChange {
  /** Task ID that was changed */
  taskId: string
  /** Type of operation */
  operation: 'create' | 'update' | 'delete'
  /** Timestamp of change (ISO date string) */
  timestamp: string
  /** Task data (for create/update operations) */
  data?: Task
}

/**
 * Conflict between local and remote versions
 */
export interface SyncConflict {
  /** Task ID with conflict */
  taskId: string
  /** Local version of task */
  localData: Task
  /** Remote version of task */
  remoteData: Task
  /** Timestamp when conflict was detected */
  detectedAt: string
}

/**
 * Sync state stored in IndexedDB
 * Only one record exists (singleton pattern with id=1)
 */
export interface SyncState {
  /** Always 1 - only one sync state record */
  id: number
  /** OAuth access token (if backup enabled) */
  accessToken?: string
  /** Last successful sync timestamp (ISO date string) */
  lastSyncedAt?: string
  /** Queue of changes made while offline */
  pendingChanges: PendingChange[]
  /** Conflicts awaiting resolution */
  conflicts: SyncConflict[]
}

/**
 * Google Drive backup file format
 */
export interface GoogleDriveBackup {
  /** Schema version for forward compatibility */
  version: number
  /** Export timestamp (ISO date string) */
  exportTimestamp: string
  /** All tasks */
  tasks: Task[]
  /** All people (additive; not covered by checksum for backward compatibility) */
  people?: Person[]
  /** SHA-256 checksum for integrity verification (computed over tasks) */
  checksum: string
}
