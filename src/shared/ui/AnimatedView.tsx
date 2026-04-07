/**
 * ============================================================
 * AnimatedView.tsx — Reusable Animation Components
 * (Composition Pattern, Animation Lifecycle Management)
 * ============================================================
 *
 * Architectural Role:
 *   This module exports three animation wrapper components for common
 *   entrance animations:
 *   - AnimatedView: Fade + slide-up combo (default for list items)
 *   - StaggeredList: Applies AnimatedView with staggered delays
 *   - FadeView: Fade-only (no slide)
 *
 *   These are compositional building blocks for screen transitions and
 *   list item animations. They enable consistent, performance-optimized
 *   animations across the app without custom code in every component.
 *
 * Design Patterns:
 *   - Decorator Pattern: Each component wraps children in an Animated.View
 *     with configured animations, leaving children unchanged.
 *   - Higher-Order Component: Accepts children and animation parameters,
 *     returns the animated wrapper.
 *   - Parallel Animation: AnimatedView runs opacity and translateY animations
 *     simultaneously for a coordinated entrance effect.
 *   - Cleanup/Subscription Management: useEffect cleanup calls animation.stop()
 *     to prevent memory leaks if the component unmounts during animation.
 *
 * Performance Considerations:
 *   - useNativeDriver: true means animations run on the native thread,
 *     not blocking the JavaScript thread (critical for smooth UI)
 *   - Ref-based Animated.Value: stored in useRef, not state, to avoid
 *     triggering re-renders
 *   - Dependency array: includes fadeAnim and slideAnim, which are refs;
 *     they're stable, so the useEffect runs only when delay/duration change
 *
 * Consumed By:
 *   List screens, modals, and screens with entrance animations. Often used
 *   inside FlatList items or screen transitions.
 * ============================================================
 */

import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle } from 'react-native';

interface AnimatedViewProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  slideDistance?: number;
  style?: ViewStyle;
}

/**
 * AnimatedView — Fade + Slide-Up Entrance Animation
 *
 * This component animates in with two parallel effects:
 * 1. Opacity: 0 → 1 (fade in)
 * 2. TranslateY: slideDistance → 0 (slide up from below)
 *
 * The delay parameter staggers multiple AnimatedViews in a list,
 * creating a cascading entrance effect.
 *
 * @param delay - Start time in ms (used to stagger list items)
 * @param duration - Animation duration in ms (default 400)
 * @param slideDistance - Starting offset in pixels (default 20)
 */
export function AnimatedView({
  children,
  delay = 0,
  duration = 400,
  slideDistance = 20,
  style,
}: AnimatedViewProps) {
  // Two separate Animated.Values for opacity and translateY
  // Both are refs, not state, because they're driven natively
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(slideDistance)).current;

  useEffect(() => {
    // Parallel animation: both effects start and end at the same time
    // This creates a coordinated entrance (fade + slide up together)
    const animation = Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration,
        delay,
        useNativeDriver: true,
      }),
    ]);

    animation.start();

    // Cleanup: stop the animation if component unmounts during animation
    // This prevents memory leaks and silent errors from unmounted components
    // trying to update state
    return () => {
      animation.stop();
    };
  }, [fadeAnim, slideAnim, delay, duration]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: fadeAnim,
          // TranslateY: slides from slideDistance down to 0 (bottom-to-top)
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * StaggeredList — Orchestrates cascading list item animations
 *
 * This is a Composition pattern: it wraps multiple children in AnimatedView
 * components, each with a staggered delay (index * staggerDelay). The result
 * is a wave-like entrance where items animate in one after another, not all
 * at once. This is a common pattern in premium mobile apps.
 *
 * Example: with staggerDelay=50ms, first item starts immediately, second at 50ms,
 * third at 100ms, etc. Creates visual hierarchy and draws attention.
 *
 * @param staggerDelay - Time between each item's animation start (ms)
 * @param duration - How long each item takes to animate in
 */
interface StaggeredListProps {
  children: React.ReactNode[];
  staggerDelay?: number;
  duration?: number;
  style?: ViewStyle;
}

export function StaggeredList({
  children,
  staggerDelay = 50,
  duration = 400,
  style,
}: StaggeredListProps) {
  return (
    <>
      {/* Map over children and wrap each in AnimatedView with calculated delay */}
      {React.Children.map(children, (child, index) => (
        <AnimatedView delay={index * staggerDelay} duration={duration} style={style}>
          {child}
        </AnimatedView>
      ))}
    </>
  );
}

/**
 * FadeView — Fade-only animation (no vertical slide)
 *
 * Simpler than AnimatedView: only animates opacity from 0 to 1.
 * Use this for overlays, modals, or any element that should fade in
 * without spatial movement. Uses Timing (not spring) for linear, predictable
 * fade-in over the specified duration.
 */
interface FadeViewProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  style?: ViewStyle;
}

export function FadeView({
  children,
  delay = 0,
  duration = 300,
  style,
}: FadeViewProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Single animation: just opacity, no transform
    const animation = Animated.timing(fadeAnim, {
      toValue: 1,
      duration,
      delay,
      useNativeDriver: true,
    });

    animation.start();

    // Cleanup: stop if component unmounts
    return () => {
      animation.stop();
    };
  }, [fadeAnim, delay, duration]);

  return (
    <Animated.View style={[style, { opacity: fadeAnim }]}>
      {children}
    </Animated.View>
  );
}

