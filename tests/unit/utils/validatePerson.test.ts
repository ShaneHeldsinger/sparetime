/**
 * Unit tests for validatePerson
 */

import { describe, it, expect } from 'vitest'
import { validatePerson } from '@/utils/validation'
import { DEFAULT_PERSON_COLOR } from '@/utils/personColors'

describe('validatePerson', () => {
  it('accepts a valid name + color', () => {
    const result = validatePerson({ name: 'Alex', color: DEFAULT_PERSON_COLOR })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects an empty name', () => {
    const result = validatePerson({ name: '   ', color: DEFAULT_PERSON_COLOR })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Name is required')
  })

  it('rejects a name longer than 50 characters', () => {
    const result = validatePerson({ name: 'a'.repeat(51), color: DEFAULT_PERSON_COLOR })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Name must be 50 characters or less')
  })

  it('rejects an unknown color', () => {
    const result = validatePerson({ name: 'Alex', color: 'not-a-color' })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('A valid color is required')
  })
})
