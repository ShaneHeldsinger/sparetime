/**
 * Integration tests for task assignment, incl. recurring occurrence overrides
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTaskStore } from '@/stores/taskStore'
import { db } from '@/db/database'
import type { CreateTaskInput } from '@/types/task'

describe('taskStore assignment', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.tasks.clear()
  })

  afterEach(async () => {
    await db.tasks.clear()
  })

  const recurringInput = (overrides: Partial<CreateTaskInput> = {}): CreateTaskInput => ({
    name: 'Water plants',
    type: 'recurring',
    timeEstimateMinutes: 10,
    effortLevel: 'low',
    location: 'home',
    priority: 'important',
    recurringPattern: {
      intervalValue: 1,
      intervalUnit: 'weeks',
      lastCompletedDate: new Date().toISOString()
    },
    ...overrides
  })

  it('stores assigneeId on create', async () => {
    const store = useTaskStore()
    const task = await store.create(recurringInput({ assigneeId: 'person-1' }))
    expect(task?.assigneeId).toBe('person-1')
  })

  it('clears the assignee when updated to undefined', async () => {
    const store = useTaskStore()
    const task = await store.create(recurringInput({ assigneeId: 'person-1' }))
    const updated = await store.update({ id: task!.id, assigneeId: undefined })
    expect(updated?.assigneeId).toBeUndefined()
    const stored = await db.tasks.get(task!.id)
    expect(stored?.assigneeId).toBeUndefined()
  })

  it('keeps the series default but applies an occurrence override', async () => {
    const store = useTaskStore()
    const task = await store.create(recurringInput({ assigneeId: 'series-person' }))

    const updated = await store.update({ id: task!.id, occurrenceAssigneeId: 'occurrence-person' })
    expect(updated?.assigneeId).toBe('series-person')
    expect(updated?.occurrenceAssigneeId).toBe('occurrence-person')
  })

  it('clears the occurrence override on completion (reverts to series default)', async () => {
    const store = useTaskStore()
    const task = await store.create(recurringInput({ assigneeId: 'series-person' }))
    await store.update({ id: task!.id, occurrenceAssigneeId: 'occurrence-person' })

    const completed = await store.complete(task!.id)

    expect(completed?.occurrenceAssigneeId).toBeUndefined()
    expect(completed?.assigneeId).toBe('series-person')
    const stored = await db.tasks.get(task!.id)
    expect(stored?.occurrenceAssigneeId).toBeUndefined()
  })

  it('does not wipe the assignee when completing without touching assignment', async () => {
    const store = useTaskStore()
    const task = await store.create(recurringInput({ assigneeId: 'series-person' }))

    const completed = await store.complete(task!.id)
    expect(completed?.assigneeId).toBe('series-person')
  })

  it('drops the occurrence override when the type changes away from recurring', async () => {
    const store = useTaskStore()
    const task = await store.create(recurringInput({ assigneeId: 'series-person' }))
    await store.update({ id: task!.id, occurrenceAssigneeId: 'occurrence-person' })

    const updated = await store.update({ id: task!.id, type: 'one-off' })
    expect(updated?.occurrenceAssigneeId).toBeUndefined()
  })
})
