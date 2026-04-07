/**
 * Media Player Styles
 *
 * Architectural Role:
 * Centralized style definitions for the media player component family
 * (header, content info, transport actions). Encapsulates all theme-dependent
 * styling for reusability across media player sub-components.
 *
 * Design Patterns:
 * - Style Factory: createMediaPlayerStyles(theme) generates theme-aware styles
 * - Composition: Sub-components receive pre-computed styles as props
 * - Dark Theme: Dark background (#333 area) with light text for video/playback UI
 *
 * Key Features:
 * - Centralized colors and spacing
 * - Responsive sizing (scaled based on content dimensions)
 * - Consistent button/badge styling
 * - State-specific styles (active, disabled, downloading)
 *
 * Used By:
 * - MediaPlayerHeader, MediaPlayerContentInfo, MediaPlayerTransportActions
 * - All use createMediaPlayerStyles(theme) to get styles
 */

import { StyleSheet } from "react-native";
import { Theme } from "@/theme";

/**
 * createMediaPlayerStyles - Theme-aware style factory
 *
 * Returns all style definitions for the media player component tree.
 * Called with theme to enable light/dark mode support and color customization.
 */
export const createMediaPlayerStyles = (theme: Theme) =>
  StyleSheet.create({
    fullScreen: {
      flex: 1,
    },
    safeArea: {
      flex: 1,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
    },
    loadingText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 16,
      color: 'white',
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    backButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(255, 255, 255, 0.15)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: 'rgba(255, 255, 255, 0.15)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerButtonActive: {
      backgroundColor: 'rgba(125, 175, 180, 0.25)',
    },
    headerButtonLiked: {
      backgroundColor: 'rgba(76, 175, 80, 0.25)',
    },
    headerButtonDisliked: {
      backgroundColor: 'rgba(255, 107, 107, 0.25)',
    },
    favoriteButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: 'rgba(255, 255, 255, 0.15)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    backgroundIndicator: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 12,
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      borderRadius: 16,
      alignSelf: 'center',
      marginTop: -8,
    },
    backgroundIndicatorText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      color: 'rgba(255, 255, 255, 0.7)',
    },
    sleepTimerIndicator: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 12,
      backgroundColor: 'rgba(125, 175, 180, 0.15)',
      borderRadius: 16,
      alignSelf: 'center',
      marginTop: 4,
    },
    sleepTimerIndicatorText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      color: '#7DAFB4',
    },
    content: {
      flex: 1,
    },
    contentContainer: {
      alignItems: 'center',
      paddingBottom: theme.spacing.xl,
    },
    iconContainer: {
      alignItems: 'center',
      marginTop: theme.spacing.xl,
      marginBottom: theme.spacing.xl,
    },
    iconCircle: {
      width: 140,
      height: 140,
      borderRadius: 70,
      backgroundColor: 'rgba(255, 255, 255, 0.15)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbnailImage: {
      width: 140,
      height: 140,
      borderRadius: 70,
    },
    infoContainer: {
      alignItems: 'center',
      marginBottom: theme.spacing.xl,
    },
    category: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: 'rgba(255, 255, 255, 0.7)',
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: theme.spacing.xs,
    },
    title: {
      fontFamily: theme.fonts.display.semiBold,
      fontSize: 28,
      color: 'white',
      textAlign: 'center',
      marginBottom: theme.spacing.sm,
    },
    metaInfoText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: 'rgba(255, 255, 255, 0.6)',
      textAlign: 'center',
      marginBottom: theme.spacing.sm,
    },
    description: {
      fontFamily: theme.fonts.body.regular,
      fontSize: 15,
      color: 'rgba(255, 255, 255, 0.85)',
      textAlign: 'center',
      lineHeight: 22,
      paddingHorizontal: theme.spacing.md,
      marginBottom: theme.spacing.md,
    },
    metaRow: {
      flexDirection: 'row',
      gap: theme.spacing.xl,
    },
    metaItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    metaText: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 14,
      color: 'rgba(255, 255, 255, 0.8)',
      textTransform: 'capitalize',
    },
    narratorSection: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    narratorPhoto: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 2,
      borderColor: 'rgba(255, 255, 255, 0.3)',
    },
    narratorPhotoPlaceholder: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: 'rgba(255, 255, 255, 0.15)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    narratorText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 14,
      color: 'rgba(255, 255, 255, 0.8)',
    },
    playerContainer: {
      width: '100%',
      marginBottom: theme.spacing.xl,
    },
    loadingPlayer: {
      alignItems: 'center',
      justifyContent: 'center',
      height: 150,
      gap: theme.spacing.md,
    },
    loadingPlayerText: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 14,
      color: 'rgba(255, 255, 255, 0.7)',
    },
    trackNavigationContainer: {
      marginTop: theme.spacing.lg,
      gap: 12,
    },
    trackNavigation: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 16,
    },
    trackNavButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: theme.borderRadius.full,
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
    trackNavButtonDisabled: {
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    trackNavText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 13,
      color: 'white',
    },
    trackNavTextDisabled: {
      color: 'rgba(255, 255, 255, 0.3)',
    },
    actionControls: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: theme.borderRadius.full,
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
    actionButtonActive: {
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
    },
    actionButtonLiked: {
      backgroundColor: 'rgba(76, 175, 80, 0.25)',
    },
    actionButtonDisliked: {
      backgroundColor: 'rgba(255, 107, 107, 0.25)',
    },
    actionButtonDownloading: {
      backgroundColor: 'rgba(255, 255, 255, 0.15)',
    },
    actionText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      color: 'rgba(255, 255, 255, 0.7)',
    },
    actionTextActive: {
      color: 'white',
    },
    actionTextDownloaded: {
      color: '#4CAF50',
    },
    // Keep old toggle styles for standalone section
    toggleButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: theme.borderRadius.full,
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
    toggleButtonActive: {
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
    },
    toggleButtonLiked: {
      backgroundColor: 'rgba(76, 175, 80, 0.25)',
    },
    toggleButtonDisliked: {
      backgroundColor: 'rgba(255, 107, 107, 0.25)',
    },
    toggleButtonDownloading: {
      backgroundColor: 'rgba(255, 255, 255, 0.15)',
    },
    toggleText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 12,
      color: 'rgba(255, 255, 255, 0.7)',
    },
    toggleTextActive: {
      color: 'white',
    },
    toggleTextDownloaded: {
      color: '#4CAF50',
    },
    standaloneDownload: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
      marginTop: theme.spacing.lg,
    },
  });

/**
 * MediaPlayerStyles Type:
 * TypeScript type for the style object returned by createMediaPlayerStyles.
 * Used in component prop interfaces to ensure type-safe style passing.
 *
 * Usage: styles: MediaPlayerStyles
 */
export type MediaPlayerStyles = ReturnType<typeof createMediaPlayerStyles>;
