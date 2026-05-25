<script setup lang="ts">
import { RouterView, useRouter } from 'vue-router'
import { useSyncStore } from '@/stores/syncStore'
import { useTaskStore } from '@/stores/taskStore'
import { usePeopleStore } from '@/stores/peopleStore'
import { onMounted, onUnmounted, computed, ref, onErrorCaptured } from 'vue'
import { checkStorageQuota, formatBytes, type StorageEstimate } from '@/utils/validation'
import { WelcomeDialog } from '@/components/onboarding'

const router = useRouter()
const syncStore = useSyncStore()
const taskStore = useTaskStore()
const peopleStore = usePeopleStore()

// T102: Storage quota monitoring state
const storageWarning = ref<StorageEstimate | null>(null)
const showStorageWarning = ref(false)

// Install prompt state (for browsers that support the beforeinstallprompt event)
// Strongly-typed representation of the install prompt event
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
const deferredPrompt = ref<InstallPromptEvent | null>(null)
const installed = ref(false)

// Handlers kept as top-level refs so we can add/remove them reliably
const handleBeforeInstall = (evt: Event) => {
  const e = evt as InstallPromptEvent
  // Some browsers may not implement preventDefault on this Event type,
  // but keep behavior defensive.
  try {
    ;(e as Event & { preventDefault?: () => void }).preventDefault?.()
  } catch {
    // ignore
  }
  deferredPrompt.value = e
}
const handleAppInstalled = () => {
  installed.value = true
  deferredPrompt.value = null
}

// T106: Error boundary state
const hasError = ref(false)
const errorMessage = ref('')
const errorStack = ref('')

// T119: First-time user onboarding state
const showWelcomeDialog = ref(false)
const isCheckingFirstTime = ref(true)

/**
 * T119: Check if this is a first-time user
 * Shows welcome dialog if no tasks exist and onboarding hasn't been completed
 */
async function checkFirstTimeUser() {
  isCheckingFirstTime.value = true
  try {
    // Check if onboarding was already completed
    const onboardingComplete = localStorage.getItem('sparetime-onboarding-complete')
    if (onboardingComplete === 'true') {
      showWelcomeDialog.value = false
      return
    }

    // Load tasks to check if any exist
    await taskStore.loadTasks()

    // Show welcome dialog only if no tasks exist
    if (taskStore.taskCount === 0) {
      showWelcomeDialog.value = true
    } else {
      // User has tasks, mark onboarding as complete
      localStorage.setItem('sparetime-onboarding-complete', 'true')
      showWelcomeDialog.value = false
    }
  } catch (e) {
    console.error('Failed to check first-time user status:', e)
    showWelcomeDialog.value = false
  } finally {
    isCheckingFirstTime.value = false
  }
}

function handleWelcomeComplete() {
  showWelcomeDialog.value = false
  // Reload tasks in case examples were added
  taskStore.loadTasks()
}

// Check storage quota periodically
async function checkStorage() {
  try {
    const estimate = await checkStorageQuota()
    if (estimate.shouldWarn) {
      storageWarning.value = estimate
      showStorageWarning.value = true
    }
  } catch (e) {
    console.error('Failed to check storage quota:', e)
  }
}

function dismissStorageWarning() {
  showStorageWarning.value = false
}

// T106: Error boundary - capture Vue errors
onErrorCaptured((err, instance, info) => {
  hasError.value = true
  errorMessage.value = err instanceof Error ? err.message : String(err)
  errorStack.value = err instanceof Error && err.stack ? err.stack : ''
  console.error('App error captured:', err, info)

  // Return false to prevent error from propagating
  return false
})

function dismissError() {
  hasError.value = false
  errorMessage.value = ''
  errorStack.value = ''
}

function reloadApp() {
  window.location.reload()
}

// Computed for sync indicator state
const isShowingSyncActivity = computed(() =>
  syncStore.isSyncPending || syncStore.syncStatus === 'syncing'
)

const hasConflicts = computed(() => syncStore.hasConflicts)

onMounted(async () => {
  await syncStore.loadSyncState()

  // Load people so assignee avatars resolve everywhere
  await peopleStore.loadPeople()

  // Register online/offline listeners
  syncStore.registerOnlineListeners()

  // Start remote polling if backup is enabled (auto-syncs in background)
  if (syncStore.isBackupEnabled) {
    syncStore.startRemoteCheckPolling()
  }

  // T119: Check if this is a first-time user
  await checkFirstTimeUser()

  // Detect if already installed (standalone display-mode or iOS navigator.standalone)
  try {
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      installed.value = true
    }
    const nav = navigator as unknown as { standalone?: boolean }
    if (nav.standalone === true) installed.value = true
  } catch {
    // ignore
  }

  // Capture the beforeinstallprompt event so we can show a custom install button
  window.addEventListener('beforeinstallprompt', handleBeforeInstall)
  // Listen for successful installs so UI can update
  window.addEventListener('appinstalled', handleAppInstalled)

  // T102: Check storage quota on mount and periodically
  await checkStorage()
  // Check every 5 minutes
  const storageCheckInterval = setInterval(checkStorage, 5 * 60 * 1000)

  // Clean up on unmount
  onUnmounted(() => {
    clearInterval(storageCheckInterval)
    window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
    window.removeEventListener('appinstalled', handleAppInstalled)
  })
})

