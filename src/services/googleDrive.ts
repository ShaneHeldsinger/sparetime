/**
 * Google Drive service for backup operations
 * Uses Google Drive API with appdata scope for private app data
 */

import type { Task } from '@/types/task'
import type { Person } from '@/types/person'
import type { GoogleDriveBackup } from '@/types/sync'
import { generateChecksum } from '@/utils/crypto'

// Constants
const BACKUP_FILE_NAME = 'sparetime-backup.json'
const BACKUP_VERSION = 1
const GOOGLE_API_BASE = 'https://www.googleapis.com'

// Get client ID from environment
function getClientId(): string {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) {
    throw new Error('VITE_GOOGLE_CLIENT_ID is not configured')
  }
  return clientId
}

/**
 * Create a backup payload from tasks and people.
 * Checksum covers tasks only (people is additive) so older backups stay valid.
 */
export async function createBackupPayload(tasks: Task[], people: Person[] = []): Promise<GoogleDriveBackup> {
  const checksum = await generateChecksum(tasks)

  return {
    version: BACKUP_VERSION,
    exportTimestamp: new Date().toISOString(),
    tasks,
    people,
    checksum
  }
}

/**
 * Validate a backup payload by checking its checksum
 */
export async function validateBackupPayload(backup: GoogleDriveBackup): Promise<boolean> {
  // Check required fields
  if (!backup.version || !backup.exportTimestamp || !backup.checksum || !Array.isArray(backup.tasks)) {
    return false
  }

  // Verify checksum
  const expectedChecksum = await generateChecksum(backup.tasks)
  return backup.checksum === expectedChecksum
}

/**
 * Parse JSON string to backup payload
 */
export function parseBackupPayload(jsonString: string): GoogleDriveBackup | null {
  if (!jsonString) {
    return null
  }

  try {
    const parsed = JSON.parse(jsonString)

    // Check required fields exist
    if (!parsed.version || !parsed.exportTimestamp || !parsed.checksum || !Array.isArray(parsed.tasks)) {
      return null
    }

    return parsed as GoogleDriveBackup
  } catch {
    return null
  }
}

// Type definitions for Google Identity Services
interface TokenResponse {
  access_token: string
  expires_in: number
  scope: string
  token_type: string
  error?: string
  error_description?: string
}

export interface TokenClient {
  callback: (response: TokenResponse) => void
  requestAccessToken: (config?: { prompt?: string }) => void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (response: TokenResponse) => void
          }) => TokenClient
          revoke: (token: string, callback: () => void) => void
        }
      }
    }
  }
}

/**
 * Initialize Google Identity Services
 * Returns a token client for authorization
 */
export function initializeGoogleAuth(): Promise<TokenClient> {
  return new Promise((resolve, reject) => {
    // Check if GIS script is loaded
    const checkGisLoaded = () => {
      if (window.google?.accounts?.oauth2) {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: getClientId(),
          scope: 'https://www.googleapis.com/auth/drive.appdata',
          callback: () => {} // Will be set when requesting token
        })
        resolve(tokenClient)
      } else {
        reject(new Error('Google Identity Services not loaded'))
      }
    }

    // Try immediately first
    if (window.google?.accounts?.oauth2) {
      checkGisLoaded()
    } else {
      // Wait for script to load
      const maxAttempts = 50
      let attempts = 0
      const interval = setInterval(() => {
        attempts++
        if (window.google?.accounts?.oauth2) {
          clearInterval(interval)
          checkGisLoaded()
        } else if (attempts >= maxAttempts) {
          clearInterval(interval)
          reject(new Error('Timeout waiting for Google Identity Services'))
        }
      }, 100)
    }
  })
}

/**
 * Request access token from Google
 * For initial sign-in, use `prompt: ''` to show account chooser
 * The silent refresh (prompt: 'none') should only be used in syncStore.refreshTokenSilently()
 * But been running into issues where the prompt: 'none' call fails, so resorting to always showing the account chooser for now.
 */
export async function requestAccessToken(tokenClient: TokenClient): Promise<string> {
  // Always show account chooser for user-initiated sign-in
  // This ensures the popup works since it's in the user click context
  return await requestAccessTokenWithPrompt(tokenClient, '')
}

/**
 * Request access token with specific prompt mode
 */
