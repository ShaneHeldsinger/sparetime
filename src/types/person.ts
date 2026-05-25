/**
 * Person Types - Core interfaces for people and task assignment
 */

/**
 * A person who can be assigned tasks.
 * Soft-deleted (deletedAt) so tasks that referenced them still resolve a name.
 */
export interface Person {
  /** UUID primary key (generated with crypto.randomUUID()) */
  id: string
  /** Display name (1-50 characters) */
  name: string
  /** Avatar color (one of PERSON_COLORS keys) */
  color: string
  /** Creation timestamp (ISO date string) */
  createdAt: string
  /** Last update timestamp (ISO date string) */
  updatedAt: string
  /** Soft delete timestamp (ISO date string, undefined if not deleted) */
  deletedAt?: string
}

/**
 * Input for creating a new person
 */
export interface CreatePersonInput {
  name: string
  color: string
}

/**
 * Input for updating an existing person
 */
export interface UpdatePersonInput {
  id: string
  name?: string
  color?: string
}
