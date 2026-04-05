import React from "react";
import { Image, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { MediaPlayerStyles } from "./styles";

interface MediaPlayerContentInfoProps {
  styles: MediaPlayerStyles;
  category: string;
  title: string;
  titleFontSize: number;
  description?: string;
  metaInfo?: string;
  durationMinutes: number;
  difficultyLevel?: string;
  instructor?: string;
  narratorPhotoUrl?: string | null;
  artworkThumbnailUrl?: string;
  artworkIcon: keyof typeof Ionicons.glyphMap;
  artworkSize: number;
  artworkIconSize: number;
  sectionMargin: number;
}

function MediaPlayerContentInfoComponent({
  styles,
  category,
  title,
  titleFontSize,
  description,
  metaInfo,
  durationMinutes,
  difficultyLevel,
  instructor,
  narratorPhotoUrl,
  artworkThumbnailUrl,
  artworkIcon,
  artworkSize,
  artworkIconSize,
  sectionMargin,
}: MediaPlayerContentInfoProps) {
  return (
    <>
      <View
        style={[
          styles.iconContainer,
          { marginTop: sectionMargin, marginBottom: sectionMargin },
        ]}
      >
        {artworkThumbnailUrl ? (
          <Image
            source={{ uri: artworkThumbnailUrl }}
            style={[
              styles.thumbnailImage,
              { width: artworkSize, height: artworkSize, borderRadius: artworkSize / 2 },
            ]}
          />
        ) : (
          <View
            style={[
              styles.iconCircle,
              { width: artworkSize, height: artworkSize, borderRadius: artworkSize / 2 },
            ]}
          >
            <Ionicons name={artworkIcon} size={artworkIconSize} color="white" />
          </View>
        )}
      </View>

      <View style={[styles.infoContainer, { marginBottom: sectionMargin }]}>
        <Text style={styles.category}>{category.replace("-", " ")}</Text>
        <Text style={[styles.title, { fontSize: titleFontSize }]}>{title}</Text>
        {metaInfo && <Text style={styles.metaInfoText}>{metaInfo}</Text>}
        {description && (
          <Text style={styles.description} numberOfLines={2}>
            {description}
          </Text>
        )}

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="time-outline" size={16} color="rgba(255,255,255,0.8)" />
            <Text style={styles.metaText}>{durationMinutes} min</Text>
          </View>
          {difficultyLevel && (
            <View style={styles.metaItem}>
              <Ionicons
                name="fitness-outline"
                size={16}
                color="rgba(255,255,255,0.8)"
              />
              <Text style={styles.metaText}>{difficultyLevel}</Text>
            </View>
          )}
        </View>

        {instructor && (
          <View style={styles.narratorSection}>
            {narratorPhotoUrl ? (
              <Image source={{ uri: narratorPhotoUrl }} style={styles.narratorPhoto} />
            ) : (
              <View style={styles.narratorPhotoPlaceholder}>
                <Ionicons name="person" size={16} color="rgba(255,255,255,0.6)" />
              </View>
            )}
            <Text style={styles.narratorText}>with {instructor}</Text>
          </View>
        )}
      </View>
    </>
  );
}

export const MediaPlayerContentInfo = React.memo(MediaPlayerContentInfoComponent);
