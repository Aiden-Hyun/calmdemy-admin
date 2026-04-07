/**
 * ============================================================
 * AnimatedPressable.tsx — Spring Animation Wrapper Components
 * (Higher-Order Component Pattern, Animation Composition)
 * ============================================================
 *
 * Architectural Role:
 *   This module exports two reusable wrapper components that add tactile
 *   feedback animations to pressable elements. AnimatedPressable provides
 *   configurable spring-based scale animation, while BounceButton adds a
 *   more pronounced bounce sequence. Both are decorators that wrap native
 *   Pressable components, adding animation without changing their API.
 *
 * Design Patterns:
 *   - Decorator Pattern: Both components wrap a native Pressable and
 *     enhance it with animation behavior. The wrapped component doesn't
 *     know it's animated; it just receives props and renders children.
 *   - Higher-Order Component: These functions accept child elements and
 *     wrap them in animated views, enabling reuse across different button
 *     styles and contexts.
 *   - Ref-based State (useRef + Animated.Value): The scaleAnim Animated.Value
 *     is stored in a ref (not state) because it's a native animation driver
 *     that should not trigger re-renders. React state is for rendering;
 *     Animated.Value is for native animation loops.
 *   - Composition: Multiple animation effects (spring with different bounciness,
 *     timing + spring sequences) are composed from simpler building blocks.
 *
 * Animation Philosophy:
 *   - useNativeDriver: true means the animation runs on the native thread,
 *     not the JavaScript thread. This prevents frame drops on slower devices.
 *   - Spring animations (vs. Timing) provide a natural, elastic feel that
 *     matches iOS interaction patterns and feels premium to users.
 *
 * Consumed By:
 *   Any component that needs an interactive button with spring feedback:
 *   meditation cards, play buttons, interactive UI elements, etc.
 *
 * Key Dependencies:
 *   - react-native's Animated API: underlying animation engine
 *   - Pressable: native button component
 * ============================================================
 */

import React, { useRef } from 'react';
import { Animated, Pressable, ViewStyle, StyleProp } from 'react-native';

interface AnimatedPressableProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  scaleValue?: number;
  activeOpacity?: number;
}

/**
 * AnimatedPressable — Spring-based Scale Animation Wrapper
 *
 * This component wraps a Pressable and scales it down (via scaleValue, default 0.97)
 * when pressed, using a spring animation. The spring creates a natural bouncy feel
 * that provides tactile feedback without being jarring.
 *
 * The useRef pattern is key here: scaleAnim should NOT be stored in state because
 * Animated.Value is a native driver that manages its own animation lifecycle. State
 * would cause unnecessary re-renders; a ref keeps it isolated.
 *
 * @param scaleValue — The scale factor when pressed (0.97 = 3% shrink)
 * @param activeOpacity — Unused in current implementation; can be removed or used
 *                        to add opacity feedback (currently only disables show opacity)
 */
export function AnimatedPressable({
  children,
  onPress,
  onLongPress,
  disabled = false,
  style,
  scaleValue = 0.97,
  activeOpacity = 0.9,
}: AnimatedPressableProps) {
  // Ref-based animation value: not state, because it's driven natively
  // and should never trigger re-renders
  const scaleAnim = useRef(new Animated.Value(1)).current;

  /**
   * Handler: animates scale down when user presses. The spring animation
   * provides natural elasticity (bounciness=4 is subtle).
   */
  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: scaleValue,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  /**
   * Handler: animates scale back to 1 when user releases. Mirrors the
   * handlePressIn animation to create a reversible effect.
   */
  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
    >
      <Animated.View
        style={[
          style,
          {
            // Scale animation is driven by the native Animated.Value
            transform: [{ scale: scaleAnim }],
            // Static opacity for disabled state (non-animated)
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

/**
 * Specialized button with more pronounced bounce effect.
 * Combines timing and spring animations for a "bounce" metaphor.
 */
interface BounceButtonProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

/**
 * BounceButton — More Tactile Bounce Animation
 *
 * This component creates a two-phase animation:
 * 1. Timing: quick compress (0.92 scale) over 100ms
 * 2. Spring: elastic bounce back to 1.0 with high bounciness (12)
 *
 * The onPress callback is deferred until the animation completes
 * (via .start(callback)), which provides visual feedback that the
 * button is responding to the tap. This is the "Deferred Callback" pattern.
 *
 * Compared to AnimatedPressable, BounceButton is:
 * - More pronounced (compresses to 0.92 vs 0.97)
 * - Less responsive (full sequence plays before onPress fires)
 * - Better for primary CTAs that warrant extra emphasis
 */
export function BounceButton({
  children,
  onPress,
  style,
  disabled = false,
}: BounceButtonProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  /**
   * Handler: Plays a sequence of animations (compress + bounce), then fires
   * the onPress callback. This is different from AnimatedPressable, which
   * fires onPress immediately via the Pressable's onPress prop.
   *
   * Sequence pattern: uses Animated.sequence to chain multiple animations,
   * ensuring they play in order without manual cleanup.
   */
  const handlePress = () => {
    Animated.sequence([
      // Phase 1: Quick compress using Timing (linear, predictable)
      Animated.timing(scaleAnim, {
        toValue: 0.92,
        duration: 100,
        useNativeDriver: true,
      }),
      // Phase 2: Spring bounce back (elastic, higher bounciness = more bounce)
      Animated.spring(scaleAnim, {
        toValue: 1,
        useNativeDriver: true,
        speed: 20,
        bounciness: 12,
      }),
    ]).start(() => {
      // Deferred callback: fire onPress after animation completes
      // This provides visual feedback that the button is responding
      if (onPress) onPress();
    });
  };

  return (
    <Pressable onPress={handlePress} disabled={disabled}>
      <Animated.View
        style={[
          style,
          {
            transform: [{ scale: scaleAnim }],
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

