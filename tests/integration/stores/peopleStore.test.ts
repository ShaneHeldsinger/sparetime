/**
 * Integration tests for peopleStore with IndexedDB
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePeopleStore } from '@/stores/peopleStore'
import { db } from '@/db/database'
import { DEFAULT_PERSON_COLOR } from '@/utils/personColors'

describe('peopleStore integration with IndexedDB', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.people.clear()
  })

  afterEach(async () => {
    await db.people.clear()
  })

  it('creates and persists a person', async () => {
    const store = usePeopleStore()
    const person = await store.create({ name: 'Alex', color: DEFAULT_PERSON_COLOR })

    expect(person).toBeDefined()
    expect(person?.id).toBeTruthy()
    const stored = await db.people.get(person!.id)
    expect(stored?.name).toBe('Alex')
  })

  it('rejects an invalid person', async () => {
    const store = usePeopleStore()
    const person = await store.create({ name: '', color: DEFAULT_PERSON_COLOR })
    expect(person).toBeUndefined()
    expect(store.error).toBeTruthy()
  })

  it('updates a person name and color', async () => {
    const store = usePeopleStore()
    const person = await store.create({ name: 'Alex', color: DEFAULT_PERSON_COLOR })
    const updated = await store.update({ id: person!.id, name: 'Alexa', color: 'blue' })

    expect(updated?.name).toBe('Alexa')
    expect(updated?.color).toBe('blue')
  })

  it('soft-deletes a person but keeps it resolvable by id', async () => {
    const store = usePeopleStore()
    const person = await store.create({ name: 'Alex', color: DEFAULT_PERSON_COLOR })

    await store.remove(person!.id)

    // Excluded from the active list
    expect(store.activePeople.find((p) => p.id === person!.id)).toBeUndefined()
    // Still resolvable (so historical assignments show a name)
    expect(store.personById(person!.id)?.name).toBe('Alex')
    const stored = await db.people.get(person!.id)
    expect(stored?.deletedAt).toBeTruthy()
  })
})
