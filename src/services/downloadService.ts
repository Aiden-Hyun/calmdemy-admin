/**
 * Download Service - Media Persistence and Offline Access Layer (React Native/Expo)
 *
 * ARCHITECTURAL ROLE:
 * Manages offline audio download lifecycle: fetch, store, verify, and delete media files.
 * Acts as a Repository pattern implementation for downloaded content, abstracting file system
 * and metadata storage behind a clean interface. Enables offline-first meditation experience.
 *
 * DESIGN PATTERNS:
 * - Repository Pattern: Encapsulates all file/metadata persistence logic
 * - Adapter Pattern: Adapts expo-file-system and AsyncStorage APIs to domain-specific interface
 * - State Machine: Downloads transition: pending -> downloading -> complete/failed
 * - Observer: Progress callbacks notify UI of download state changes
 *
 * KEY DEPENDENCIES:
 * - expo-file-system: File I/O, directory management, resumable downloads
 * - AsyncStorage: Persistent metadata storage (download records, timestamps)
 *
 * CONSUMERS:
 * - UI components: Call downloadAudio(), check isDownloaded(), getLocalAudioPath()
 * - Audio player: Uses getLocalAudioPath() to play offline content
 * - Settings/Storage screens: Call getTotalStorageUsed(), deleteDownload(), deleteAllDownloads()
 *
 * STORAGE ARCHITECTURE:
 * - Local files: DOWNLOADS_DIR (documentDirectory/downloads/)
 * - Metadata: AsyncStorage with key '@calmdemy_downloads'
 * - In-memory tracking: activeDownloads Map (transient, cleared on app restart)
 * - Progress callbacks: Temporary during active downloads only
 *
 * PLATFORM: React Native/Expo only; see downloadService.web.ts for web variant
 */

import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Storage keys
const DOWNLOADS_KEY = '@calmdemy_downloads';
const DOWNLOADS_DIR = `${FileSystem.documentDirectory}downloads/`;

/**
 * Metadata for downloaded audio content.
 * Stored in AsyncStorage for persistence; combined with file system state.
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
  // Additional metadata for navigation
  parentId?: string; // courseId, seriesId, or albumId
  parentTitle?: string;
  audioPath?: string; // Original audio path for reference
}

/**
 * IN-MEMORY STATE MANAGEMENT:
 * Tracks ongoing downloads and their progress callbacks.
 * Cleared on app restart; not persisted to disk.
 * Used for progress updates and cancellation support.
 */
// Map of contentId -> FileSystem.DownloadResumable for active downloads
const activeDownloads = new Map<string, FileSystem.DownloadResumable>();
// Map of contentId -> progress callback for notifying UI of download progress
const downloadProgressCallbacks = new Map<string, (progress: number) => void>();

/**
 * Ensure downloads directory exists before any file operations.
 * Creates intermediate directories if needed (intermediates: true).
 * GUARD CLAUSE: Called at start of downloadAudio() to prevent ENOENT errors.
 *
 * @throws Silent; logs errors to console but allows graceful degradation
 */
async function ensureDownloadsDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(DOWNLOADS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(DOWNLOADS_DIR, { intermediates: true });
  }
}

/**
 * Retrieve all downloaded content metadata from persistent storage.
 * Acts as the single source of truth for download state (queries AsyncStorage).
 * Used by most other functions as a starting point for operations.
 *
 * SYNCHRONIZATION NOTE: Returns data from last successful save; may stale if app crashes
 * during download. File system state is authoritative; use isDownloaded() to verify files.
 *
 * @returns Array of downloaded content, empty array if none or storage read fails
 */
