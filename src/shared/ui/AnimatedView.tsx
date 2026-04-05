import React, { useEffect, useRef } from 'react';
import { Animated, ViewStyle } from 'react-native';

interface AnimatedViewProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  slideDistance?: number;
  style?: ViewStyle;
}

export function AnimatedView({
  children,
  delay = 0,
  duration = 400,
  slideDistance = 20,
  style,
}: AnimatedViewProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(slideDistance)).current;

  useEffect(() => {
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
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

// Staggered list animation helper
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
      {React.Children.map(children, (child, index) => (
        <AnimatedView delay={index * staggerDelay} duration={duration} style={style}>
          {child}
        </AnimatedView>
      ))}
    </>
  );
}

// Fade only animation (no slide)
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
    const animation = Animated.timing(fadeAnim, {
      toValue: 1,
      duration,
      delay,
      useNativeDriver: true,
    });
    
    animation.start();
    
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

