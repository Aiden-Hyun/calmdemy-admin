import React from "react";
import { TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { MediaPlayerStyles } from "./styles";

interface MediaPlayerHeaderProps {
  styles: MediaPlayerStyles;
  onBack: () => void;
  onOpenSleepTimer: () => void;
  onOpenBackgroundPicker: () => void;
  onToggleFavorite: () => void;
  onOpenReport: () => void;
  enableBackgroundAudio: boolean;
  isBackgroundAudioActive: boolean;
  isSleepTimerActive: boolean;
  isFavorited: boolean;
  showReportButton: boolean;
  showFavorite: boolean;
  showSleepTimer: boolean;
}

function MediaPlayerHeaderComponent({
  styles,
  onBack,
  onOpenSleepTimer,
  onOpenBackgroundPicker,
  onToggleFavorite,
  onOpenReport,
  enableBackgroundAudio,
  isBackgroundAudioActive,
  isSleepTimerActive,
  isFavorited,
  showReportButton,
  showFavorite,
  showSleepTimer,
}: MediaPlayerHeaderProps) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.backButton}>
        <Ionicons name="arrow-back" size={24} color="white" />
      </TouchableOpacity>

      <View style={styles.headerRight}>
        {showSleepTimer && (
          <TouchableOpacity
            onPress={onOpenSleepTimer}
            style={[styles.headerButton, isSleepTimerActive && styles.headerButtonActive]}
          >
            <Ionicons
              name="timer-outline"
              size={20}
              color={isSleepTimerActive ? "#7DAFB4" : "white"}
            />
          </TouchableOpacity>
        )}

        {enableBackgroundAudio && (
          <TouchableOpacity
            onPress={onOpenBackgroundPicker}
            style={[styles.headerButton, isBackgroundAudioActive && styles.headerButtonActive]}
          >
            <Ionicons
              name="musical-notes"
              size={20}
              color={isBackgroundAudioActive ? "#7DAFB4" : "white"}
            />
          </TouchableOpacity>
        )}

        {showFavorite && (
          <TouchableOpacity onPress={onToggleFavorite} style={styles.favoriteButton}>
            <Ionicons
              name={isFavorited ? "heart" : "heart-outline"}
              size={24}
              color={isFavorited ? "#FF6B6B" : "white"}
            />
          </TouchableOpacity>
        )}

        {showReportButton && (
          <TouchableOpacity onPress={onOpenReport} style={styles.headerButton}>
            <Ionicons name="flag-outline" size={20} color="white" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

export const MediaPlayerHeader = React.memo(MediaPlayerHeaderComponent);
