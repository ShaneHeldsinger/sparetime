/**
 * Sync Store - Pinia state management for Google Drive sync
 * Per plan.md - handles backup/restore and sync state
 */

import { defineStore } from 'pinia'
import { ref, computed, toRaw } from 'vue'
import { db } from '@/db/database'
import type { SyncState, PendingChange, SyncConflict, GoogleDriveBackup } from '@/types/sync'
import type { Task } from '@/types/task'
import type { Person } from '@/types/person'
import { nowISO } from '@/utils/dateHelpers'
import { generateChecksum as cryptoGenerateChecksum } from '@/utils/crypto'
import { CURRENT_SCHEMA_VERSION } from '@/db/schema'
import { getBackupLastModified, downloadBackup, uploadBackup, createBackupPayload } from '@/services/googleDrive'
import type { TokenClient } from '@/services/googleDrive'
import { usePeopleStore } from '@/stores/peopleStore'

/**
 * Sync status enum
 */
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline' | 'conflict' | 'remote-newer'

/**
 * Merge result for a single task
 */
interface TaskMergeResult {
  action: 'keep-local' | 'keep-remote' | 'conflict' | 'no-change'
  task: Task
  remoteTask?: Task
}

/**
 * Result of the full sync operation
 */
export interface SyncResult {
  success: boolean
  tasksUploaded: number
  tasksDownloaded: number
  conflictsDetected: number
  error?: string
}

/** Debounce timer for auto-sync */
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null

/** Interval timer for periodic remote check */
let remoteCheckInterval: ReturnType<typeof setInterval> | null = null

/** Track if online listeners are registered */
let onlineListenersRegistered = false

/** Token client for silent token refresh */
let storedTokenClient: TokenClient | null = null

/**
 * Sync store for managing Google Drive backup state
 */
