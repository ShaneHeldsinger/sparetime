<script setup lang="ts">
/**
 * SettingsView - Settings page with Google Drive backup controls
 * T098-T100: Settings page integration
 * Redesigned for compact layout with improved danger zone UX
 */

import { ref, computed } from 'vue'
import { GoogleDriveSync, SyncStatus } from '@/components/settings'
import { PeopleManager } from '@/components/people'
import { useSyncStore } from '@/stores/syncStore'
import { useTaskStore } from '@/stores/taskStore'
import { usePeopleStore } from '@/stores/peopleStore'
import { db } from '@/db'
import { deleteBackup } from '@/services/googleDrive'

const syncStore = useSyncStore()
const taskStore = useTaskStore()
const peopleStore = usePeopleStore()

async function clearLocalData(): Promise<void> {
  await db.transaction('rw', db.tasks, db.people, db.syncState, async () => {
    await db.tasks.clear()
    await db.people.clear()
    await db.syncState.clear()
  })

  await Promise.all([
    taskStore.loadTasks(),
    peopleStore.loadPeople(),
    syncStore.loadSyncState()
  ])
}

const isExporting = ref(false)
const isDeleting = ref(false)

// Delete dialog state
type DeleteTarget = 'local' | 'cloud' | 'both' | null
const showDeleteDialog = ref(false)
const deleteTarget = ref<DeleteTarget>(null)
const deleteError = ref<string | null>(null)

// Success toast state
const showSuccessToast = ref(false)
const successMessage = ref('')

// Computed: Check if connected to Google Drive
const isConnectedToCloud = computed(() => syncStore.isBackupEnabled)

