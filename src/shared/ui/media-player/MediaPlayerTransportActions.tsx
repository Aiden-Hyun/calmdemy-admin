import React from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { RatingType } from "@/types";
import type { MediaPlayerStyles } from "./styles";

interface MediaPlayerTransportActionsProps {
  styles: MediaPlayerStyles;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  onRate?: (rating: RatingType) => Promise<RatingType | null>;
  userRating?: RatingType | null;
  autoPlayEnabled: boolean;
  onToggleAutoPlay: () => Promise<void>;
  canDownload: boolean;
  isDownloadedState: boolean;
  isDownloadingState: boolean;
  downloadProgress: number;
  onDownload: () => Promise<void>;
  showAutoplay?: boolean;
  showDownload?: boolean;
  showRatings?: boolean;
}

function MediaPlayerTransportActionsComponent({
  styles,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  onRate,
  userRating,
  autoPlayEnabled,
  onToggleAutoPlay,
  canDownload,
  isDownloadedState,
  isDownloadingState,
  downloadProgress,
  onDownload,
  showAutoplay = true,
  showDownload = true,
  showRatings = true,
}: MediaPlayerTransportActionsProps) {
  const showTrackNavigation = !!(onPrevious || onNext);

  const downloadButton = showDownload && canDownload ? (
    <TouchableOpacity
      style={[
        showTrackNavigation ? styles.actionButton : styles.toggleButton,
        isDownloadedState &&
          (showTrackNavigation ? styles.actionButtonActive : styles.toggleButtonActive),
        isDownloadingState &&
          (showTrackNavigation
            ? styles.actionButtonDownloading
            : styles.toggleButtonDownloading),
      ]}
      onPress={onDownload}
      activeOpacity={0.7}
      disabled={isDownloadingState || isDownloadedState}
    >
      {isDownloadingState ? (
        <>
          <ActivityIndicator size={14} color="white" />
          <Text style={showTrackNavigation ? styles.actionTextActive : styles.toggleTextActive}>
            {downloadProgress}%
          </Text>
        </>
      ) : (
        <>
          <Ionicons
            name={isDownloadedState ? "checkmark-circle" : "cloud-download-outline"}
            size={18}
            color={isDownloadedState ? "#4CAF50" : "rgba(255,255,255,0.7)"}
          />
          <Text
            style={[
              showTrackNavigation ? styles.actionText : styles.toggleText,
              isDownloadedState &&
                (showTrackNavigation
                  ? styles.actionTextDownloaded
                  : styles.toggleTextDownloaded),
            ]}
          >
            {isDownloadedState ? "Saved" : "Download"}
          </Text>
        </>
      )}
    </TouchableOpacity>
  ) : null;

  if (showTrackNavigation) {
    return (
      <View style={styles.trackNavigationContainer}>
        <View style={styles.trackNavigation}>
          <TouchableOpacity
            style={[styles.trackNavButton, !hasPrevious && styles.trackNavButtonDisabled]}
            onPress={hasPrevious ? onPrevious : undefined}
            disabled={!hasPrevious}
            activeOpacity={0.7}
          >
            <Ionicons
              name="play-skip-back"
              size={16}
              color={hasPrevious ? "white" : "rgba(255,255,255,0.3)"}
            />
            <Text style={[styles.trackNavText, !hasPrevious && styles.trackNavTextDisabled]}>
              Previous
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.trackNavButton, !hasNext && styles.trackNavButtonDisabled]}
            onPress={hasNext ? onNext : undefined}
            disabled={!hasNext}
            activeOpacity={0.7}
          >
            <Text style={[styles.trackNavText, !hasNext && styles.trackNavTextDisabled]}>
              Next
            </Text>
            <Ionicons
              name="play-skip-forward"
              size={16}
              color={hasNext ? "white" : "rgba(255,255,255,0.3)"}
            />
          </TouchableOpacity>
        </View>

        <View style={styles.actionControls}>
          {showRatings && onRate && (
            <TouchableOpacity
              style={[styles.actionButton, userRating === "like" && styles.actionButtonLiked]}
              onPress={() => onRate("like")}
              activeOpacity={0.7}
            >
              <Ionicons
                name={userRating === "like" ? "thumbs-up" : "thumbs-up-outline"}
                size={18}
                color={userRating === "like" ? "#4CAF50" : "rgba(255,255,255,0.7)"}
              />
            </TouchableOpacity>
          )}

          {showRatings && onRate && (
            <TouchableOpacity
              style={[
                styles.actionButton,
                userRating === "dislike" && styles.actionButtonDisliked,
              ]}
              onPress={() => onRate("dislike")}
              activeOpacity={0.7}
            >
              <Ionicons
                name={userRating === "dislike" ? "thumbs-down" : "thumbs-down-outline"}
                size={18}
                color={userRating === "dislike" ? "#FF6B6B" : "rgba(255,255,255,0.7)"}
              />
            </TouchableOpacity>
          )}

          {showAutoplay && (
            <TouchableOpacity
              style={[styles.actionButton, autoPlayEnabled && styles.actionButtonActive]}
              onPress={onToggleAutoPlay}
              activeOpacity={0.7}
            >
              <Ionicons
                name={autoPlayEnabled ? "play-forward-circle" : "play-forward-circle-outline"}
                size={18}
                color={autoPlayEnabled ? "white" : "rgba(255,255,255,0.7)"}
              />
              <Text style={[styles.actionText, autoPlayEnabled && styles.actionTextActive]}>
                Autoplay
              </Text>
            </TouchableOpacity>
          )}

          {downloadButton}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.standaloneDownload}>
      {showRatings && onRate && (
        <TouchableOpacity
          style={[styles.toggleButton, userRating === "like" && styles.toggleButtonLiked]}
          onPress={() => onRate("like")}
          activeOpacity={0.7}
        >
          <Ionicons
            name={userRating === "like" ? "thumbs-up" : "thumbs-up-outline"}
            size={16}
            color={userRating === "like" ? "#4CAF50" : "rgba(255,255,255,0.7)"}
          />
        </TouchableOpacity>
      )}

      {showRatings && onRate && (
        <TouchableOpacity
          style={[styles.toggleButton, userRating === "dislike" && styles.toggleButtonDisliked]}
          onPress={() => onRate("dislike")}
          activeOpacity={0.7}
        >
          <Ionicons
            name={userRating === "dislike" ? "thumbs-down" : "thumbs-down-outline"}
            size={16}
            color={userRating === "dislike" ? "#FF6B6B" : "rgba(255,255,255,0.7)"}
          />
        </TouchableOpacity>
      )}

      {downloadButton}
    </View>
  );
}

export const MediaPlayerTransportActions = React.memo(
  MediaPlayerTransportActionsComponent
);
