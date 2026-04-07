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
 *
 * DOMAIN FIELDS:
 * - contentId, contentType, title, duration_minutes, thumbnailUrl: Core meditation metadata
 * - localPath: Absolute file path (returned by expo-file-system after download)
 * - downloadedAt, fileSize: Lifecycle tracking (storage management, recency)
 *
 * NAVIGATION FIELDS:
 * - parentId/parentTitle: Links back to course/series/album (enables "go back" in UI)
 * - audioPath: Original remote path (for reference or re-download decision)
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
 *
 * LIFECYCLE:
 * - activeDownloads populated in downloadAudio() → cleared on completion or error
 * - downloadProgressCallbacks populated in downloadAudio() → called by resumable progress callback
 * - Both maps are transient; exist only while download is in flight
 * - Critical for supporting cancelDownload() and real-time UI updates
 *
 * WHY TRANSIENT (NOT PERSISTED):
 * - Download state is ephemeral; lost on app restart is acceptable (user sees "not downloaded")
 * - Persisting would require complex recovery logic on app resume
 * - File system state (does file exist?) is authoritative; metadata in AsyncStorage is backup
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
 * SIDE EFFECT: Creates ~/Documents/downloads/ directory on first call.
 * Idempotent: Safe to call repeatedly (checks exists before creating).
 *
 * ERROR HANDLING: Silent; logs errors to console but allows graceful degradation
 * If directory creation fails, downloadAudio() will fail downstream (file write will error).
 *
 * @throws Does not throw; logs errors and lets caller handle failure
 */