onUnmounted(() => {
  syncStore.stopRemoteCheckPolling()
  syncStore.unregisterOnlineListeners()
})

function navigateToSettings() {
  router.push('/settings')
}

async function installApp() {
  if (!deferredPrompt.value) return
  try {
    await deferredPrompt.value.prompt()
    // Optionally inspect the user's choice
    const choice = await deferredPrompt.value.userChoice
    // If user accepted, mark installed immediately; otherwise clear the prompt
    if (choice && choice.outcome === 'accepted') {
      installed.value = true
    }
    deferredPrompt.value = null
    console.log('Install prompt choice:', choice)
  } catch (e) {
    console.warn('Install prompt failed or was dismissed', e)
    deferredPrompt.value = null
  }
}

function getStatusColor(): string {
  // Conflicts take priority - show red
  if (hasConflicts.value) return 'bg-red-500'

  // Error state takes priority over syncing state - show red
  if (syncStore.syncStatus === 'error') return 'bg-red-400'

  // Offline - show gray
  if (!syncStore.isOnline) return 'bg-gray-400'

  // Syncing or pending sync - show animated yellow
  if (isShowingSyncActivity.value) return 'bg-yellow-400 animate-pulse'

  // Has pending changes waiting to sync
  if (syncStore.hasPendingChanges) return 'bg-yellow-400'

  // Status-based colors
  switch (syncStore.syncStatus) {
    case 'synced': return 'bg-green-400'
    case 'remote-newer': return 'bg-blue-400'
    default: return 'bg-gray-400'
  }
}

function getStatusTitle(): string {
  // Conflicts take priority
  if (hasConflicts.value) {
    return `${syncStore.conflictCount} conflict(s) - tap to resolve`
  }

  // Offline
  if (!syncStore.isOnline) return 'Offline - changes will sync when back online'

  // Syncing states
  if (syncStore.syncStatus === 'syncing') return 'Syncing with Google Drive...'
  if (syncStore.isSyncPending) return 'Syncing in a moment...'

  // Other states
  if (syncStore.hasPendingChanges) return 'Changes pending sync'

  switch (syncStore.syncStatus) {
    case 'synced': return 'Synced with Google Drive'
    case 'error': return 'Sync error - tap to view'
    case 'remote-newer': return 'Syncing remote changes...'
    case 'idle': return 'Connected to Google Drive'
    default: return 'Google Drive Sync'
  }
}
</script>

