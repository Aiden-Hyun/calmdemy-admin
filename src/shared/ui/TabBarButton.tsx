/**
 * TabBarButton Component
 *
 * Architectural Role:
 * Custom bottom tab navigation button that enforces Apple Human Interface
 * Guidelines (HIG) accessibility requirements. Fixes App Review rejections
 * by ensuring adequate touch targets on all devices.
 *
 * Design Patterns:
 * - Wrapper Component: Enhances default behavior with accessibility compliance
 * - HIG Compliance: 44x44pt minimum + hitSlop expansion
 *
 * Key Dependencies:
 * - @react-navigation/bottom-tabs: BottomTabBarButtonProps interface
 * - React Native Pressable: Touch handling
 *
 * Consumed By:
 * - Bottom tab navigator (app navigation)
 *
 * Design Notes:
 * - Apple requires 44x44pt minimum touch targets (accessibility guideline)
 * - hitSlop adds 12pt expansion zone around visible button (not visible but tappable)
 * - Opacity feedback provides haptic-like visual feedback
 * - Intentionally filters Expo Router-specific props (href) to avoid Pressable errors
 */

import { Pressable, StyleSheet, GestureResponderEvent } from "react-native";
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";

/**
 * TabBarButton - Accessible bottom tab navigation button
 *
 * Wraps the default tab button to enforce Apple HIG accessibility standards:
 * - Minimum 44x44pt touch target
 * - Additional hitSlop for generous touch area
 * - Visual press feedback via opacity
 *
 * This prevents App Store Review rejections on smaller devices where tabs
 * might be too small by default (e.g., iPhone 13 mini).
 */
export function TabBarButton(props: BottomTabBarButtonProps) {
  /**
   * Prop Filtering:
   * Expo Router's bottom tab button may include additional props like href,
   * which Pressable doesn't support. We extract only compatible props to
   * avoid "Unknown prop" errors.
   */
  const {
    children,
    style,
    onPress,
    onLongPress,
    testID,
    accessibilityState,
    accessibilityLabel,
  } = props;

  const handlePress = (e: GestureResponderEvent) => {
    onPress?.(e);
  };

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={onLongPress}
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tab"
      testID={testID}
      // 12pt hitSlop on all sides expands touch target beyond visible button
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={({ pressed }) => [styles.button, style, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pressed: {
    opacity: 0.7,
  },
});
