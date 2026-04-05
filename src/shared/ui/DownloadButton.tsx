import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import {
  isDownloaded,
  isDownloading,
  downloadAudio,
  cancelDownload,
  deleteDownload,
} from '@/services/downloadService';

interface DownloadButtonProps {
  contentId: string;
  contentType: string;
  audioUrl: string;
  metadata: {
    title: string;
    duration_minutes: number;
    thumbnailUrl?: string;
    parentId?: string;
    parentTitle?: string;
    audioPath?: string;
  };
  size?: number;
  darkMode?: boolean;
  onDownloadComplete?: () => void;
  /** When this changes, the download status is re-checked */
  refreshKey?: number | string;
  /** If provided and returns true, the download will be blocked and this callback will be invoked instead */
  onPremiumRequired?: () => void;
  /** Whether this content requires premium (used with onPremiumRequired) */
  isPremiumLocked?: boolean;
}

export function DownloadButton({
  contentId,
  contentType,
  audioUrl,
  metadata,
  size = 24,
  darkMode = false,
  onDownloadComplete,
  refreshKey,
  onPremiumRequired,
  isPremiumLocked = false,
}: DownloadButtonProps) {
  const { theme, isDark } = useTheme();
  const [downloaded, setDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  const useDarkColors = darkMode || isDark;

  // Check download status when contentId or refreshKey changes
  useEffect(() => {
    checkDownloadStatus();
  }, [contentId, refreshKey]);

  const checkDownloadStatus = async () => {
    const isAlreadyDownloaded = await isDownloaded(contentId);
    setDownloaded(isAlreadyDownloaded);
    setDownloading(isDownloading(contentId));
  };

  const handlePress = async () => {
    // Check if content is premium-locked and user doesn't have access
    if (isPremiumLocked && onPremiumRequired) {
      onPremiumRequired();
      return;
    }

    if (downloaded) {
      // Already downloaded - could show options menu for delete
      // For now, do nothing (or could toggle delete)
      return;
    }

    if (downloading) {
      // Cancel download
      await cancelDownload(contentId);
      setDownloading(false);
      setProgress(0);
      return;
    }

    // Start download
    setDownloading(true);
    setProgress(0);

    const success = await downloadAudio(
      contentId,
      contentType,
      audioUrl,
      metadata,
      (p) => setProgress(p)
    );

    setDownloading(false);
    setProgress(0);

    if (success) {
      setDownloaded(true);
      onDownloadComplete?.();
    }
  };

  const handleLongPress = async () => {
    if (downloaded) {
      // Delete on long press
      await deleteDownload(contentId);
      setDownloaded(false);
    }
  };

  const iconColor = useDarkColors ? theme.colors.sleepTextMuted : theme.colors.textMuted;
  const downloadedColor = '#4CAF50';

  if (downloading) {
    return (
      <TouchableOpacity
        onPress={handlePress}
        style={[styles.button, { width: size + 16, height: size + 16 }]}
      >
        <View style={styles.progressContainer}>
          <ActivityIndicator size="small" color={iconColor} />
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={500}
      style={[styles.button, { width: size + 16, height: size + 16 }]}
    >
      <Ionicons
        name={downloaded ? 'checkmark-circle' : 'arrow-down-circle-outline'}
        size={size}
        color={downloaded ? downloadedColor : iconColor}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
