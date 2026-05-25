/**
 * Person Colors - Preset palette and helpers for person avatars
 */

/**
 * Preset avatar colors. The `key` is stored on the Person record.
 * `bgClass`/`textClass` style swatch buttons; `hex`/`textHex` fill the SVG avatar
 * (vector text centers geometrically and stays crisp at any zoom).
 */
export interface PersonColor {
  key: string
  label: string
  bgClass: string
  textClass: string
  hex: string
  textHex: string
}

export const PERSON_COLORS: PersonColor[] = [
  { key: 'rose', label: 'Rose', bgClass: 'bg-rose-500', textClass: 'text-white', hex: '#f43f5e', textHex: '#ffffff' },
  { key: 'orange', label: 'Orange', bgClass: 'bg-orange-500', textClass: 'text-white', hex: '#f97316', textHex: '#ffffff' },
  { key: 'amber', label: 'Amber', bgClass: 'bg-amber-500', textClass: 'text-white', hex: '#f59e0b', textHex: '#ffffff' },
  { key: 'green', label: 'Green', bgClass: 'bg-green-600', textClass: 'text-white', hex: '#16a34a', textHex: '#ffffff' },
  { key: 'teal', label: 'Teal', bgClass: 'bg-teal-500', textClass: 'text-white', hex: '#14b8a6', textHex: '#ffffff' },
  { key: 'blue', label: 'Blue', bgClass: 'bg-blue-500', textClass: 'text-white', hex: '#3b82f6', textHex: '#ffffff' },
  { key: 'indigo', label: 'Indigo', bgClass: 'bg-indigo-500', textClass: 'text-white', hex: '#6366f1', textHex: '#ffffff' },
  { key: 'purple', label: 'Purple', bgClass: 'bg-purple-500', textClass: 'text-white', hex: '#a855f7', textHex: '#ffffff' }
]

/** Set of valid color keys for validation. */
export const PERSON_COLOR_KEYS = PERSON_COLORS.map((c) => c.key)

/** Default color when none is chosen. */
export const DEFAULT_PERSON_COLOR = PERSON_COLORS[0].key

/**
 * Resolve a color key to its style classes, falling back to a neutral gray.
 */
export function getPersonColor(key: string | undefined): PersonColor {
  return (
    PERSON_COLORS.find((c) => c.key === key) ?? {
      key: 'gray',
      label: 'Gray',
      bgClass: 'bg-gray-300',
      textClass: 'text-gray-600',
      hex: '#d1d5db',
      textHex: '#4b5563'
    }
  )
}

/**
 * Pick a sensible next color so newly-added people tend to differ in hue.
 * Falls back to the default when all colors are in use.
 */
export function nextPersonColor(usedColorKeys: string[]): string {
  const unused = PERSON_COLORS.find((c) => !usedColorKeys.includes(c.key))
  return unused?.key ?? DEFAULT_PERSON_COLOR
}

/**
 * Initials from a name: first letters of the first two words, uppercased.
 * Returns '?' for an empty name.
 */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}
