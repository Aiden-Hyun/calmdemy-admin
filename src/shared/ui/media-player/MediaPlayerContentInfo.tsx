/**
 * MediaPlayerContentInfo Component
 *
 * Architectural Role:
 * Presentational sub-component for media player. Renders content metadata
 * (title, description, duration, instructor) in a polished layout. Part of
 * the media player composition pattern.
 *
 * Design Patterns:
 * - Leaf Component: Presentation layer with no business logic
 * - Memoized: Wrapped with React.memo to prevent unnecessary re-renders
 * - Composition: Composed by parent MediaPlayer screen
 * - Prop-driven Styling: All styles passed from parent for flexibility
 *
 * Key Dependencies:
 * - MediaPlayerStyles: Centralized style definitions from styles.ts
 * - Ionicons: Fallback icon when no image available
 *
 * Consumed By:
 * - MediaPlayer (main playback screen)
 *
 * Design Notes:
 * - Artwork can be image URL or icon + background
 * - Narrative/instructor photo is optional (shows placeholder if missing)
 * - Meta info (duration, difficulty) uses icon badges
 * - All margins/sizing passed as props for responsive layout
 */

import React from "react";
import { Image, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { MediaPlayerStyles } from "./styles";

interface MediaPlayerContentInfoProps {
  /** Pre-computed theme-based styles from MediaPlayer parent */
  styles: MediaPlayerStyles;
  /** Category name (e.g., "meditation", "sleep") */
  category: string;
  /** Content title */
  title: string;
  /** Dynamic font size (responsive to available space) */
  titleFontSize: number;
  /** Optional description/subtitle */
  description?: string;
  /** Optional metadata line (e.g., "Beginner friendly") */
  metaInfo?: string;
  /** Duration in minutes */
  durationMinutes: number;
  /** Optional difficulty badge (e.g., "Beginner") */
  difficultyLevel?: string;
  /** Instructor/narrator name */
  instructor?: string;
  /** Instructor photo URL (or null for placeholder) */
  narratorPhotoUrl?: string | null;
  /** Artwork image URL (if null, shows icon instead) */
  artworkThumbnailUrl?: string;
  /** Icon to show when no image available */
  artworkIcon: keyof typeof Ionicons.glyphMap;
  /** Artwork/image size in pixels */
  artworkSize: number;
  /** Icon size within the artwork circle */
  artworkIconSize: number;
  /** Vertical margin around sections */
  sectionMargin: number;
}

/**
 * MediaPlayerContentInfo - Content metadata display
 *
 * Shows structured content information:
 * - Artwork (image or icon)
 * - Title, category, description
 * - Duration and difficulty badges
 * - Instructor information with photo
 */
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
      {/* Artwork: Image or Icon + Background */}
      <View
        style={[
          styles.iconContainer,
          { marginTop: sectionMargin, marginBottom: sectionMargin },
        ]}
      >
        {artworkThumbnailUrl ? (
          /* Render actual image (circular) */
          <Image
            source={{ uri: artworkThumbnailUrl }}
            style={[
              styles.thumbnailImage,
              { width: artworkSize, height: artworkSize, borderRadius: artworkSize / 2 },
            ]}
          />
        ) : (
          /* Fallback: Circular background with icon */
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

      {/* Content Information Section */}
      <View style={[styles.infoContainer, { marginBottom: sectionMargin }]}>
        {/* Category label (e.g., "MEDITATION", "SLEEP STORIES") */}
        <Text style={styles.category}>{category.replace("-", " ")}</Text>

        {/* Main title with dynamic font size */}
        <Text style={[styles.title, { fontSize: titleFontSize }]}>{title}</Text>

        {/* Optional meta info line */}
        {metaInfo && <Text style={styles.metaInfoText}>{metaInfo}</Text>}

        {/* Optional description (capped at 2 lines) */}
        {description && (
          <Text style={styles.description} numberOfLines={2}>
            {description}
          </Text>
        )}

        {/* Duration and difficulty badges */}
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

        {/* Instructor/Narrator Section with photo */}
        {instructor && (
          <View style={styles.narratorSection}>
            {narratorPhotoUrl ? (
              /* Actual instructor photo */
              <Image source={{ uri: narratorPhotoUrl }} style={styles.narratorPhoto} />
            ) : (
              /* Placeholder when photo unavailable */
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

/**
 * Memoization:
 * Prevents re-renders when parent updates unless props actually change.
 * Critical for smooth player UI interactions.
 */
export const MediaPlayerContentInfo = React.memo(MediaPlayerContentInfoComponent);