async function requestAccessTokenWithPrompt(
  tokenClient: TokenClient,
  prompt: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    tokenClient.callback = (response: TokenResponse) => {
      if (response.error) {
        reject(new Error(response.error_description || response.error))
      } else {
        resolve(response.access_token)
      }
    }
    tokenClient.requestAccessToken({ prompt })
  })
}

/**
 * Revoke access token
 */
export function revokeAccessToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    if (window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(token, () => {
        resolve()
      })
    } else {
      resolve()
    }
  })
}

/**
 * Find backup file in Google Drive appdata folder
 */
export async function findBackupFile(accessToken: string): Promise<string | null> {
  const url = new URL(`${GOOGLE_API_BASE}/drive/v3/files`)
  url.searchParams.set('spaces', 'appDataFolder')
  url.searchParams.set('q', `name = '${BACKUP_FILE_NAME}'`)
  url.searchParams.set('fields', 'files(id, name, modifiedTime)')

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })

  if (!response.ok) {
    // Handle auth errors specifically
    if (response.status === 401 || response.status === 403) {
      throw new Error('Google Drive authentication expired. Please reconnect your account.')
    }

    // Try to get error details from response
    let errorDetails = response.statusText
    try {
      const errorData = await response.json()
      if (errorData.error?.message) {
        errorDetails = errorData.error.message
      }
    } catch {
      // If JSON parsing fails, use statusText
    }

    throw new Error(`Failed to search for backup file: ${errorDetails}`)
  }

  const data = await response.json()
  const files = data.files || []

  return files.length > 0 ? files[0].id : null
}

/**
 * Upload backup to Google Drive
 */
export async function uploadBackup(accessToken: string, backup: GoogleDriveBackup): Promise<string> {
  const existingFileId = await findBackupFile(accessToken)

  const metadata = {
    name: BACKUP_FILE_NAME,
    mimeType: 'application/json',
    ...(!existingFileId && { parents: ['appDataFolder'] })
  }

  const body = JSON.stringify(backup)

  // Build multipart request
  const boundary = '-------314159265358979323846'
  const delimiter = `\r\n--${boundary}\r\n`
  const closeDelimiter = `\r\n--${boundary}--`

  const multipartBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json\r\n\r\n' +
    body +
    closeDelimiter

  let url: string
  let method: string

  if (existingFileId) {
    // Update existing file
    url = `${GOOGLE_API_BASE}/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    method = 'PATCH'
  } else {
    // Create new file
    url = `${GOOGLE_API_BASE}/upload/drive/v3/files?uploadType=multipart`
    method = 'POST'
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary="${boundary}"`
    },
    body: multipartBody
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to upload backup: ${response.statusText} - ${errorText}`)
  }

  const result = await response.json()
  return result.id
}

/**
 * Download backup from Google Drive
 */
export async function downloadBackup(accessToken: string): Promise<GoogleDriveBackup | null> {
  const fileId = await findBackupFile(accessToken)

  if (!fileId) {
    return null
  }

  const url = `${GOOGLE_API_BASE}/drive/v3/files/${fileId}?alt=media`

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Google Drive authentication expired. Please reconnect your account.')
    }
    throw new Error(`Failed to download backup: ${response.statusText}`)
  }

  const text = await response.text()
  return parseBackupPayload(text)
}

/**
 * Delete backup from Google Drive
 */
export async function deleteBackup(accessToken: string): Promise<boolean> {
  const fileId = await findBackupFile(accessToken)

  if (!fileId) {
    return false
  }

  const url = `${GOOGLE_API_BASE}/drive/v3/files/${fileId}`

  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })

  if (!response.ok && response.status !== 204) {
    throw new Error(`Failed to delete backup: ${response.statusText}`)
  }

  return true
}

/**
 * Get last modified time of backup file
 */
export async function getBackupLastModified(accessToken: string): Promise<Date | null> {
  const url = new URL(`${GOOGLE_API_BASE}/drive/v3/files`)
  url.searchParams.set('spaces', 'appDataFolder')
  url.searchParams.set('q', `name = '${BACKUP_FILE_NAME}'`)
  url.searchParams.set('fields', 'files(id, modifiedTime)')

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  })

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Google Drive authentication expired. Please reconnect your account.')
    }
    throw new Error(`Failed to get backup info: ${response.statusText}`)
  }

  const data = await response.json()
  const files = data.files || []

  if (files.length === 0) {
    return null
  }

  return new Date(files[0].modifiedTime)
}