export const useSyncStore = defineStore('sync', () => {
  // State
  const syncState = ref<SyncState | null>(null)
  const syncStatus = ref<SyncStatus>('idle')
  const loading = ref(false)
  const error = ref<string | null>(null)
  const lastSyncTime = ref<string | null>(null)
  const remoteLastModified = ref<Date | null>(null)
  const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
  /** True when a debounced sync is scheduled (waiting for 2s delay) */
  const isSyncPending = ref(false)
  /** True after initial state load completes */
  const isInitialized = ref(false)

  // Getters
  const isBackupEnabled = computed(() => !!syncState.value?.accessToken)

  const hasPendingChanges = computed(
    () => (syncState.value?.pendingChanges?.length ?? 0) > 0
  )

  const pendingChangeCount = computed(
    () => syncState.value?.pendingChanges?.length ?? 0
  )

  const hasConflicts = computed(
    () => (syncState.value?.conflicts?.length ?? 0) > 0
  )

  const conflicts = computed(
    () => syncState.value?.conflicts ?? []
  )

  const conflictCount = computed(
    () => syncState.value?.conflicts?.length ?? 0
  )

  const hasRemoteChanges = computed(() => {
    if (!remoteLastModified.value || !lastSyncTime.value) return false
    const localSyncDate = new Date(lastSyncTime.value)
    return remoteLastModified.value > localSyncDate
  })

  // Actions

  async function refreshPeopleStore(): Promise<void> {
    await usePeopleStore().loadPeople()
  }

  /**
   * Load sync state from IndexedDB
   */
  async function loadSyncState(): Promise<void> {
    loading.value = true
    error.value = null
    isInitialized.value = false

    try {
      const state = await db.syncState.get(1)
      if (state) {
        syncState.value = state
        lastSyncTime.value = state.lastSyncedAt ?? null

        // Infer sync status from persisted state
        if (state.accessToken) {
          if (state.conflicts && state.conflicts.length > 0) {
            syncStatus.value = 'conflict'
          } else if (state.pendingChanges && state.pendingChanges.length > 0) {
            syncStatus.value = 'idle' // Has pending changes, not yet synced
          } else if (state.lastSyncedAt) {
            syncStatus.value = 'synced' // No pending changes, has sync history
          } else {
            syncStatus.value = 'idle' // Connected but never synced
          }
        } else {
          syncStatus.value = 'idle'
        }
      } else {
        // Initialize if not exists
        await initializeSyncState()
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load sync state'
      console.error('Failed to load sync state:', e)
    } finally {
      loading.value = false
      isInitialized.value = true
    }
  }

  /**
   * Initialize sync state if it doesn't exist
   */
  async function initializeSyncState(): Promise<void> {
    const initialState: SyncState = {
      id: 1,
      pendingChanges: [],
      conflicts: []
    }

    await db.syncState.put(initialState)
    syncState.value = initialState
    lastSyncTime.value = null
    remoteLastModified.value = null
    syncStatus.value = 'idle'
  }

  /**
   * Store an access token
   */
  async function storeAccessToken(token: string): Promise<void> {
    if (!syncState.value) {
      await initializeSyncState()
    }

    syncState.value!.accessToken = token

    // Use put with full state to avoid update cloning issues
    await db.syncState.put({
      id: 1,
      pendingChanges: toRaw(syncState.value!.pendingChanges),
      conflicts: toRaw(syncState.value!.conflicts),
      accessToken: token,
      lastSyncedAt: syncState.value!.lastSyncedAt
    })
  }

  /**
   * Store token client for silent refresh
   */
  function setTokenClient(client: TokenClient | null): void {
    storedTokenClient = client
  }

  /**
   * Attempt to refresh token silently
   */
  async function refreshTokenSilently(): Promise<string | null> {
    if (!storedTokenClient) return null

    try {
      // Request new token with empty prompt for silent refresh
      const newToken = await new Promise<string>((resolve, reject) => {
        storedTokenClient!.callback = (response) => {
          if (response.error) {
            reject(new Error(response.error_description || response.error))
          } else {
            resolve(response.access_token)
          }
        }
        storedTokenClient!.requestAccessToken({ prompt: '' })
      })

      // Store the new token
      await storeAccessToken(newToken)
      return newToken
    } catch (error) {
      console.error('Silent token refresh failed:', error)
      return null
    }
  }

  /**
   * Retrieve stored access token
   */
  function getAccessToken(): string | null {
    return syncState.value?.accessToken ?? null
  }

  /**
   * Clear authentication (remove stored token)
   */
  async function clearAuth(): Promise<void> {
    if (!syncState.value) return

    syncState.value.accessToken = undefined
    syncStatus.value = 'idle'

    // Use put with full state to avoid update cloning issues
    await db.syncState.put({
      id: 1,
      pendingChanges: toRaw(syncState.value.pendingChanges),
      conflicts: toRaw(syncState.value.conflicts),
      accessToken: undefined,
      lastSyncedAt: syncState.value.lastSyncedAt
    })
  }

  /**
   * Add a pending change to the queue
   * Called when tasks are created, updated, or deleted
   */
  async function addPendingChange(
    taskId: string,
    operation: 'create' | 'update' | 'delete',
    data?: Task
  ): Promise<void> {
    if (!syncState.value) {
      await initializeSyncState()
    }

    // Deep clone the data to avoid Vue proxy issues with IndexedDB
    const clonedData = data ? JSON.parse(JSON.stringify(toRaw(data))) as Task : undefined

    const change: PendingChange = {
      taskId,
      operation,
      timestamp: nowISO(),
      data: clonedData
    }

    const pendingChanges = [...toRaw(syncState.value!.pendingChanges), change]
    syncState.value!.pendingChanges = pendingChanges

    // Use put with full state to avoid update cloning issues
    await db.syncState.put({
      id: 1,
      pendingChanges: toRaw(pendingChanges),
      conflicts: toRaw(syncState.value!.conflicts),
      accessToken: syncState.value!.accessToken,
      lastSyncedAt: syncState.value!.lastSyncedAt
    })
  }

  /**
   * Clear pending changes after successful sync
   */
  async function clearPendingChanges(): Promise<void> {
    if (!syncState.value) return

    const now = nowISO()
    syncState.value.pendingChanges = []
    syncState.value.lastSyncedAt = now
    lastSyncTime.value = now
    syncStatus.value = 'synced'

    // Use put with full state to avoid update cloning issues
    await db.syncState.put({
      id: 1,
      pendingChanges: [],
      conflicts: toRaw(syncState.value.conflicts),
      accessToken: syncState.value.accessToken,
      lastSyncedAt: now
    })
  }

  /**
   * Detect if there's a conflict between local and remote task
   */
  function detectConflict(localTask: Task, remoteTask: Task): boolean {
    // Compare JSON representations (ignores object reference)
    const localJson = JSON.stringify(localTask)
    const remoteJson = JSON.stringify(remoteTask)
    return localJson !== remoteJson
  }

  /**
   * Add a sync conflict
   */
  async function addConflict(localTask: Task, remoteTask: Task): Promise<void> {
    if (!syncState.value) {
      await initializeSyncState()
    }

    const taskId = localTask.id ?? remoteTask.id ?? ''

    // Check if conflict already exists for this task
    const existingConflict = syncState.value!.conflicts.find(c => c.taskId === taskId)
    if (existingConflict) {
      // Update the existing conflict with latest data
      existingConflict.localData = localTask
      existingConflict.remoteData = remoteTask
      existingConflict.detectedAt = nowISO()

      await db.syncState.put({
        id: 1,
        pendingChanges: toRaw(syncState.value!.pendingChanges),
        conflicts: toRaw(syncState.value!.conflicts),
        accessToken: syncState.value!.accessToken,
        lastSyncedAt: syncState.value!.lastSyncedAt
      })
      return
    }

    const conflict: SyncConflict = {
      taskId,
      localData: localTask,
      remoteData: remoteTask,
      detectedAt: nowISO()
    }

    const conflicts = [...toRaw(syncState.value!.conflicts), conflict]
    syncState.value!.conflicts = conflicts
    syncStatus.value = 'conflict'

    // Use put with full state to avoid update cloning issues
    await db.syncState.put({
      id: 1,
      pendingChanges: toRaw(syncState.value!.pendingChanges),
      conflicts: toRaw(conflicts),
      accessToken: syncState.value!.accessToken,
      lastSyncedAt: syncState.value!.lastSyncedAt
    })
  }

  /**
   * Resolve a conflict by choosing local or remote version
   */
  async function resolveConflict(
    taskId: string,
    resolution: 'local' | 'remote'
  ): Promise<Task | null> {
    if (!syncState.value) return null

    const conflict = syncState.value.conflicts.find((c) => c.taskId === taskId)
    if (!conflict) return null

    // Remove conflict from list
    const remainingConflicts = syncState.value.conflicts.filter(
      (c) => c.taskId !== taskId
    )

    const resolvedTask = resolution === 'local' ? toRaw(conflict.localData) : toRaw(conflict.remoteData)

    // Update the resolved task with current timestamp to ensure it's "newer" than remote
    const now = nowISO()
    // Deep clone to avoid DataCloneError with nested Vue proxies (e.g., unknown dependencies)
    const taskWithUpdatedTimestamp = JSON.parse(JSON.stringify({
      ...resolvedTask,
      updatedAt: now
    }))

    // Always update local task with the resolved version and new timestamp
    await db.tasks.put(taskWithUpdatedTimestamp)

    syncState.value.conflicts = remainingConflicts

    // Use the conflict's detectedAt as the lastSyncedAt
    // This is when we last successfully compared with remote, so any changes
    // AFTER this time are new and need to be synced. Using 'now' would risk
    // losing changes made between conflict detection and resolution.
    const syncTimestamp = conflict.detectedAt
    syncState.value.lastSyncedAt = syncTimestamp
    lastSyncTime.value = syncTimestamp

    // Update status based on remaining conflicts
    if (remainingConflicts.length === 0 && syncStatus.value === 'conflict') {
      syncStatus.value = 'idle' // Will sync shortly
    }

    // Use put with full state to avoid update cloning issues
    await db.syncState.put({
      id: 1,
      pendingChanges: toRaw(syncState.value.pendingChanges),
      conflicts: toRaw(remainingConflicts),
      accessToken: syncState.value.accessToken,
      lastSyncedAt: syncTimestamp
    })

    // Automatically sync after resolving conflict to push resolution to cloud
    // Use scheduleDebouncedSync so it doesn't block and handles multiple resolutions
    scheduleDebouncedSync()

    return taskWithUpdatedTimestamp
  }

  /**
   * Generate SHA-256 checksum for data integrity
   */
  async function generateChecksum(data: unknown): Promise<string> {
    return cryptoGenerateChecksum(data)
  }

  /**
   * Export all tasks to backup format
   */
  async function exportToBackup(): Promise<GoogleDriveBackup> {
    const [tasks, people] = await Promise.all([db.tasks.toArray(), db.people.toArray()])

    // Checksum covers tasks only (people is additive) for backward compatibility
    const checksum = await generateChecksum(tasks)

    return {
      version: CURRENT_SCHEMA_VERSION,
      exportTimestamp: nowISO(),
      tasks,
      people,
      checksum
    }
  }

  /**
   * Import tasks from backup
   */
  async function importFromBackup(backup: GoogleDriveBackup): Promise<boolean> {
    // Verify checksum
    const expectedChecksum = await generateChecksum(backup.tasks)

    if (expectedChecksum !== backup.checksum) {
      throw new Error('Backup integrity check failed: invalid checksum')
    }

    // Clear existing tasks and import
    await db.transaction('rw', db.tasks, async () => {
      await db.tasks.clear()
      await db.tasks.bulkAdd(backup.tasks)
    })

    // Replace people from backup (additive field; absent on older backups)
    await db.transaction('rw', db.people, async () => {
      await db.people.clear()
      if (backup.people && backup.people.length > 0) {
        await db.people.bulkAdd(backup.people)
      }
    })
    await refreshPeopleStore()

    // Update last sync time
    const now = nowISO()
    if (syncState.value) {
      syncState.value.lastSyncedAt = now
      lastSyncTime.value = now

      // Use put with full state to avoid update cloning issues
      await db.syncState.put({
        id: 1,
        pendingChanges: toRaw(syncState.value.pendingChanges),
        conflicts: toRaw(syncState.value.conflicts),
        accessToken: syncState.value.accessToken,
        lastSyncedAt: now
      })
    }

    return true
  }

  /**
   * Set sync status
   */
  function setStatus(newStatus: SyncStatus): void {
    syncStatus.value = newStatus
  }

  /**
   * Check if there are newer changes on Google Drive
   * Returns true if remote backup is newer than last sync
   */
  async function checkForRemoteChanges(): Promise<boolean> {
    const token = getAccessToken()
    if (!token) return false

    try {
      const remoteModified = await getBackupLastModified(token)
      remoteLastModified.value = remoteModified

      if (!remoteModified) {
        // No backup exists on remote yet
        return false
      }

      if (!lastSyncTime.value) {
        // Never synced locally, remote has data
        syncStatus.value = 'remote-newer'
        return true
      }

      const localSyncDate = new Date(lastSyncTime.value)
      if (remoteModified > localSyncDate) {
        // Remote is newer
        syncStatus.value = 'remote-newer'
        return true
      }

      // Local is up to date (or newer with pending changes)
      if (!hasPendingChanges.value && !hasConflicts.value) {
        syncStatus.value = 'synced'
      }
      return false
    } catch (e) {
      console.error('Failed to check for remote changes:', e)
      // Don't change status on check failure, just log
      return false
    }
  }

  /**
   * Merge a single task based on timestamps
   * Per sync-redesign-plan.md merge logic
   */
  function mergeTask(
    localTask: Task | undefined,
    remoteTask: Task | undefined,
    lastSyncedAt: string | null
  ): TaskMergeResult {
    // Local only - new local task to upload
    if (localTask && !remoteTask) {
      return { action: 'keep-local', task: localTask }
    }

    // Remote only - new remote task to download
    if (!localTask && remoteTask) {
      return { action: 'keep-remote', task: remoteTask }
    }

    // Both exist - compare timestamps
    if (localTask && remoteTask) {
      const localUpdated = new Date(localTask.updatedAt)
      const remoteUpdated = new Date(remoteTask.updatedAt)
      const lastSync = lastSyncedAt ? new Date(lastSyncedAt) : null

      // Same timestamp - no change needed
      if (localTask.updatedAt === remoteTask.updatedAt) {
        return { action: 'no-change', task: localTask }
      }

      // Check for conflict: both modified since last sync
      if (lastSync) {
        const localModifiedAfterSync = localUpdated > lastSync
        const remoteModifiedAfterSync = remoteUpdated > lastSync

        if (localModifiedAfterSync && remoteModifiedAfterSync) {
          // Both were modified - conflict!
          return { action: 'conflict', task: localTask, remoteTask }
        }
      }

      // No conflict - use the newer version
      if (localUpdated > remoteUpdated) {
        return { action: 'keep-local', task: localTask }
      } else {
        return { action: 'keep-remote', task: remoteTask }
      }
    }

    // Should never reach here
    throw new Error('Invalid merge state: no local or remote task')
  }

  /**
   * Merge people with remote using last-write-wins by updatedAt.
   * Writes remote-newer (or remote-only) people to the local DB and returns the
   * merged list for upload. People are low-churn so no conflict UI is needed.
   */
  async function mergePeople(remotePeople: Person[]): Promise<Person[]> {
    const localPeople = await db.people.toArray()
    const merged = new Map<string, Person>()
    let didChangeLocalPeople = false
    for (const p of localPeople) merged.set(p.id, p)

    for (const remote of remotePeople) {
      const local = merged.get(remote.id)
      if (!local || new Date(remote.updatedAt) > new Date(local.updatedAt)) {
        await db.people.put(remote)
        merged.set(remote.id, remote)
        didChangeLocalPeople = true
      }
      // else local is newer or equal - keep local (it will be uploaded)
    }

    if (didChangeLocalPeople) {
      await refreshPeopleStore()
    }

    return Array.from(merged.values())
  }

  /**
   * Perform a full two-way sync with Google Drive
   * This is the main sync function that replaces backup/restore
   * Automatically retries once with token refresh on auth errors
   */
  async function performSync(isRetry = false): Promise<SyncResult> {
    const token = getAccessToken()
    if (!token) {
      return { success: false, tasksUploaded: 0, tasksDownloaded: 0, conflictsDetected: 0, error: 'Not authenticated' }
    }

    syncStatus.value = 'syncing'
    error.value = null

    try {
      // 1. Get local tasks
      const localTasks = await db.tasks.toArray()
      const localTaskMap = new Map<string, Task>()
      for (const task of localTasks) {
        localTaskMap.set(task.id, task)
      }

      // 2. Download remote backup
      const remoteBackup = await downloadBackup(token)
      const remoteTaskMap = new Map<string, Task>()
      if (remoteBackup) {
        for (const task of remoteBackup.tasks) {
          remoteTaskMap.set(task.id, task)
        }
      }

      // 2b. Merge people (last-write-wins by updatedAt; no conflict UI - low churn)
      const mergedPeople = await mergePeople(remoteBackup?.people ?? [])

      // 3. Collect all unique task IDs
      const allTaskIds = new Set<string>([...localTaskMap.keys(), ...remoteTaskMap.keys()])

      // 4. Merge each task
      const mergedTasks: Task[] = []
      const newConflicts: SyncConflict[] = []
      let tasksDownloaded = 0
      let tasksUploaded = 0

      for (const taskId of allTaskIds) {
        const localTask = localTaskMap.get(taskId)
        const remoteTask = remoteTaskMap.get(taskId)

        const result = mergeTask(localTask, remoteTask, lastSyncTime.value)

        switch (result.action) {
          case 'keep-local':
            mergedTasks.push(result.task)
            if (!remoteTask) tasksUploaded++
            break

          case 'keep-remote':
            mergedTasks.push(result.task)
            tasksDownloaded++
            // Update local database with remote task
            await db.tasks.put(result.task)
            break

          case 'conflict':
            // Add to conflicts list for user resolution
            if (result.remoteTask) {
              newConflicts.push({
                taskId,
                localData: result.task,
                remoteData: result.remoteTask,
                detectedAt: nowISO()
              })
            }
            // Keep local version in merged for now
            mergedTasks.push(result.task)
            break

          case 'no-change':
            mergedTasks.push(result.task)
            break
        }
      }

      // 5. Handle conflicts
      if (newConflicts.length > 0) {
        // Add conflicts to state, avoiding duplicates
        const existingConflicts = toRaw(syncState.value?.conflicts ?? [])
        const existingConflictIds = new Set(existingConflicts.map(c => c.taskId))

        // Only add conflicts for tasks that don't already have conflicts
        const conflictsToAdd = newConflicts.filter(c => !existingConflictIds.has(c.taskId))
        const allConflicts = [...existingConflicts, ...conflictsToAdd]

        if (syncState.value) {
          syncState.value.conflicts = allConflicts
        }

        await db.syncState.put({
          id: 1,
          pendingChanges: toRaw(syncState.value?.pendingChanges ?? []),
          conflicts: toRaw(allConflicts),
          accessToken: syncState.value?.accessToken,
          lastSyncedAt: syncState.value?.lastSyncedAt
        })

        syncStatus.value = 'conflict'
        return {
          success: true,
          tasksUploaded,
          tasksDownloaded,
          conflictsDetected: conflictsToAdd.length
        }
      }

      // 6. Upload merged data to remote
      const backupPayload = await createBackupPayload(mergedTasks, mergedPeople)
      await uploadBackup(token, backupPayload)

      // 7. Update sync state
      await clearPendingChanges()

      console.log(`Sync complete: ${tasksUploaded} uploaded, ${tasksDownloaded} downloaded`)

      return {
        success: true,
        tasksUploaded,
        tasksDownloaded,
        conflictsDetected: 0
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Sync failed'

      // Check if this is an auth error and we haven't retried yet
      if (!isRetry && (errorMessage.includes('authentication expired') || errorMessage.includes('401') || errorMessage.includes('403'))) {
        console.log('Auth error detected, attempting silent token refresh...')
        const newToken = await refreshTokenSilently()

        if (newToken) {
          console.log('Token refreshed successfully, retrying sync...')
          // Retry the sync with the new token
          return performSync(true)
        }
      }

      error.value = errorMessage
      syncStatus.value = 'error'
      console.error('Sync failed:', e)

      return {
        success: false,
        tasksUploaded: 0,
        tasksDownloaded: 0,
        conflictsDetected: 0,
        error: errorMessage
      }
    }
  }

  /**
   * Schedule a debounced sync after task changes
   * Waits 2 seconds after the last change before syncing
   */
  function scheduleDebouncedSync(): void {
    if (!isBackupEnabled.value) return

    // Check if we're online first - don't show pending if offline
    if (!navigator.onLine) {
      syncStatus.value = 'offline'
      return
    }

    // Mark sync as pending (shows loading indicator)
    isSyncPending.value = true

    // Clear existing timer
    if (syncDebounceTimer) {
      clearTimeout(syncDebounceTimer)
    }

    // Schedule new sync
    syncDebounceTimer = setTimeout(async () => {
      syncDebounceTimer = null

      // Double-check online status
      if (!navigator.onLine) {
        syncStatus.value = 'offline'
        isSyncPending.value = false
        return
      }

      await performSync()
      isSyncPending.value = false
    }, 2000) // 2 second debounce
  }

  /**
   * Start periodic remote change checking
   * Checks every 5 minutes for remote updates and auto-syncs
   */
  function startRemoteCheckPolling(): void {
    // Clear existing interval
    if (remoteCheckInterval) {
      clearInterval(remoteCheckInterval)
    }

    // Check immediately and auto-sync if needed
    checkForRemoteChanges().then(hasChanges => {
      if (hasChanges) {
        performSync()
      }
    })

    // Then check every 5 minutes and auto-sync
    remoteCheckInterval = setInterval(async () => {
      const hasChanges = await checkForRemoteChanges()
      if (hasChanges) {
        // Remote has newer data - auto-sync in background
        await performSync()
      }
    }, 5 * 60 * 1000) // 5 minutes
  }

  /**
   * Stop periodic remote change checking
   */
  function stopRemoteCheckPolling(): void {
    if (remoteCheckInterval) {
      clearInterval(remoteCheckInterval)
      remoteCheckInterval = null
    }
  }

  /**
   * Handle first-time connect with existing data
   * Returns info about what merge options are available
   */
  async function checkFirstTimeConnect(): Promise<{
    hasLocalData: boolean
    hasRemoteData: boolean
    needsMergeDecision: boolean
  }> {
    const token = getAccessToken()
    if (!token) {
      return { hasLocalData: false, hasRemoteData: false, needsMergeDecision: false }
    }

    const localTasks = await db.tasks.toArray()
    const hasLocalData = localTasks.filter(t => !t.deletedAt).length > 0

    const remoteModified = await getBackupLastModified(token)
    const hasRemoteData = remoteModified !== null

    // Need merge decision if both have data and we haven't synced before
    const needsMergeDecision = hasLocalData && hasRemoteData && !lastSyncTime.value

    return { hasLocalData, hasRemoteData, needsMergeDecision }
  }

  /**
   * Handle first-time merge decision
   */
  async function handleFirstTimeMerge(decision: 'merge' | 'use-remote' | 'use-local'): Promise<SyncResult> {
    const token = getAccessToken()
    if (!token) {
      return { success: false, tasksUploaded: 0, tasksDownloaded: 0, conflictsDetected: 0, error: 'Not authenticated' }
    }

    syncStatus.value = 'syncing'

    try {
      switch (decision) {
        case 'merge':
          // Perform normal merge sync
          return await performSync()

        case 'use-remote': {
          // Clear local and download remote (tasks + people)
          const remoteBackup = await downloadBackup(token)
          if (remoteBackup) {
            await db.transaction('rw', db.tasks, async () => {
              await db.tasks.clear()
              await db.tasks.bulkAdd(remoteBackup.tasks)
            })
            await db.transaction('rw', db.people, async () => {
              await db.people.clear()
              if (remoteBackup.people && remoteBackup.people.length > 0) {
                await db.people.bulkAdd(remoteBackup.people)
              }
            })
            await refreshPeopleStore()
          }
          await clearPendingChanges()
          return { success: true, tasksUploaded: 0, tasksDownloaded: remoteBackup?.tasks.length ?? 0, conflictsDetected: 0 }
        }

        case 'use-local': {
          // Upload local to remote (overwrite)
          const [localTasks, localPeople] = await Promise.all([db.tasks.toArray(), db.people.toArray()])
          const backupPayload = await createBackupPayload(localTasks, localPeople)
          await uploadBackup(token, backupPayload)
          await clearPendingChanges()
          return { success: true, tasksUploaded: localTasks.length, tasksDownloaded: 0, conflictsDetected: 0 }
        }
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'First-time merge failed'
      error.value = errorMessage
      syncStatus.value = 'error'
      return { success: false, tasksUploaded: 0, tasksDownloaded: 0, conflictsDetected: 0, error: errorMessage }
    }
  }

  /**
   * Handle online event - sync when back online
   */
  function handleOnline(): void {
    isOnline.value = true
    console.log('Back online - checking for pending sync')

    if (syncStatus.value === 'offline') {
      syncStatus.value = 'idle'
    }

    // If we have pending changes and backup is enabled, sync them
    if (isBackupEnabled.value && hasPendingChanges.value) {
      scheduleDebouncedSync()
    }
  }

  /**
   * Handle offline event
   */
  function handleOffline(): void {
    isOnline.value = false
    console.log('Gone offline - switching to offline mode')
    syncStatus.value = 'offline'
  }

  /**
   * Register online/offline event listeners
   */
  function registerOnlineListeners(): void {
    if (onlineListenersRegistered || typeof window === 'undefined') return

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    onlineListenersRegistered = true

    // Set initial online state
    isOnline.value = navigator.onLine
    if (!isOnline.value) {
      syncStatus.value = 'offline'
    }
  }

  /**
   * Unregister online/offline event listeners
   */
  function unregisterOnlineListeners(): void {
    if (!onlineListenersRegistered || typeof window === 'undefined') return

    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
    onlineListenersRegistered = false
  }

  /**
   * Clear sync state (disable backup)
   */
  async function clearSyncState(): Promise<void> {
    await db.syncState.delete(1)
    syncState.value = null
    lastSyncTime.value = null
    remoteLastModified.value = null
    syncStatus.value = 'idle'
  }

  return {
    // State
    syncState,
    syncStatus,
    loading,
    error,
    lastSyncTime,
    remoteLastModified,
    isOnline,
    isSyncPending,
    isInitialized,

    // Getters
    isBackupEnabled,
    hasPendingChanges,
    pendingChangeCount,
    hasConflicts,
    conflicts,
    conflictCount,
    hasRemoteChanges,

    // Actions
    loadSyncState,
    initializeSyncState,
    storeAccessToken,
    setTokenClient,
    refreshTokenSilently,
    getAccessToken,
    clearAuth,
    addPendingChange,
    clearPendingChanges,
    detectConflict,
    addConflict,
    resolveConflict,
    generateChecksum,
    exportToBackup,
    importFromBackup,
    setStatus,
    checkForRemoteChanges,
    clearSyncState,

    // Sync Algorithm (Phase 3)
    performSync,
    scheduleDebouncedSync,
    startRemoteCheckPolling,
    stopRemoteCheckPolling,
    checkFirstTimeConnect,
    handleFirstTimeMerge,

    // Online/Offline (Phase 5)
    registerOnlineListeners,
    unregisterOnlineListeners
  }
})
