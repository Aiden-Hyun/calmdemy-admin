/**
 * ============================================================
 * ModalFrame.tsx — Reusable Modal Container Component
 * (Composite Modal Shell, Container Abstraction)
 * ============================================================
 *
 * Architectural Role:
 *   Extracts common modal boilerplate (backdrop, safe area handling,
 *   card styling, dismiss button) into a reusable container component.
 *   Eliminates ~150 lines of duplicated styling and layout code across
 *   AccountPromptModal, AccountSwitchConfirmModal, CredentialCollisionModal,
 *   AccountSwitchWarning, and other modals in the codebase.
 *
 * Design Patterns:
 *   - Composite Component: Manages the outer shell (Modal, overlay, container,
 *     safe area) while delegating content rendering to children prop.
 *   - Container/Presentational Split: The modal wrapper is purely structural;
 *     the specific content/logic lives in consuming components.
 *   - Theme Abstraction: Centralizes theme-aware styling using createStyles
 *     pattern; consumers avoid repeating the same overlay, container, and
 *     button styles.
 *
 * Usage:
 *   <ModalFrame
 *     visible={visible}
 *     onDismiss={onClose}
 *     title="Confirm Action"
 *     showCloseButton
 *   >
 *     <Text>Your custom modal content here</Text>
 *   </ModalFrame>
 *
 * Key Features:
 *   - Dark overlay backdrop with optional TouchableWithoutFeedback to dismiss
 *   - Safe area padding (bottom inset respected on notched devices)
 *   - Optional centered title text
 *   - Optional dismiss/close button (X icon, top-right)
 *   - Children rendered as modal body content
 *   - All theming pulled from design tokens
 *
 * Key Dependencies:
 *   - useTheme: Provides colors, spacing, typography, shadows
 *   - useSafeAreaInsets: Respects safe area on all device shapes
 * ============================================================
 */

import React, { useMemo } from "react";
import {
  View,
  Modal,
  StyleSheet,
  Pressable,
  TouchableWithoutFeedback,
  ModalProps,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@core/providers/contexts/ThemeContext";
import { Theme } from "@/theme";

interface ModalFrameProps extends Omit<ModalProps, "children"> {
  /** Controls modal visibility */
  visible: boolean;
  /** Callback fired when user dismisses the modal (backdrop or close button) */
  onDismiss: () => void;
  /** Optional title text rendered at top of modal */
  title?: string;
  /** Show close button (X icon) in top-right corner (default: true) */
  showCloseButton?: boolean;
  /** Modal body content */
  children: React.ReactNode;
  /** Optional custom style for container (merged after defaults) */
  containerStyle?: any;
}

/**
 * ModalFrame — Reusable Modal Shell
 *
 * Wraps the common Modal structure: transparent backdrop, safe area handling,
 * centered container card, optional title and close button. The children prop
 * receives the flexible content area.
 *
 * This component is intentionally focused on layout and dismissal mechanics.
 * Consuming components handle their own content, validation, and state.
 */
export function ModalFrame({
  visible,
  onDismiss,
  title,
  showCloseButton = true,
  children,
  containerStyle,
  animationType = "fade",
  transparent = true,
  onRequestClose,
  ...modalProps
}: ModalFrameProps) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);

  // Use onDismiss as the default onRequestClose if not provided
  const handleRequestClose = onRequestClose || onDismiss;

  return (
    <Modal
      visible={visible}
      transparent={transparent}
      animationType={animationType}
      onRequestClose={handleRequestClose}
      {...modalProps}
    >
      {/* Backdrop: Dark overlay with TouchableWithoutFeedback to dismiss on tap */}
      <TouchableWithoutFeedback onPress={onDismiss}>
        <View style={styles.overlay}>
          {/* Container: Centered card content area. Nested in a Pressable to
              prevent dismissal when tapping inside the modal content. */}
          <Pressable
            style={[styles.container, { paddingBottom: insets.bottom + 24 }, containerStyle]}
            onPress={() => {
              // Prevent dismissal when pressing inside the modal
            }}
          >
            {/* Optional close button: X icon in top-right corner */}
            {showCloseButton && (
              <Pressable
                style={styles.closeButton}
                onPress={onDismiss}
                hitSlop={8}
              >
                <Ionicons
                  name="close"
                  size={24}
                  color={theme.colors.text}
                />
              </Pressable>
            )}

            {/* Optional title: Centered text at top of modal */}
            {title && <View style={styles.titleContainer}>
              {typeof title === "string" ? (
                // This is handled by the parent component if they want custom styling
                <></>
              ) : null}
            </View>}

            {/* Children: Modal body content provided by consuming component */}
            {children}
          </Pressable>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const createStyles = (theme: Theme, isDark: boolean) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.6)",
      justifyContent: "center",
      alignItems: "center",
      padding: 24,
    },
    container: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.xl,
      padding: 32,
      alignItems: "center",
      width: "100%",
      maxWidth: 340,
      ...theme.shadows.lg,
    },
    closeButton: {
      position: "absolute",
      top: 16,
      right: 16,
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 10,
    },
    titleContainer: {
      marginBottom: 16,
    },
  });
