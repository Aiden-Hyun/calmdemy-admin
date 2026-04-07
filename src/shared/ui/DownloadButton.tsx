/**
 * DownloadButton.tsx
 *
 * Architectural Role:
 * Small icon button that manages audio download lifecycle (idle → downloading → downloaded).
 * Integrated into MediaPlayer and content cards. Coordinates with downloadService to track
 * download status and progress. Responds to touch with state transitions and visual feedback.
 *
 * Design Patterns:
 * - State Machine: Three states (idle/downloaded/downloading) with explicit transitions.
 *   Each state has a unique visual (icon) and behavior (press action).
 * - Premium Access Control: Checks isPremiumLocked and calls onPremiumRequired callback
 *   instead of initiating download if content requires subscription.
 * - Polling-based Status: useEffect checks download status when contentId or refreshKey changes,
 *   syncing local state with downloadService's persistent storage.
 *
 * Key Dependencies:
 * - downloadService: Manages file I/O, progress tracking, and caching
 * - ThemeContext: Icon colors adapt to dark/light mode
 *
 * Consumed By:
 * - MediaPlayer (play screen)
 * - ContentCard (discovery/library screens)
 * - Course/series detail pages
 */

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

  /**
   * Sync download status with downloadService whenever content ID changes or
   * a refresh key is provided. This allows parent components to signal that
   * download state may have changed without passing full state down.
   *
   * Example use: parent calls refreshKey++ after a song finishes downloading.
   */
  // Check download status when contentId or refreshKey changes
  useEffect(() => {
    checkDownloadStatus();
  }, [contentId, refreshKey]);

  /**
   * Query the download service to check if this content is:
   * 1. Already fully downloaded
   * 2. Currently being downloaded
   *
   * Used on mount and when contentId/refreshKey change to keep UI in sync.
   */
  const checkDownloadStatus = async () => {
    const isAlreadyDownloaded = await isDownloaded(contentId);
    setDownloaded(isAlreadyDownloaded);
    setDownloading(isDownloading(contentId));
  };

  /**
   * State machine for button press:
   * 1. Premium check: If locked, invoke callback and exit
   * 2. Downloaded state: No-op (long press handles deletion)
   * 3. Downloading state: Cancel in-progress download
   * 4. Idle state: Start a new download
   *
   * Uses progress callback to update any parent-level progress indicators.
   */
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

  /**
   * Long press gesture removes a downloaded file from local storage.
   * Prevents accidental deletion during normal tap, but makes cleanup easy.
   */
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
