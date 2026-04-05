import { Pressable, StyleSheet, GestureResponderEvent } from "react-native";
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";

/**
 * Custom tab bar button that ensures Apple HIG compliance:
 * - Minimum 44x44pt touch target
 * - hitSlop for additional touch area
 * - Opacity feedback on press
 *
 * This fixes App Review issues where tabs may not be tappable
 * on smaller devices like iPhone 13 mini.
 */
export function TabBarButton(props: BottomTabBarButtonProps) {
  // Expo Router may provide additional props (e.g. href) that Pressable doesn't accept.
  // Pass through only the supported interaction/accessibility props.
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