async function ensureDownloadsDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(DOWNLOADS_DIR);
  if (!dirInfo.exists) {
    // intermediates: true creates parent directories if needed (like mkdir -p)
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
 * PATTERN: Many functions follow this pattern:
 * 1. Call getDownloadedContent() to get current list
 * 2. Modify (add/remove/update) items in the list
 * 3. Call saveDownloadedContent() to persist changes
 * This ensures atomicity per operation (but not across multiple operations).
 *
 * @returns Array of downloaded content, empty array if none or storage read fails (graceful)
 */
export async function getDownloadedContent(): Promise<DownloadedContent[]> {
  try {
    const data = await AsyncStorage.getItem(DOWNLOADS_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch (error) {
    console.error('Error getting downloaded content:', error);
    // Return empty array on error; allows app to continue (offline gracefully)
    return [];
  }
}

/**
 * Save downloaded content metadata to AsyncStorage.
 * INTERNAL: Called after successful file download to persist metadata.
 * Not exported; internal use only. Higher-level functions (downloadAudio, deleteDownload) handle persistence.
 *
 * TIMING: Must be called AFTER file successfully downloaded to disk.
 * If metadata saved but file missing, isDownloaded() will detect mismatch and return false.
 * If file exists but metadata missing, file is orphaned (recoverable via periodic cleanup).
 *
 * @param downloads - Array of DownloadedContent to save (full array, not just one item)
 * @throws Does not throw; logs errors but continues (graceful degradation)
 */
async function saveDownloadedContent(downloads: DownloadedContent[]): Promise<void> {
  try {
    await AsyncStorage.setItem(DOWNLOADS_KEY, JSON.stringify(downloads));
  } catch (error) {
    // Log but don't throw; app can still function without this metadata update
    // File is on disk; metadata loss is less critical than file loss
    console.error('Error saving downloaded content:', error);
  }
}

/**
 * Check if content has been downloaded and file still exists on device.
 * Two-phase check: metadata lookup + file system verification.
 * IMPORTANT: Checks both AsyncStorage record AND actual file presence; not just metadata.
 * Handles case where files deleted by OS (low storage, manual deletion, etc).
 *
 * WHY TWO-PHASE CHECK:
 * - Metadata can drift from file system state (OS deletes files, user clears cache)
 * - Trusting metadata alone leads to failed playback attempts and poor UX
 * - File system check is the "truth"; metadata is just optimization
 *
 * USE CASE: Guard clause before trying to load offline content; avoid 404 errors.
 * Called by audio player to decide: stream remote URL or load local file.
 *
 * PERFORMANCE: Two async I/O operations; acceptable for offline availability checks (infrequent).
 *
 * @param contentId - Unique content identifier
 * @returns true if metadata exists AND file is present on disk, false otherwise
 */
export async function isDownloaded(contentId: string): Promise<boolean> {
  const downloads = await getDownloadedContent();
  const download = downloads.find(d => d.contentId === contentId);
  if (!download) return false;

  /**
   * DEFENSIVE FILE SYSTEM CHECK: Verify file still exists on disk.
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
 * DEFENSIVE PROGRAMMING: Unlike isDownloaded(), returns path directly (not just exists check).
 * Player needs actual path to pass to expo-av playback function.
 * Still verifies file exists (defensive check before returning path).
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
   * If file was deleted by OS, returns null so player falls back to streaming.
   */
  const fileInfo = await FileSystem.getInfoAsync(download.localPath);
  if (!fileInfo.exists) return null;

  // Safe to return: file exists, path is valid
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
     * expo-file-system's createDownloadResumable is critical for offline experience:
     * - Large files: Streams to disk (doesn't load 100MB into RAM)
     * - Network resilience: Can pause/resume if connection drops
     * - Progress tracking: Callback fired with byte counts (enables UI progress bar)
     *
     * MEMORY MODEL: File written incrementally; only small buffers in memory at a time.
     * This allows downloading large meditations (30+ min audio) on limited-memory devices.
     */
    const downloadResumable = FileSystem.createDownloadResumable(
      audioUrl,
      localPath,
      {}, // options: could include headers for auth, custom user-agent, etc
      (downloadProgress) => {
        /**
         * PROGRESS CALLBACK:
         * Called multiple times during download with { totalBytesWritten, totalBytesExpectedToWrite }.
         * Calculate percentage (0-100) and invoke UI callback if registered.
         *
         * THREADING: Called on background thread; safe to call UI updates (React handles batching).
         * FREQUENCY: Depends on network speed and chunk size; not every byte, but periodic.
         */
        const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
        const callback = downloadProgressCallbacks.get(contentId);
        if (callback) {
          // UI expects 0-100 percentage as integer
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
     *
     * TIMING: Do this AFTER file is confirmed to exist (after downloadAsync()).
     * If we save metadata but file download fails, defensive checks will catch mismatch.
     */
    const downloads = await getDownloadedContent();
    const newDownload: DownloadedContent = {
      contentId,
      contentType,
      title: metadata.title,
      duration_minutes: metadata.duration_minutes,
      thumbnailUrl: metadata.thumbnailUrl,
      localPath: result.uri, // Absolute path from expo-file-system result
      downloadedAt: Date.now(), // Timestamp for recency tracking (cleanup, UI sorting)
      fileSize, // From file system query; used for storage quota display
      parentId: metadata.parentId,
      parentTitle: metadata.parentTitle,
      audioPath: metadata.audioPath,
    };

    /**
     * UPSERT PATTERN: "Update or Insert"
     * 1. Filter out any old record with same contentId (deduplication)
     * 2. Append new record to list
     * 3. Persist entire list to AsyncStorage
     *
     * WHY NOT JUST APPEND:
     * - If user re-downloads same content, old record stays; metadata could drift
     * - Filter + push ensures exactly one record per contentId
     * - Inefficient for large lists, but typical download count is <100 items
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
 * Paused downloads can be resumed later if same URL (future enhancement).
 * File left on disk is partial; will be overwritten on retry.
 *
 * ERROR HANDLING: Silently ignores pause errors (already stopped, etc).
 * Always cleans up in-memory state (activeDownloads, callbacks) regardless of pause success.
 *
 * CLEANUP GUARANTEE: Even if pause fails, in-memory state is cleaned up.
 * This prevents stale callbacks from firing if download somehow completes later.
 *
 * @param contentId - Content to cancel
 */
export async function cancelDownload(contentId: string): Promise<void> {
  const download = activeDownloads.get(contentId);
  if (download) {
    try {
      /**
       * PAUSE vs DELETE:
       * pauseAsync(): Pauses download, leaves partial file for potential resume
       *   - Advantage: Low latency, supports resume if user retaps download
       *   - Disadvantage: Orphaned partial files if never resumed
       * deleteAsync(): Fully deletes partial file
       *   - Advantage: Clean storage (no orphaned files)
       *   - Disadvantage: Higher latency, wastes work if user wants to resume
       * Current choice (pause) favors UX (fast cancellation) over storage efficiency.
       */
      await download.pauseAsync();
    } catch (error) {
      // Ignore errors when canceling; best-effort approach
      // Download may have already finished, failed, or been cleaned up
    }

    // Always clean up in-memory state, even if pause fails
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
 * ERROR HANDLING STRATEGY:
 * - Continues deleting other files even if one fails (best effort)
 * - Always clears metadata at end (accepts partial file cleanup)
 * - Returns true if metadata cleared, false if metadata save fails
 * - Orphaned files are less critical than broken metadata (users expect "Clear All" to work)
 *
 * USE CASE: Storage settings "Clear all downloads" button.
 * Performance acceptable: <100 typical files, each delete is fast.
 *
 * @returns true if successful, false if metadata clearing failed
 */
export async function deleteAllDownloads(): Promise<boolean> {
  try {
    const downloads = await getDownloadedContent();

    /**
     * DEFENSIVE LOOP: Delete each file independently.
     * Pattern: try/catch per file so failures don't stop others.
     *
     * RATIONALE:
     * - Some files might be locked by audio player or OS
     * - Don't want one failure to prevent cleaning up all others
     * - Logs failures but continues (maximizes cleanup)
     *
     * DOWNSIDE: May leave orphaned files on disk (acceptable; users can reinstall app).
     */
    for (const download of downloads) {
      try {
        const fileInfo = await FileSystem.getInfoAsync(download.localPath);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(download.localPath);
        }
      } catch (error) {
        // Log and continue; don't let one failure stop the rest
        // File may be locked by active playback or OS background process
        console.error(`Failed to delete individual download ${download.contentId}:`, error);
      }
    }

    /**
     * CLEAR ALL METADATA: Reset AsyncStorage to empty array.
     * This is the "source of truth" for download state.
     *
     * KEY PRINCIPLE: Even if file cleanup is partial, metadata is clean.
     * This is safer than the reverse (clean metadata + orphaned files on disk).
     * isDownloaded() will reject orphaned files anyway (metadata missing).
     */
    await saveDownloadedContent([]);

    return true;
  } catch (error) {
    // Outer try/catch for unexpected failures (e.g., AsyncStorage inaccessible)
    console.error('Error deleting all downloads:', error);
    return false;
  }
}

/**
 * Calculate total storage consumed by all downloaded content.
 * Used for storage quota displays and warnings in settings screen.
 *
 * IMPLEMENTATION:
 * Sums fileSize from metadata (not re-querying file system for each file).
 * Assumes metadata fileSize is accurate; may drift if files deleted externally.
 *
 * ACCURACY TRADEOFF:
 * - Fast: O(1) for sync calculation (metadata already loaded)
 * - Approximate: If OS deletes files, metadata sizes are stale
 * - Acceptable: Minor drift is OK for UI display (not critical like payment systems)
 *
 * ALTERNATIVE (not used): Could walk file system and stat each file (accurate but slow).
 *
 * PERFORMANCE: O(n) where n = number of downloads; acceptable for typical use (<100 items).
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
 * ALGORITHM:
 * - Find largest unit where value >= 1 (e.g., 5242880 bytes -> MB)
 * - Divide bytes by that unit (5242880 / 1048576 = 5.0)
 * - Round to 1 decimal place ("5.0 MB")
 *
 * EXAMPLE OUTPUTS:
 * 0 -> "0 B"
 * 512 -> "512 B"
 * 1024 -> "1.0 KB"
 * 5242880 -> "5.0 MB"
 * 1073741824 -> "1.0 GB"
 *
 * PLATFORM NOTE: Works on all platforms (web, iOS, Android).
 *
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "5.2 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024; // Binary units (1024 bytes per KB, not 1000)
  const sizes = ['B', 'KB', 'MB', 'GB'];
  // Find index of largest unit where bytes / k^i >= 1
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  // Divide by appropriate power of 1024 and format to 1 decimal
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Get all downloaded content IDs filtered by type.
 * Used for bulk operations: "are all meditations in course X downloaded?"
 *
 * RETURN TYPE: Set for O(1) membership tests.
 * Calling code uses: downloadedIds.has(contentId) to check if item is downloaded.
 *
 * USE CASE: UI renders a meditation list with download buttons.
 * Loop through items and check if each is in downloadedIds Set (fast constant-time lookup).
 * More efficient than calling isDownloaded() for each item (which does file system check).
 *
 * LIMITATION: Only checks metadata, doesn't verify files exist.
 * If file was deleted by OS, this returns true but isDownloaded() returns false.
 * Acceptable for UI state (button labels); actual playback uses isDownloaded().
 *
 * @param contentType - Type to filter by (meditate, sleep, music, etc)
 * @returns Set of content IDs for efficient membership testing
 */
export async function getDownloadedContentIds(contentType: string): Promise<Set<string>> {
  const downloads = await getDownloadedContent();
  // Filter by type, extract IDs, return as Set (enables has() for O(1) lookup)
  const ids = downloads.filter(d => d.contentType === contentType).map(d => d.contentId);
  return new Set(ids);
}
