/**
 * Task Types - Core interfaces for task management
 * Per data-model.md specification
 */

export type TaskType = 'one-off' | 'recurring' | 'project'

export type TaskStatus = 'active' | 'completed' | 'archived'

export type EffortLevel = 'low' | 'medium' | 'high'

export type Location = 'home' | 'outside' | 'anywhere'

export type Priority = 'optional' | 'important' | 'critical'

export type IntervalUnit = 'hours' | 'days' | 'weeks' | 'months' | 'years'

/**
 * Recurring pattern for recurring tasks
 */
export interface RecurringPattern {
  /** Interval value (1-999) */
  intervalValue: number
  /** Interval unit (hours, days, weeks, months, years) */
  intervalUnit: IntervalUnit
  /** ISO date string of last completion */
  lastCompletedDate: string
  /** ISO date string of next due date (computed) */
  nextDueDate: string
}

/**
 * Project session configuration for project-type tasks
 */
export interface ProjectSession {
  /** Minimum session duration in minutes (1-480) */
  minSessionDurationMinutes: number
}

/**
 * Full Task entity as stored in IndexedDB
 */
export interface Task {
  /** UUID primary key (generated with crypto.randomUUID()) */
  id: string
  /** Task name (1-200 characters) */
  name: string
  /** Task type: one-off, recurring, or project */
  type: TaskType
  /** Time estimate in minutes (1-480) */
  timeEstimateMinutes: number
  /** Effort level: low, medium, or high (mandatory) */
  effortLevel: EffortLevel
  /** Location: home, outside, or anywhere (mandatory) */
  location: Location
  /** Task status: active, completed, or archived */
  status: TaskStatus
  /** Priority: optional, important, or critical */
  priority: Priority
  /** Optional deadline (ISO date string) */
  deadline?: string
  /** Optional dependency on another task */
  dependsOnId?: string
  /** Assignee for one-off/project tasks; series default for recurring tasks */
  assigneeId?: string
  /** Recurring only: one-time override for the current occurrence; null means explicitly unassigned */
  occurrenceAssigneeId?: string | null
  /** Creation timestamp (ISO date string) */
  createdAt: string
  /** Last update timestamp (ISO date string) */
  updatedAt: string
  /** Soft delete timestamp (ISO date string, null if not deleted) */
  deletedAt?: string
  /** Recurring pattern (only for recurring tasks) */
  recurringPattern?: RecurringPattern
  /** Project session config (only for project tasks) */
  projectSession?: ProjectSession
}

/**
 * Input for creating a new task
 * nextDueDate is computed automatically for recurring tasks
 */
export interface CreateTaskInput {
  name: string
  type: TaskType
  timeEstimateMinutes: number
  effortLevel: EffortLevel
  location: Location
  priority: Priority
  deadline?: Date
  dependsOnId?: string
  assigneeId?: string
  occurrenceAssigneeId?: string | null
  recurringPattern?: Omit<RecurringPattern, 'nextDueDate'>
  projectSession?: ProjectSession
}

/**
 * Input for updating an existing task
 * All fields except id are optional
 */
export interface UpdateTaskInput extends Partial<Omit<CreateTaskInput, 'deadline'>> {
  id: string
  deadline?: Date | string
}
