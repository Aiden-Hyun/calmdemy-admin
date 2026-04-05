import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DOWNLOADS_KEY = '@calmdemy_downloads';
const DOWNLOADS_DIR = `${FileSystem.documentDirectory}downloads/`;

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

// Track active downloads for progress
const activeDownloads = new Map<string, FileSystem.DownloadResumable>();
const downloadProgressCallbacks = new Map<string, (progress: number) => void>();

/**
 * Ensure the downloads directory exists
 */
async function ensureDownloadsDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(DOWNLOADS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(DOWNLOADS_DIR, { intermediates: true });
  }
}

/**
 * Get all downloaded content metadata
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
 * Save downloaded content metadata
 */
async function saveDownloadedContent(downloads: DownloadedContent[]): Promise<void> {
  try {
    await AsyncStorage.setItem(DOWNLOADS_KEY, JSON.stringify(downloads));
  } catch (error) {
    console.error('Error saving downloaded content:', error);
  }
}

/**
 * Check if content is downloaded
 */
export async function isDownloaded(contentId: string): Promise<boolean> {
  const downloads = await getDownloadedContent();
  const download = downloads.find(d => d.contentId === contentId);
  if (!download) return false;
  
  // Verify file still exists
  const fileInfo = await FileSystem.getInfoAsync(download.localPath);
  return fileInfo.exists;
}

/**
 * Get local audio path for a downloaded content
 */
export async function getLocalAudioPath(contentId: string): Promise<string | null> {
  const downloads = await getDownloadedContent();
  const download = downloads.find(d => d.contentId === contentId);
  if (!download) return null;
  
  // Verify file exists
  const fileInfo = await FileSystem.getInfoAsync(download.localPath);
  if (!fileInfo.exists) return null;
  
  return download.localPath;
}

/**
 * Download audio content
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
    
    // Generate local file path
    const extension = audioUrl.split('.').pop()?.split('?')[0] || 'mp3';
    const localPath = `${DOWNLOADS_DIR}${contentId}.${extension}`;
    
    // Check if already downloaded
    const existingDownload = await isDownloaded(contentId);
    if (existingDownload) {
      return true;
    }
    
    // Set up progress callback
    if (onProgress) {
      downloadProgressCallbacks.set(contentId, onProgress);
    }
    
    // Create download resumable
    const downloadResumable = FileSystem.createDownloadResumable(
      audioUrl,
      localPath,
      {},
      (downloadProgress) => {
        const progress = downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
        const callback = downloadProgressCallbacks.get(contentId);
        if (callback) {
          callback(Math.round(progress * 100));
        }
      }
    );
    
    // Store active download
    activeDownloads.set(contentId, downloadResumable);
    
    // Start download
    const result = await downloadResumable.downloadAsync();
    
    // Clean up
    activeDownloads.delete(contentId);
    downloadProgressCallbacks.delete(contentId);
    
    if (!result || !result.uri) {
      return false;
    }
    
    // Get file size
    const fileInfo = await FileSystem.getInfoAsync(result.uri);
    const fileSize = (fileInfo as any).size || 0;
    
    // Save metadata
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
    
    // Remove any existing entry for this content
    const updatedDownloads = downloads.filter(d => d.contentId !== contentId);
    updatedDownloads.push(newDownload);
    await saveDownloadedContent(updatedDownloads);
    
    return true;
  } catch (error) {
    console.error('Error downloading audio:', error);
    activeDownloads.delete(contentId);
    downloadProgressCallbacks.delete(contentId);
    return false;
  }
}

/**
 * Cancel an active download
 */
export async function cancelDownload(contentId: string): Promise<void> {
  const download = activeDownloads.get(contentId);
  if (download) {
    try {
      await download.pauseAsync();
    } catch (error) {
      // Ignore errors when canceling
    }
    activeDownloads.delete(contentId);
    downloadProgressCallbacks.delete(contentId);
  }
}

/**
 * Check if a download is in progress
 */
export function isDownloading(contentId: string): boolean {
  return activeDownloads.has(contentId);
}

/**
 * Delete a downloaded content
 */
export async function deleteDownload(contentId: string): Promise<boolean> {
  try {
    const downloads = await getDownloadedContent();
    const download = downloads.find(d => d.contentId === contentId);
    
    if (download) {
      // Delete file
      const fileInfo = await FileSystem.getInfoAsync(download.localPath);
      if (fileInfo.exists) {
        await FileSystem.deleteAsync(download.localPath);
      }
      
      // Remove from metadata
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
 * Delete all downloaded content
 */
export async function deleteAllDownloads(): Promise<boolean> {
  try {
    const downloads = await getDownloadedContent();
    
    // Delete all files
    for (const download of downloads) {
      try {
        const fileInfo = await FileSystem.getInfoAsync(download.localPath);
        if (fileInfo.exists) {
          await FileSystem.deleteAsync(download.localPath);
        }
      } catch (error) {
        // Continue deleting other files
      }
    }
    
    // Clear metadata
    await saveDownloadedContent([]);
    
    return true;
  } catch (error) {
    console.error('Error deleting all downloads:', error);
    return false;
  }
}

/**
 * Get total storage used by downloads
 */
export async function getTotalStorageUsed(): Promise<number> {
  const downloads = await getDownloadedContent();
  return downloads.reduce((total, d) => total + d.fileSize, 0);
}

/**
 * Format bytes to human readable string
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Get downloaded content IDs for a specific type
 */
export async function getDownloadedContentIds(contentType: string): Promise<Set<string>> {
  const downloads = await getDownloadedContent();
  const ids = downloads.filter(d => d.contentType === contentType).map(d => d.contentId);
  return new Set(ids);
}
