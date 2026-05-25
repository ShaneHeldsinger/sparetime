/**
 * Integration tests for people in two-way sync (last-write-wins by updatedAt)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSyncStore } from '@/stores/syncStore'
import { usePeopleStore } from '@/stores/peopleStore'
import { db } from '@/db'
import type { Person } from '@/types/person'
import { downloadBackup, uploadBackup, createBackupPayload } from '@/services/googleDrive'

vi.mock('@/services/googleDrive', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/googleDrive')>()
  return {
    ...actual,
    downloadBackup: vi.fn(),
    uploadBackup: vi.fn(),
    getBackupLastModified: vi.fn()
  }
})

function makePerson(overrides: Partial<Person> & { id: string }): Person {
  return {
    name: 'Alex',
    color: 'rose',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

describe('syncStore people merge', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.tasks.clear()
    await db.people.clear()
    await db.syncState.clear()
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await db.tasks.clear()
    await db.people.clear()
    await db.syncState.clear()
  })

  it('downloads remote-only people and uploads them in the merged payload', async () => {
    const syncStore = useSyncStore()
    const peopleStore = usePeopleStore()
    await syncStore.loadSyncState()
    await syncStore.storeAccessToken('token')
    await peopleStore.loadPeople()

    const remotePerson = makePerson({ id: 'remote-1', name: 'Remote Person' })
    const remoteBackup = await createBackupPayload([], [remotePerson])
    vi.mocked(downloadBackup).mockResolvedValue(remoteBackup)
    vi.mocked(uploadBackup).mockResolvedValue('file-id')

    const result = await syncStore.performSync()
    expect(result.success).toBe(true)

    // Remote person written locally
    const local = await db.people.get('remote-1')
    expect(local?.name).toBe('Remote Person')
    expect(peopleStore.personById('remote-1')?.name).toBe('Remote Person')

    // Uploaded payload includes the person
    const uploaded = vi.mocked(uploadBackup).mock.calls[0][1]
    expect(uploaded.people?.some((p) => p.id === 'remote-1')).toBe(true)
  })

  it('keeps the newer version when both sides have the same person', async () => {
    const syncStore = useSyncStore()
    await syncStore.loadSyncState()
    await syncStore.storeAccessToken('token')

    // Local edited more recently than remote
    await db.people.add(makePerson({ id: 'p1', name: 'Local Newer', updatedAt: '2026-05-02T00:00:00.000Z' }))
    const remotePerson = makePerson({ id: 'p1', name: 'Remote Older', updatedAt: '2026-05-01T00:00:00.000Z' })
    vi.mocked(downloadBackup).mockResolvedValue(await createBackupPayload([], [remotePerson]))
    vi.mocked(uploadBackup).mockResolvedValue('file-id')

    await syncStore.performSync()

    const local = await db.people.get('p1')
    expect(local?.name).toBe('Local Newer')
  })

  it('overwrites local with remote when remote is newer', async () => {
    const syncStore = useSyncStore()
    const peopleStore = usePeopleStore()
    await syncStore.loadSyncState()
    await syncStore.storeAccessToken('token')

    await db.people.add(makePerson({ id: 'p1', name: 'Local Older', updatedAt: '2026-05-01T00:00:00.000Z' }))
    await peopleStore.loadPeople()
    const remotePerson = makePerson({ id: 'p1', name: 'Remote Newer', updatedAt: '2026-05-02T00:00:00.000Z' })
    vi.mocked(downloadBackup).mockResolvedValue(await createBackupPayload([], [remotePerson]))
    vi.mocked(uploadBackup).mockResolvedValue('file-id')

    await syncStore.performSync()

    const local = await db.people.get('p1')
    expect(local?.name).toBe('Remote Newer')
    expect(peopleStore.personById('p1')?.name).toBe('Remote Newer')
  })

  it('refreshes the people store after importing a backup', async () => {
    const syncStore = useSyncStore()
    const peopleStore = usePeopleStore()

    await db.people.add(makePerson({ id: 'local-1', name: 'Stale Local' }))
    await peopleStore.loadPeople()

    const importedPerson = makePerson({ id: 'remote-1', name: 'Imported Person', updatedAt: '2026-06-01T00:00:00.000Z' })
    const backup = await createBackupPayload([], [importedPerson])

    const imported = await syncStore.importFromBackup(backup)

    expect(imported).toBe(true)
    expect(peopleStore.people.map((person) => person.id)).toEqual(['remote-1'])
    expect(peopleStore.personById('remote-1')?.name).toBe('Imported Person')
  })

  it('refreshes the people store when first-time merge uses remote data', async () => {
    const syncStore = useSyncStore()
    const peopleStore = usePeopleStore()
    await syncStore.loadSyncState()
    await syncStore.storeAccessToken('token')

    await db.people.add(makePerson({ id: 'local-1', name: 'Local Person' }))
    await peopleStore.loadPeople()

    const remotePerson = makePerson({ id: 'remote-1', name: 'Remote Person', updatedAt: '2026-06-01T00:00:00.000Z' })
    vi.mocked(downloadBackup).mockResolvedValue(await createBackupPayload([], [remotePerson]))

    const result = await syncStore.handleFirstTimeMerge('use-remote')

    expect(result.success).toBe(true)
    expect(peopleStore.people.map((person) => person.id)).toEqual(['remote-1'])
    expect(peopleStore.personById('remote-1')?.name).toBe('Remote Person')
  })
})
