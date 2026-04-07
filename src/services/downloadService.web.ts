/**
 * Download Service - Web Platform Stub
 *
 * ARCHITECTURAL ROLE:
 * Web variant of downloadService.ts providing same interface but with disabled
 * or limited implementations. Browsers lack persistent file system access (for security),
 * so true offline downloads aren't feasible. This stub allows shared UI/service code
 * to work on both platforms via conditional imports.
 *
 * DESIGN PATTERNS:
 * - Null Object Pattern: Returns default values (false, null, 0) instead of throwing
 * - Adapter: Matches downloadService.ts interface for type compatibility
 * - Strategy: Alternative implementation strategy (no-op stubs for web)
 *
 * PLATFORM DIFFERENCES FROM REACT NATIVE:
 * - isDownloaded(), downloadAudio(), getLocalAudioPath(): Always return false/null
 * - Browser cannot access persistent file system (security model)
 * - Possible future: IndexedDB-based downloads if needed for PWA
 * - Metadata only: Can store download list in AsyncStorage, but not actual audio files
 *
 * CONSUMERS:
 * - Same as downloadService.ts (UI checks isDownloaded, calls downloadAudio, etc)
 * - Web builds import this; React Native builds import downloadService.ts
 * - Build tool (webpack/Expo) handles conditional import via file suffix
 *
 * CONSUMER IMPACT:
 * Web users see disabled download features or can only stream content.
 * This is acceptable UX for web (most users have steady internet).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const DOWNLOADS_KEY = '@calmdemy_downloads_web';

/**
 * Same interface as React Native version; allows type-compatible function signatures.
 */
export interface DownloadedContent {
  contentId: string;
  contentType: string;
  title: string;
  duration_minutes: number;
  thumbnailUrl?: string;
  localPath: string;
  downloadedAt: number;
  fileSize: number;
  parentId?: string;
  parentTitle?: string;
  audioPath?: string;
}

/**
 * Retrieve metadata for "downloaded" content from AsyncStorage.
 * On web, we can store metadata but not actual audio files.
 * Useful for tracking download history or preferences.
 *
 * @returns Array of content metadata (files not actually present)
 */
export async function getDownloadedContent(): Promise<DownloadedContent[]> {
  try {
    const data = await AsyncStorage.getItem(DOWNLOADS_KEY);
    if (!data) {
      return [];
    }
    return JSON.parse(data) as DownloadedContent[];
  } catch {
    return [];
  }
}

/**
 * WEB STUB: Always returns false.
 * Web browsers cannot persistently store audio files due to security model.
 * Users must stream content over network.
 *
 * @returns Always false on web
 */
export async function isDownloaded(_contentId: string): Promise<boolean> {
  return false;
}

/**
 * WEB STUB: Always returns null.
 * No local file system access on web; audio must be streamed.
 *
 * @returns Always null on web
 */
export async function getLocalAudioPath(_contentId: string): Promise<string | null> {
  return null;
}

/**
 * WEB STUB: Does not perform actual download.
 * Web platform cannot write to persistent file system.
 * Could be extended to use IndexedDB for PWA offline support (future enhancement).
 *
 * PARAMETERS: All prefixed with _ to indicate intentionally unused.
 * This satisfies the type signature while being explicit about non-implementation.
 *
 * @returns Always false on web
 */
export async function downloadAudio(
  _contentId: string,
  _contentType: string,
  _audioUrl: string,
  _metadata: {
    title: string;
    duration_minutes: number;
    thumbnailUrl?: string;
    parentId?: string;
    parentTitle?: string;
    audioPath?: string;
  },
  _onProgress?: (progress: number) => void
): Promise<boolean> {
  return false;
}

/**
 * WEB STUB: No-op since downloads don't happen on web.
 *
 * @returns undefined
 */
export async function cancelDownload(_contentId: string): Promise<void> {
  return undefined;
}

/**
 * WEB STUB: Always returns false.
 * No downloads in progress on web platform.
 *
 * @returns Always false on web
 */
export function isDownloading(_contentId: string): boolean {
  return false;
}

/**
 * Delete metadata record for content from AsyncStorage.
 * Actual files never existed on web, so only metadata cleanup is possible.
 *
 * @param contentId - Content to delete
 * @returns true on success
 */
export async function deleteDownload(contentId: string): Promise<boolean> {
  const downloads = await getDownloadedContent();
  const nextDownloads = downloads.filter((download) => download.contentId !== contentId);
  await AsyncStorage.setItem(DOWNLOADS_KEY, JSON.stringify(nextDownloads));
  return true;
}

/**
 * Clear all metadata records from AsyncStorage.
 * No actual files to delete (they don't exist on web).
 *
 * @returns true on success
 */
export async function deleteAllDownloads(): Promise<boolean> {
  await AsyncStorage.removeItem(DOWNLOADS_KEY);
  return true;
}

/**
 * WEB STUB: Returns 0.
 * No actual files stored on web; no storage to count.
 *
 * @returns Always 0 on web
 */
export async function getTotalStorageUsed(): Promise<number> {
  return 0;
}

/**
 * Format bytes into human-readable string.
 * Utility function; works same way on all platforms.
 * Provided for completeness (UI may call even on web).
 *
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "5.2 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * WEB STUB: Returns empty set.
 * No downloads on web; no content IDs to return.
 *
 * @returns Always empty set on web
 */
export async function getDownloadedContentIds(_contentType: string): Promise<Set<string>> {
  return new Set<string>();
}