<template>
  <div class="h-screen-mobile flex flex-col bg-gray-50 overflow-hidden safe-area-inset">
    <!-- T119: First-time user welcome dialog -->
    <WelcomeDialog
      v-if="showWelcomeDialog && !isCheckingFirstTime"
      @complete="handleWelcomeComplete"
    />

    <!-- T106: Error Boundary UI -->
    <div
      v-if="hasError"
      class="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/80 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="error-title"
      aria-describedby="error-description"
    >
      <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <div class="flex items-center gap-3 mb-4">
          <div class="flex-shrink-0 w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
            <svg class="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 id="error-title" class="text-xl font-semibold text-gray-900">Something went wrong</h2>
        </div>

        <p id="error-description" class="text-gray-600 mb-4">
          {{ errorMessage || 'An unexpected error occurred.' }}
        </p>

        <details v-if="errorStack" class="mb-4">
          <summary class="text-sm text-gray-500 cursor-pointer hover:text-gray-700">Technical details</summary>
          <pre class="mt-2 text-xs bg-gray-100 p-2 rounded overflow-x-auto max-h-32">{{ errorStack }}</pre>
        </details>

        <div class="flex gap-3">
          <button
            type="button"
            class="touch-target flex-1 px-4 py-3 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500"
            @click="reloadApp"
          >
            Reload App
          </button>
          <button
            type="button"
            class="touch-target px-4 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
            @click="dismissError"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>

    <!-- T102: Storage Quota Warning Banner -->
    <div
      v-if="showStorageWarning && storageWarning"
      class="bg-amber-50 border-b border-amber-200 px-4 py-3"
      role="alert"
      aria-live="polite"
    >
      <div class="mx-auto max-w-7xl flex items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <svg class="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p class="text-sm text-amber-800">
            <strong>Storage Warning:</strong> You're using {{ storageWarning.percentUsed.toFixed(1) }}% of available storage
            ({{ formatBytes(storageWarning.usage) }} / {{ formatBytes(storageWarning.quota) }}).
            Consider backing up and removing old tasks.
          </p>
        </div>
        <button
          type="button"
          class="touch-target p-2 text-amber-600 hover:text-amber-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
          aria-label="Dismiss storage warning"
          @click="dismissStorageWarning"
        >
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Header -->
    <header class="flex-shrink-0 bg-primary-600 text-white shadow-lg">
      <div class="mx-auto max-w-2xl px-2 py-1.5 sm:px-4 lg:px-6 flex items-center justify-between">
        <!-- App Logo and Name -->
        <div class="flex items-center gap-2">
          <img src="/icons/icon.svg" alt="SpareTime" class="h-10 w-10 rounded-lg bg-white p-0.5" />
          <h1 class="text-lg font-bold">SpareTime</h1>
        </div>

        <!-- Install button (shows when browser fires beforeinstallprompt) -->
        <button
          v-if="deferredPrompt && !installed"
          @click="installApp"
          class="ml-2 touch-target px-3 py-1 rounded-lg bg-white/10 text-white hover:bg-white/20"
          title="Install SpareTime"
        >
          Install
        </button>
        <!-- Sync Status Indicator (show after initialization) -->
        <button
          v-if="syncStore.isInitialized"
          class="flex items-center gap-2 touch-target px-3 py-1 rounded-lg transition-colors"
          :class="[
            syncStore.isBackupEnabled
              ? (hasConflicts ? 'bg-red-500/20 hover:bg-red-500/30' : 'bg-white/10 hover:bg-white/20')
              : 'bg-amber-600 hover:bg-amber-700'
          ]"
          :title="syncStore.isBackupEnabled ? getStatusTitle() : 'Not backed up - tap to set up'"
          @click="navigateToSettings"
        >
          <!-- Warning icon when not set up -->
          <template v-if="!syncStore.isBackupEnabled">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span class="text-xs font-medium">Not backed up</span>
          </template>

          <!-- Connected state -->
          <template v-else>
            <!-- Status dot -->
            <span
              class="w-2.5 h-2.5 rounded-full flex-shrink-0"
              :class="getStatusColor()"
            ></span>

            <!-- Offline warning icon -->
            <svg
              v-if="!syncStore.isOnline"
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5 text-gray-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
              />
            </svg>

            <!-- Conflict warning icon (red) -->
            <svg
              v-else-if="hasConflicts"
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5 text-red-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>

            <!-- Syncing spinner -->
            <svg
              v-else-if="isShowingSyncActivity"
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>

            <!-- Normal cloud icon -->
            <svg
              v-else
              xmlns="http://www.w3.org/2000/svg"
              class="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
              />
            </svg>

            <!-- Conflict count badge (red) -->
            <span v-if="hasConflicts" class="text-xs bg-red-500 text-white px-1.5 py-0.5 rounded-full font-medium">
              {{ syncStore.conflictCount }}
            </span>
            <!-- Offline badge -->
            <span v-else-if="!syncStore.isOnline" class="text-xs text-gray-300 font-medium">
              Offline
            </span>
          </template>
        </button>
      </div>
    </header>

    <!-- Main Content - Scrollable area -->
    <main class="flex-1 overflow-y-auto overscroll-contain">
      <div class="mx-auto max-w-2xl px-2 py-4 sm:px-4 lg:px-6">
        <RouterView />
      </div>
    </main>

    <!-- Bottom Navigation - Fixed -->
    <nav
      class="flex-shrink-0 bg-white border-t border-gray-200"
      role="navigation"
      aria-label="Main navigation"
    >
      <div class="mx-auto max-w-2xl px-1 flex justify-around py-1 gap-1">
        <router-link
          to="/"
          data-testid="nav-tasks"
          class="flex flex-1 flex-col items-center touch-target justify-center text-gray-600 hover:text-primary-600 hover:bg-gray-50 transition-colors rounded-lg"
          active-class="!text-primary-600 !bg-primary-50"
          aria-label="Tasks"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
            />
          </svg>
          <span class="text-xs mt-1" aria-hidden="true">Tasks</span>
        </router-link>

        <router-link
          to="/suggestions"
          data-testid="nav-suggestions"
          class="flex flex-1 flex-col items-center touch-target justify-center text-gray-600 hover:text-primary-600 hover:bg-gray-50 transition-colors rounded-lg"
          active-class="!text-primary-600 !bg-primary-50"
          aria-label="Suggestions"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
          <span class="text-xs mt-1" aria-hidden="true">Suggestions</span>
        </router-link>

        <router-link
          to="/settings"
          class="flex flex-1 flex-col items-center touch-target justify-center text-gray-600 hover:text-primary-600 hover:bg-gray-50 transition-colors rounded-lg"
          active-class="!text-primary-600 !bg-primary-50"
          aria-label="Settings"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span class="text-xs mt-1" aria-hidden="true">Settings</span>
        </router-link>
      </div>
    </nav>
  </div>
</template>