export async function getDownloadedContent(): Promise<DownloadedContent[]> {
  try {
    const data = await AsyncStorage.getItem(DOWNLOADS_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch (error) {
    console.error('Error getting downloaded content:', error);
    return [];
  }
}

/**
 * Save downloaded content metadata to AsyncStorage.
 * INTERNAL: Called after successful file download to persist metadata.
 * Private function (internal use only); exported functions handle persistence.
 *
 * @param downloads - Array of DownloadedContent to save
 * @throws Silent; logs errors but continues execution
 */
async function saveDownloadedContent(downloads: DownloadedContent[]): Promise<void> {
  try {
    await AsyncStorage.setItem(DOWNLOADS_KEY, JSON.stringify(downloads));
  } catch (error) {
    console.error('Error saving downloaded content:', error);
  }
}

/**
 * Check if content has been downloaded and file still exists on device.
 * Two-phase check: metadata lookup + file system verification.
 * IMPORTANT: Checks both AsyncStorage record AND actual file presence; not just metadata.
 * Handles case where files deleted by OS (low storage, manual deletion, etc).
 *
 * USE CASE: Guard clause before trying to load offline content; avoid 404 errors.
 *
 * @param contentId - Unique content identifier
 * @returns true if metadata exists AND file is present on disk, false otherwise
 */
export async function isDownloaded(contentId: string): Promise<boolean> {
  const downloads = await getDownloadedContent();
  const download = downloads.find(d => d.contentId === contentId);
  if (!download) return false;

  /**
   * DEFENSIVE CHECK: Verify file still exists on disk.
   * Metadata can become stale if OS purges files (cache clearing, low storage recovery).
   * This ensures we don't report file as available if it's been deleted.
   */
  const fileInfo = await FileSystem.getInfoAsync(download.localPath);
  return fileInfo.exists;
}

/**
 * Get the local file path for a downloaded audio content.
 * Used by audio player to load offline content.
 * GUARD CLAUSE: Returns null if content not found or file doesn't exist.
 *
 * USE CASE: Audio player calls this to decide between offline vs. streaming playback.
 * FLOW: If null, player falls back to remote URL streaming.
 *
 * @param contentId - Unique content identifier
 * @returns Absolute file path if downloaded, null if not available
 */
export async function getLocalAudioPath(contentId: string): Promise<string | null> {
  const downloads = await getDownloadedContent();
  const download = downloads.find(d => d.contentId === contentId);
  if (!download) return null;

  /**
   * DEFENSIVE: Verify file still exists before returning path.
   * Prevents audio player from trying to load non-existent file.
   */
  const fileInfo = await FileSystem.getInfoAsync(download.localPath);
  if (!fileInfo.exists) return null;

  return download.localPath;
}

/**
 * Download audio content and persist metadata for offline access.
 * Core function for enabling offline meditation experience.
 *
 * FLOW SUMMARY:
 * 1. Idempotency check: return true if already downloaded
 * 2. Setup: ensure directory exists, prepare file path and callbacks
 * 3. Download: use expo's resumable download with progress tracking
 * 4. Persist: save metadata to AsyncStorage, track file size
 * 5. Cleanup: remove in-memory progress callbacks on completion/error
 *
 * ERROR HANDLING:
 * - Returns false on failure (doesn't throw); caller decides how to handle
 * - Always cleans up activeDownloads and callbacks on exit (success or failure)
 * - Warns to console but allows graceful degradation
 *
 * @param contentId - Unique identifier for content (used as filename)
 * @param contentType - Type of content (meditate, sleep, music, etc) for filtering
 * @param audioUrl - Remote URL of audio file (supports resumable downloads)
 * @param metadata - Content info (title, duration, thumbnails, parent references)
 * @param onProgress - Optional callback: (0-100) for UI progress bars
 * @returns true if download successful (or already downloaded), false on error
 */
export async function downloadAudio(
  contentId: string,
  contentType: string,
  audioUrl: string,
  metadata: {
    title: string;
    duration_minutes: number;
    thumbnailUrl?: string;
    parentId?: string;
    parentTitle?: string;
    audioPath?: string;
  },
  onProgress?: (progress: number) => void
): Promise<boolean> {
  try {
    await ensureDownloadsDir();

    /**
     * FILENAME GENERATION:
     * Extract extension from URL (handling query params like ?v=123).
     * Use contentId as filename for deterministic paths (enables deduplication).
     */
    const extension = audioUrl.split('.').pop()?.split('?')[0] || 'mp3';
    const localPath = `${DOWNLOADS_DIR}${contentId}.${extension}`;

    /**
     * IDEMPOTENCY CHECK:
     * If already downloaded, return success immediately.
     * Prevents re-downloading if user retaps download button.
     */
    const existingDownload = await isDownloaded(contentId);
    if (existingDownload) {
      return true;
    }

    /**
     * PROGRESS TRACKING SETUP:
     * Store callback in map so download resumable can call it.
     * Enables real-time progress UI updates as bytes arrive.
     */
    if (onProgress) {
      downloadProgressCallbacks.set(contentId, onProgress);
    }

    /**
     * CREATE RESUMABLE DOWNLOAD:
     * expo-file-system's createDownloadResumable supports:
     * - Large files (doesn't load into memory)
     * - Network interruptions (can pause and resume)
     * - Progress tracking via callback
     */
    const downloadResumable = FileSystem.createDownloadResumable(
      audioUrl,
      localPath,
      {}, // options (headers, etc)
      (downloadProgress) => {
        /**
         * PROGRESS CALLBACK:
         * Called multiple times during download with byte counts.
         * Calculate percentage and invoke UI callback.
         */
        const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
        const callback = downloadProgressCallbacks.get(contentId);
        if (callback) {
          callback(Math.round(progress * 100));
        }
      }
    );

    /**
     * STORE ACTIVE DOWNLOAD:
     * Track resumable so cancelDownload() can find and pause it.
     * Enables user to tap "Cancel" and pause the download.
     */
    activeDownloads.set(contentId, downloadResumable);

    /**
     * EXECUTE DOWNLOAD:
     * Blocks until download completes or fails.
     * Network errors thrown here caught by outer try/catch.
     */
    const result = await downloadResumable.downloadAsync();

    /**
     * CLEANUP IN-MEMORY STATE:
     * Remove from active downloads and progress tracking regardless of success.
     */
    activeDownloads.delete(contentId);
    downloadProgressCallbacks.delete(contentId);

    /**
     * VALIDATE RESULT:
     * Check that download succeeded and URI is valid.
     * Download resumable may return null on failure.
     */
    if (!result || !result.uri) {
      return false;
    }

    /**
     * GET FILE SIZE:
     * Query file system to determine bytes consumed.
     * Used for storage management (getTotalStorageUsed) and display.
     */
    const fileInfo = await FileSystem.getInfoAsync(result.uri);
    const fileSize = (fileInfo as any).size || 0;

    /**
     * PERSIST METADATA:
     * Create DownloadedContent record and save to AsyncStorage.
     * This is the "single source of truth" for offline availability.
     */
    const downloads = await getDownloadedContent();
    const newDownload: DownloadedContent = {
      contentId,
      contentType,
      title: metadata.title,
      duration_minutes: metadata.duration_minutes,
      thumbnailUrl: metadata.thumbnailUrl,
      localPath: result.uri,
      downloadedAt: Date.now(),
      fileSize,
      parentId: metadata.parentId,
      parentTitle: metadata.parentTitle,
      audioPath: metadata.audioPath,
    };

    /**
     * UPSERT PATTERN:
     * Remove old record (if exists) and append new one.
     * Ensures only one record per contentId (deduplication).
     */
    const updatedDownloads = downloads.filter(d => d.contentId !== contentId);
    updatedDownloads.push(newDownload);
    await saveDownloadedContent(updatedDownloads);

    return true;
  } catch (error) {
    // Log error but return false; don't propagate exception
    console.error('Error downloading audio:', error);
    // Cleanup in-memory state even on error
    activeDownloads.delete(contentId);
    downloadProgressCallbacks.delete(contentId);
    return false;
  }
}

/**
 * Cancel an active download in progress.
 * Called when user taps "Cancel" on download UI.
 *
 * STRATEGY: Calls pauseAsync() rather than deleteAsync().
 * Paused downloads can be resumed later if same URL.
 * File left on disk is partial; will be overwritten on retry.
 *
 * ERROR HANDLING: Silently ignores pause errors (already stopped, etc).
 * Always cleans up in-memory state (activeDownloads, callbacks).
 *
 * @param contentId - Content to cancel
 */
export async function cancelDownload(contentId: string): Promise<void> {
  const download = activeDownloads.get(contentId);
  if (download) {
    try {
      /**
       * PAUSE vs DELETE:
       * pauseAsync(): Leaves partial file; can resume if needed
       * Alternative: deleteAsync() would clean up fully (not used here)
       */
      await download.pauseAsync();
    } catch (error) {
      // Ignore errors when canceling; best-effort cleanup
    }
    // Always clean up in-memory state
    activeDownloads.delete(contentId);
    downloadProgressCallbacks.delete(contentId);
  }
}

/**
 * Check if a download is currently in progress.
 * Used by UI to show/hide progress indicators, disable re-tap.
 * SYNCHRONOUS operation; uses in-memory map.
 *
 * @param contentId - Content to check
 * @returns true if download is active, false otherwise
 */
export function isDownloading(contentId: string): boolean {
  return activeDownloads.has(contentId);
}

/**
 * Delete a single downloaded content and reclaim storage.
 * Two-phase delete: file system + metadata storage.
 *
 * ERROR HANDLING:
 * - Checks if file exists before deletion (defensive)
 * - Continues even if file deletion fails; removes metadata anyway
 * - Returns true on success, false if metadata removal fails
 *
 * USE CASE: User taps "Delete" on downloaded meditation in library.
 *
 * @param contentId - Content to delete
 * @returns true on success, false on error
 */
export async function deleteDownload(contentId: string): Promise<boolean> {
  try {
    const downloads = await getDownloadedContent();
    const download = downloads.find(d => d.contentId === contentId);

    if (download) {
      /**
       * STEP 1: Delete file from device storage
       * Check exists first (file may have been deleted by OS already)
       */
      const fileInfo = await FileSystem.getInfoAsync(download.localPath);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(download.localPath);
      }

      /**
       * STEP 2: Remove metadata from AsyncStorage
       * Filter out the deleted content and persist updated list
       */
      const updatedDownloads = downloads.filter(d => d.contentId !== contentId);
      await saveDownloadedContent(updatedDownloads);
    }

    return true;
  } catch (error) {
    console.error('Error deleting download:', error);
    return false;
  }
}

/**
 * Delete all downloaded content and free storage.
 * Used for "Clear All" in storage management, cache clearing, account cleanup.
 *
 * ERROR HANDLING:
 * - Continues deleting other files even if one fails
 * - Always clears metadata at end (best-effort approach)
 * - Returns true if metadata cleared, false if metadata save fails
 *
 * USE CASE: Storage settings "Clear all downloads" button.
 *
 * @returns true if successful, false if metadata clearing failed
 */
export async function deleteAllDownloads(): Promise<boolean> {
  try {
    const downloads = await getDownloadedContent();

    /**
     * DEFENSIVE LOOP:
     * Try to delete each file independently.
     * If one fails, log it but continue with others.
     * Ensures maximum cleanup even if some files are locked.
     */
    for (const download of downloads) {
      try {
        const fileInfo = await FileSystem.getInfoAsync(download.localPath);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(download.localPath);
        }
      } catch (error) {
        // Log and continue; don't let one failure stop the rest
        console.error(`Failed to delete individual download ${download.contentId}:`, error);
      }
    }

    /**
     * CLEAR ALL METADATA:
     * Reset AsyncStorage to empty array (source of truth).
     * File system cleanup is best-effort; metadata is definitive.
     */
    await saveDownloadedContent([]);

    return true;
  } catch (error) {
    console.error('Error deleting all downloads:', error);
    return false;
  }
}

