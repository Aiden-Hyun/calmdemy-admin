import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@core/providers/contexts/ThemeContext";
import { useJobDetail } from "@features/admin/hooks/useJobQueue";
import { getVoiceLabelById } from "@features/admin/constants/models";
import { getAudioUrlFromPath } from "@/constants/audioFiles";
import { useAudioPlayer } from "@shared/hooks/useAudioPlayer";
import { MediaPlayer } from "@shared/ui/MediaPlayer";
import { Theme } from "@/theme";

function getGuidedGradient(themeKey?: string): [string, string] {
  switch (themeKey) {
    case "sleep":
      return ["#1A1D29", "#2A2D3E"];
    case "stress":
    case "anxiety":
      return ["#8B9F82", "#A8B89F"];
    case "focus":
      return ["#7B8FA1", "#9AABB8"];
    case "gratitude":
    case "loving-kindness":
      return ["#C4A77D", "#D4BFA0"];
    default:
      return ["#8B9F82", "#A8B89F"];
  }
}

function getPreviewStyle(contentType: string, themeKey?: string): { gradient: [string, string]; icon: keyof typeof Ionicons.glyphMap; category: string } {
  switch (contentType) {
    case "guided_meditation":
      return { gradient: getGuidedGradient(themeKey), icon: "leaf", category: "meditation" };
    case "sleep_meditation":
      return { gradient: ["#1A1D29", "#2A2D3E"], icon: "moon", category: "sleep meditation" };
    case "bedtime_story":
      return { gradient: ["#1A1D29", "#2A2D3E"], icon: "book", category: "bedtime story" };
    case "emergency_meditation":
      return { gradient: ["#E57373", "#F28B82"], icon: "flash", category: "emergency" };
    case "course_session":
      return { gradient: ["#1C2A2E", "#2A3A3E"], icon: "school", category: "course session" };
    default:
      return { gradient: ["#7B8FA1", "#9AABB8"], icon: "leaf", category: "audio" };
  }
}

function formatAudioLength(seconds?: number) {
  if (!seconds || seconds < 0) return "";
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export default function AdminJobReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
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

  useEffect(() => {
    let isMounted = true;
    async function loadAudio() {
      if (!job?.audioPath || job.contentType === "course") return;
      setLoadingAudio(true);
      const url = await getAudioUrlFromPath(job.audioPath);
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
  }, [job?.audioPath, job?.contentType]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!job) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color={theme.colors.textMuted} />
        <Text style={styles.emptyText}>Job not found</Text>
      </View>
    );
  }

  if (!canReview) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed-outline" size={48} color={theme.colors.textMuted} />
        <Text style={styles.emptyText}>Review is only available for completed, unpublished jobs.</Text>
      </View>
    );
  }

  if (job.contentType === "course") {
    const sessions = (job.coursePreviewSessions || []).slice().sort((a, b) => a.order - b.order);
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Course Preview</Text>
        <Text style={styles.subtitle}>Select a session to play the audio preview.</Text>
        {sessions.length === 0 ? (
          <View style={styles.card}>
            <Text style={styles.emptyText}>No preview sessions available.</Text>
          </View>
        ) : (
          sessions.map((session) => {
            const sessionDuration = formatAudioLength(session.durationSec);

            return (
              <Pressable
                key={session.code}
                style={({ pressed }) => [styles.sessionRow, pressed && { opacity: 0.85 }]}
                onPress={() =>
                  router.push({
                    pathname: "/admin/job/[id]/review/[sessionCode]",
                    params: { id: job.id, sessionCode: session.code },
                  })
                }
              >
                <View style={styles.sessionInfo}>
                  <Text style={styles.sessionTitle}>{session.title}</Text>
                  <View style={styles.sessionMetaRow}>
                    <Text style={styles.sessionMeta}>{session.label}</Text>
                    {sessionDuration ? (
                      <View style={styles.sessionDuration}>
                        <Ionicons name="time-outline" size={12} color={theme.colors.textMuted} />
                        <Text style={styles.sessionDurationText}>{sessionDuration}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <Ionicons name="play-circle-outline" size={24} color={theme.colors.text} />
              </Pressable>
            );
          })
        )}
      </ScrollView>
    );
  }

  const title = job.generatedTitle || job.title || "Audio Preview";
  const description = job.params?.topic || "";
  const durationMinutes = job.audioDurationSec ? Math.max(1, Math.ceil(job.audioDurationSec / 60)) : job.params?.duration_minutes || 0;
  const themeKey = job.params?.themes?.[0];
  const previewStyle = getPreviewStyle(job.contentType, themeKey);
  const narratorName = getVoiceLabelById(job.ttsVoice || "");

  return (
    <MediaPlayer
      category={previewStyle.category}
      title={title}
      instructor={narratorName || "Guide"}
      description={description}
      durationMinutes={durationMinutes}
      gradientColors={previewStyle.gradient}
      artworkIcon={previewStyle.icon}
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
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    content: {
      padding: 20,
    },
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
    title: {
      fontFamily: "DMSans-Bold",
      fontSize: 22,
      color: theme.colors.text,
      marginBottom: 6,
    },
    subtitle: {
      fontFamily: "DMSans-Regular",
      fontSize: 14,
      color: theme.colors.textMuted,
      marginBottom: 16,
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      padding: 16,
    },
    sessionRow: {
      backgroundColor: theme.colors.surface,
      borderRadius: 14,
      padding: 16,
      marginBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      ...theme.shadows.sm,
    },
    sessionInfo: {
      flex: 1,
      marginRight: 12,
    },
    sessionMetaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    sessionTitle: {
      fontFamily: "DMSans-SemiBold",
      fontSize: 16,
      color: theme.colors.text,
      marginBottom: 4,
    },
    sessionMeta: {
      flex: 1,
      fontFamily: "DMSans-Regular",
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    sessionDuration: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surfaceElevated,
    },
    sessionDurationText: {
      fontFamily: "DMSans-SemiBold",
      fontSize: 12,
      color: theme.colors.textMuted,
    },
  });
