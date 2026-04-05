import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@core/providers/contexts/ThemeContext";
import { useJobDetail } from "@features/admin/hooks/useJobQueue";
import { getVoiceLabelById } from "@features/admin/constants/models";
import { getAudioUrlFromPath } from "@/constants/audioFiles";
import { useAudioPlayer } from "@shared/hooks/useAudioPlayer";
import { MediaPlayer } from "@shared/ui/MediaPlayer";
import { Theme } from "@/theme";

function getCourseGradient(): [string, string] {
  return ["#1C2A2E", "#2A3A3E"];
}

export default function AdminCourseSessionReviewScreen() {
  const { id, sessionCode } = useLocalSearchParams<{ id: string; sessionCode: string }>();
  const router = useRouter();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { job, executionView, isLoading } = useJobDetail(id);
  const audioPlayer = useAudioPlayer();
  const [audioUrl, setAudioUrl] = useState<string | undefined>(undefined);
  const [loadingAudio, setLoadingAudio] = useState(false);

  const canReview = Boolean(
    job &&
      executionView?.effectiveStatus === "completed" &&
      !job.autoPublish &&
      !job.courseRegeneration?.awaitingScriptApproval
  );
  const session = job?.coursePreviewSessions?.find((s) => s.code === sessionCode);

  useEffect(() => {
    let isMounted = true;
    async function loadAudio() {
      if (!session?.audioPath) return;
      setLoadingAudio(true);
      const url = await getAudioUrlFromPath(session.audioPath);
      if (url && isMounted) {
        setAudioUrl(url);
        audioPlayer.loadAudio(url);
      }
      if (isMounted) {
        setLoadingAudio(false);
      }
    }
    loadAudio();
    return () => {
      isMounted = false;
      audioPlayer.cleanup();
    };
  }, [session?.audioPath]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!job || !canReview) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color={theme.colors.textMuted} />
        <Text style={styles.emptyText}>Preview not available.</Text>
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color={theme.colors.textMuted} />
        <Text style={styles.emptyText}>Session not found.</Text>
      </View>
    );
  }

  const durationMinutes = session.durationSec ? Math.max(1, Math.ceil(session.durationSec / 60)) : 0;
  const narratorName = getVoiceLabelById(job.ttsVoice || "");

  return (
    <MediaPlayer
      category="course session"
      title={session.title || "Session Preview"}
      instructor={narratorName || "Guide"}
      description={session.label}
      durationMinutes={durationMinutes}
      gradientColors={getCourseGradient()}
      artworkIcon="school"
      isFavorited={false}
      isLoading={loadingAudio}
      audioPlayer={audioPlayer}
      onBack={() => {
        audioPlayer.cleanup();
        router.back();
      }}
      onToggleFavorite={() => {}}
      onPlayPause={() => {
        if (audioPlayer.isPlaying) {
          audioPlayer.pause();
        } else {
          audioPlayer.play();
        }
      }}
      loadingText="Loading preview..."
      audioUrl={audioUrl}
      skipRestore
      enableBackgroundAudio
      showFavorite={false}
      showSleepTimer={false}
      showReport={false}
      showAutoplay={false}
      showDownload={false}
      showRatings={false}
    />
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      backgroundColor: theme.colors.background,
      paddingHorizontal: 24,
    },
    emptyText: {
      fontFamily: "DMSans-SemiBold",
      fontSize: 16,
      color: theme.colors.text,
      textAlign: "center",
    },
  });