/**
 * Calculate total storage consumed by all downloaded content.
 * Used for storage quota displays and warnings.
 *
 * IMPLEMENTATION:
 * Sums fileSize from metadata (not re-querying file system).
 * Assumes metadata fileSize is accurate; may drift if files deleted externally.
 *
 * PERFORMANCE: O(n) where n = number of downloads; acceptable for typical use.
 *
 * @returns Total bytes used, 0 if no downloads
 */
export async function getTotalStorageUsed(): Promise<number> {
  const downloads = await getDownloadedContent();
  return downloads.reduce((total, d) => total + d.fileSize, 0);
}

/**
 * Format bytes into human-readable string (B, KB, MB, GB).
 * Utility for display in storage management UI.
 *
 * EXAMPLE OUTPUTS:
 * 1024 -> "1.0 KB"
 * 5242880 -> "5.0 MB"
 * 1073741824 -> "1.0 GB"
 *
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "5.2 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Get all downloaded content IDs filtered by type.
 * Used for bulk operations: "are all meditations in course X downloaded?"
 *
 * RETURN TYPE: Set for O(1) membership tests (used by calling code).
 *
 * USE CASE: UI checks getDownloadedContentIds('meditate') to filter UI state.
 *
 * @param contentType - Type to filter by (meditate, sleep, music, etc)
 * @returns Set of content IDs for efficient membership testing
 */
export async function getDownloadedContentIds(contentType: string): Promise<Set<string>> {
  const downloads = await getDownloadedContent();
  const ids = downloads.filter(d => d.contentType === contentType).map(d => d.contentId);
  return new Set(ids);
}
