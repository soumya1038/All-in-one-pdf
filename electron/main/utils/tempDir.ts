import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, rm } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

let sessionTempDir: string | null = null;

/**
 * Initialize temporary directory for this session
 * Creates a unique directory in system temp folder
 * @returns Path to session temp directory
 */
export async function initTempDir(): Promise<string> {
  if (sessionTempDir) {
    return sessionTempDir;
  }

  const sessionId = uuidv4();
  sessionTempDir = join(tmpdir(), `docuflow-session-${sessionId}`);

  try {
    await mkdir(sessionTempDir, { recursive: true });
    console.log('Temp directory created:', sessionTempDir);
    return sessionTempDir;
  } catch (error) {
    console.error('Failed to create temp directory:', error);
    throw new Error('Failed to initialize temporary directory');
  }
}

/**
 * Get the current session temp directory path
 * @returns Path to session temp directory or null if not initialized
 */
export function getTempDir(): string | null {
  return sessionTempDir;
}

/**
 * Cleanup temporary directory and all its contents
 * Called on app quit
 */
export async function cleanupTempDir(reinitialize: boolean = true): Promise<void> {
  if (!sessionTempDir) {
    return;
  }

  try {
    await rm(sessionTempDir, { recursive: true, force: true });
    console.log('Temp directory cleaned up:', sessionTempDir);
    sessionTempDir = null;
    if (reinitialize) {
      // Automatically re-initialize a new unique temp directory for subsequent uploads.
      await initTempDir();
    }
  } catch (error) {
    console.error('Failed to cleanup temp directory:', error);
    // Don't throw - cleanup is best-effort
  }
}

/**
 * Get a unique temp file path within the session directory
 * @param filename - Desired filename
 * @returns Full path to temp file
 */
export function getTempFilePath(filename: string): string {
  if (!sessionTempDir) {
    throw new Error('Temp directory not initialized');
  }
  return join(sessionTempDir, filename);
}