async function exportToJson(): Promise<void> {
  isExporting.value = true

  try {
    const backup = await syncStore.exportToBackup()
    const jsonString = JSON.stringify(backup, null, 2)
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = `sparetime-backup-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (error) {
    console.error('Export failed:', error)
  } finally {
    isExporting.value = false
  }
}

/**
 * Open the delete confirmation dialog
 */
function openDeleteDialog(target: DeleteTarget): void {
  deleteTarget.value = target
  deleteError.value = null
  showDeleteDialog.value = true
}

/**
 * Close the delete dialog without action
 */
function cancelDelete(): void {
  showDeleteDialog.value = false
  deleteTarget.value = null
  deleteError.value = null
}

/**
 * Show success toast with message
 */
function showSuccess(message: string): void {
  successMessage.value = message
  showSuccessToast.value = true
  setTimeout(() => {
    showSuccessToast.value = false
  }, 4000)
}

/**
 * Get confirmation message based on delete target
 */
function getDeleteConfirmMessage(): string {
  const taskCount = taskStore.tasks.length
  switch (deleteTarget.value) {
    case 'local':
      return `This will permanently delete all ${taskCount} tasks from this device. Your cloud backup will remain untouched.`
    case 'cloud':
      return 'This will permanently delete your cloud backup on Google Drive. Your local data will remain untouched.'
    case 'both':
      return `This will permanently delete all ${taskCount} tasks from this device AND your cloud backup. This cannot be undone.`
    default:
      return ''
  }
}

/**
 * Get button label based on delete target
 */
function getDeleteButtonLabel(): string {
  switch (deleteTarget.value) {
    case 'local':
      return 'Delete Local Data'
    case 'cloud':
      return 'Delete Cloud Backup'
    case 'both':
      return 'Delete Everything'
    default:
      return 'Delete'
  }
}

/**
 * Execute the delete operation based on selected target
 */
async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return

  isDeleting.value = true
  deleteError.value = null

  try {
    const taskCount = taskStore.tasks.length

    switch (deleteTarget.value) {
      case 'local':
        // Delete local data only, preserve cloud backup
        await clearLocalData()
        showSuccess(`Successfully deleted ${taskCount} tasks from this device.`)
        break

      case 'cloud': {
        // Delete cloud backup only, preserve local data
        const token = syncStore.getAccessToken()
        if (token) {
          await deleteBackup(token)
          showSuccess('Successfully deleted cloud backup from Google Drive.')
        } else {
          throw new Error('Not connected to Google Drive')
        }
        break
      }

      case 'both': {
        // Delete both local and cloud data
        const cloudToken = syncStore.getAccessToken()
        if (cloudToken) {
          await deleteBackup(cloudToken)
        }
        await clearLocalData()
        showSuccess(`Successfully deleted ${taskCount} tasks and cloud backup.`)
        break
      }
    }

    showDeleteDialog.value = false
    deleteTarget.value = null
  } catch (error) {
    console.error('Delete failed:', error)
    deleteError.value = error instanceof Error ? error.message : 'Delete failed'
  } finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <div class="settings-view">
    <!-- Header -->
    <div class="pb-3 mx-2">
      <h2 class="text-xl font-bold">Settings</h2>
    </div>

    <!-- Success Toast -->
    <Transition name="toast">
      <div v-if="showSuccessToast" class="success-toast" role="alert">
        <svg class="w-5 h-5 mr-2 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
        </svg>
        <span>{{ successMessage }}</span>
      </div>
    </Transition>

    <div class="space-y-4">
      <!-- Google Drive Backup Section -->
      <section class="settings-section">
        <GoogleDriveSync />
      </section>

      <!-- Sync Conflicts (only show when connected and has conflicts) -->
      <section v-if="syncStore.isBackupEnabled && syncStore.hasConflicts" class="settings-section">
        <SyncStatus />
      </section>

      <!-- Data Management Section -->
      <section class="settings-section rounded-lg bg-white border border-gray-200 p-4">
        <h3 class="text-base font-semibold text-gray-900 mb-3">Data Management</h3>

        <!-- Export Data - Inline compact -->
        <div class="flex items-center justify-between py-2 border-b border-gray-100">
          <div>
            <p class="text-sm font-medium text-gray-700">Export Data</p>
            <p class="text-xs text-gray-500">Download all tasks as JSON</p>
          </div>
          <button
            type="button"
            class="btn btn-secondary text-sm px-3 py-1.5"
            :disabled="isExporting"
            @click="exportToJson"
          >
            {{ isExporting ? 'Exporting...' : 'Export' }}
          </button>
        </div>

        <!-- App Info - Compact display -->
        <div class="flex items-center justify-between py-2 text-sm">
          <span class="text-gray-500">Tasks stored</span>
          <span class="font-medium text-gray-700">{{ taskStore.taskCount }}</span>
        </div>
      </section>

      <!-- People Section -->
      <section class="settings-section rounded-lg bg-white border border-gray-200 p-4">
        <PeopleManager />
      </section>

      <!-- Danger Zone - GitHub style with smart options -->
      <section class="danger-zone rounded-lg border border-red-300 overflow-hidden">
        <div class="bg-red-50 px-4 py-2 border-b border-red-200">
          <h3 class="text-sm font-semibold text-gray-900">Danger Zone</h3>
        </div>

        <div class="bg-white p-4 space-y-3">
          <!-- Not connected: Simple local delete option -->
          <template v-if="!isConnectedToCloud">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-gray-700">Delete all local data</p>
                <p class="text-xs text-gray-500">Permanently remove all {{ taskStore.tasks.length }} tasks</p>
              </div>
              <button
                type="button"
                class="btn-danger-outline text-sm px-3 py-1.5"
                :disabled="taskStore.tasks.length === 0"
                @click="openDeleteDialog('local')"
              >
                Delete All
              </button>
            </div>
          </template>

          <!-- Connected: Multiple delete options -->
          <template v-else>
            <!-- Delete local only -->
            <div class="flex items-center justify-between py-2 border-b border-gray-100">
              <div>
                <p class="text-sm font-medium text-gray-700">Delete local data only</p>
                <p class="text-xs text-gray-500">Remove tasks from this device (keeps cloud backup)</p>
              </div>
              <button
                type="button"
                class="btn-danger-outline text-sm px-3 py-1.5"
                :disabled="taskStore.tasks.length === 0"
                @click="openDeleteDialog('local')"
              >
                Delete Local
              </button>
            </div>

            <!-- Delete cloud only -->
            <div class="flex items-center justify-between py-2 border-b border-gray-100">
              <div>
                <p class="text-sm font-medium text-gray-700">Delete cloud backup only</p>
                <p class="text-xs text-gray-500">Remove backup from Google Drive (keeps local data)</p>
              </div>
              <button
                type="button"
                class="btn-danger-outline text-sm px-3 py-1.5"
                @click="openDeleteDialog('cloud')"
              >
                Delete Cloud
              </button>
            </div>

            <!-- Delete both -->
            <div class="flex items-center justify-between py-2">
              <div>
                <p class="text-sm font-medium text-gray-700">Delete everything</p>
                <p class="text-xs text-gray-500">Remove all data from device and cloud</p>
              </div>
              <button
                type="button"
                class="btn-danger text-sm px-3 py-1.5"
                :disabled="taskStore.tasks.length === 0"
                @click="openDeleteDialog('both')"
              >
                Delete All
              </button>
            </div>
          </template>
        </div>
      </section>

      <!-- About & Legal Links -->
      <section class="settings-section rounded-lg bg-white border border-gray-200 p-4">
        <h3 class="text-base font-semibold text-gray-900 mb-3">About & Legal</h3>
        <div class="flex flex-col gap-2 text-sm">
          <a href="/about.html" class="text-primary-600 hover:underline">About SpareTime</a>
          <a href="/privacy.html" class="text-primary-600 hover:underline">Privacy Policy</a>
          <a href="/terms.html" class="text-primary-600 hover:underline">Terms of Service</a>
        </div>
      </section>
    </div>

    <!-- Delete Confirmation Dialog -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showDeleteDialog" class="modal-overlay" @click.self="cancelDelete">
          <div class="modal-content">
            <h3 class="text-lg font-semibold text-gray-900 mb-2">Confirm Deletion</h3>

            <p class="text-sm text-gray-600 mb-4">
              {{ getDeleteConfirmMessage() }}
            </p>

            <div v-if="deleteError" class="bg-red-50 border border-red-200 rounded p-2 mb-4">
              <p class="text-sm text-red-600">{{ deleteError }}</p>
            </div>

            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="btn btn-ghost text-sm px-4 py-2"
                :disabled="isDeleting"
                @click="cancelDelete"
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn-danger text-sm px-4 py-2"
                :disabled="isDeleting"
                @click="confirmDelete"
              >
                {{ isDeleting ? 'Deleting...' : getDeleteButtonLabel() }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.settings-view {
  max-width: 600px;
  margin: 0 auto;
}

.settings-section {
  border-radius: var(--radius-lg);
}

/* Success Toast */
.success-toast {
  display: flex;
  align-items: center;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #065f46;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  margin-bottom: 1rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-0.5rem);
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 1rem;
}

.modal-content {
  background: white;
  border-radius: 0.75rem;
  padding: 1.5rem;
  max-width: 400px;
  width: 100%;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
}

.modal-enter-active,
.modal-leave-active {
  transition: all 0.2s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-content,
.modal-leave-to .modal-content {
  transform: scale(0.95);
}

/* Button Styles */
.btn-danger-outline {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.375rem 0.75rem;
  font-weight: 500;
  border-radius: 0.375rem;
  border: 1px solid var(--error);
  color: var(--error);
  background: transparent;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-danger-outline:hover:not(:disabled) {
  background: var(--error);
  color: white;
}

.btn-danger-outline:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-danger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.375rem 0.75rem;
  font-weight: 500;
  border-radius: 0.375rem;
  border: none;
  background-color: var(--error);
  color: white;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-danger:hover:not(:disabled) {
  background-color: var(--error-dark, #dc2626);
}

.btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
