/**
 * Integration tests for TaskForm assignment submission behavior
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import TaskForm from '@/components/tasks/TaskForm.vue'
import { useTaskStore } from '@/stores/taskStore'
import { usePeopleStore } from '@/stores/peopleStore'
import { db } from '@/db/database'
import type { Task } from '@/types/task'

function makeRecurringTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    name: 'Water plants',
    type: 'recurring',
    timeEstimateMinutes: 10,
    effortLevel: 'low',
    location: 'home',
    status: 'active',
    priority: 'important',
    assigneeId: 'series-person',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    recurringPattern: {
      intervalValue: 1,
      intervalUnit: 'weeks',
      lastCompletedDate: '2026-01-01T00:00:00.000Z',
      nextDueDate: '2026-01-08T00:00:00.000Z'
    },
    ...overrides
  }
}

describe('TaskForm recurring assignment overrides', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await db.tasks.clear()
    await db.people.clear()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await db.tasks.clear()
    await db.people.clear()
  })

  it('submits a null occurrence assignee when this occurrence is explicitly unassigned', async () => {
    const taskStore = useTaskStore()
    const peopleStore = usePeopleStore()
    await db.people.bulkAdd([
      {
        id: 'series-person',
        name: 'Series Person',
        color: 'rose',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ])
    await peopleStore.loadPeople()

    const existingTask = makeRecurringTask()
    const updateSpy = vi.spyOn(taskStore, 'update').mockResolvedValue({
      ...existingTask,
      occurrenceAssigneeId: null
    })

    const wrapper = mount(TaskForm, {
      props: {
        task: existingTask,
        onClose: vi.fn(),
        onSave: vi.fn()
      }
    })

    await flushPromises()

    await wrapper.get('[data-testid="assign-scope-occurrence"]').trigger('click')
    await wrapper.get('[data-testid="task-assignee-select"]').setValue()
    await wrapper.get('#task-form').trigger('submit')

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      id: 'task-1',
      occurrenceAssigneeId: null
    }))
    expect(updateSpy.mock.calls[0][0].assigneeId).toBeUndefined()
  })
})
