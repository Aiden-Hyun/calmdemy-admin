import AsyncStorage from '@react-native-async-storage/async-storage';

const DOWNLOADS_KEY = '@calmdemy_downloads_web';

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

export async function isDownloaded(_contentId: string): Promise<boolean> {
  return false;
}

export async function getLocalAudioPath(_contentId: string): Promise<string | null> {
  return null;
}

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

export async function cancelDownload(_contentId: string): Promise<void> {
  return undefined;
}

export function isDownloading(_contentId: string): boolean {
  return false;
}

export async function deleteDownload(contentId: string): Promise<boolean> {
  const downloads = await getDownloadedContent();
  const nextDownloads = downloads.filter((download) => download.contentId !== contentId);
  await AsyncStorage.setItem(DOWNLOADS_KEY, JSON.stringify(nextDownloads));
  return true;
}

export async function deleteAllDownloads(): Promise<boolean> {
  await AsyncStorage.removeItem(DOWNLOADS_KEY);
  return true;
}

export async function getTotalStorageUsed(): Promise<number> {
  return 0;
}

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

export async function getDownloadedContentIds(_contentType: string): Promise<Set<string>> {
  return new Set<string>();
}
