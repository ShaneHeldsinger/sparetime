/**
 * Integration tests for SettingsView destructive local data actions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import SettingsView from '@/views/SettingsView.vue'
import { useTaskStore } from '@/stores/taskStore'
import { usePeopleStore } from '@/stores/peopleStore'
import { useSyncStore } from '@/stores/syncStore'
import { db } from '@/db'

vi.mock('@/services/googleDrive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/googleDrive')>()
  return {
    ...actual,
    deleteBackup: vi.fn()
  }
})

describe('SettingsView local deletion', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.tasks.clear()
    await db.people.clear()
    await db.syncState.clear()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await db.tasks.clear()
    await db.people.clear()
    await db.syncState.clear()
  })

  it('clears local people data and reloads stores when deleting local data', async () => {
    const taskStore = useTaskStore()
    const peopleStore = usePeopleStore()
    const syncStore = useSyncStore()

    await taskStore.create({
      name: 'Take out trash',
      type: 'one-off',
      timeEstimateMinutes: 15,
      effortLevel: 'low',
      location: 'home',
      priority: 'important'
    })
    await peopleStore.create({ name: 'Alex', color: 'rose' })
    await syncStore.loadSyncState()
    await syncStore.storeAccessToken('token')

    const wrapper = mount(SettingsView, {
      global: {
        stubs: {
          GoogleDriveSync: true,
          SyncStatus: true,
          PeopleManager: true,
          teleport: true,
          transition: false
        }
      }
    })

    const deleteLocalButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Delete Local')
    expect(deleteLocalButton).toBeDefined()

    await deleteLocalButton!.trigger('click')
    await flushPromises()
    await wrapper.get('.modal-content .btn-danger').trigger('click')
    await flushPromises()
    await syncStore.loadSyncState()

    expect(await db.tasks.count()).toBe(0)
    expect(await db.people.count()).toBe(0)
    expect(taskStore.tasks).toHaveLength(0)
    expect(peopleStore.people).toHaveLength(0)
    expect(syncStore.isBackupEnabled).toBe(false)
  })
})
