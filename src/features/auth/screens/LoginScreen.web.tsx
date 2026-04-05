import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '@core/providers/contexts/AuthContext';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import type { Theme } from '@/theme';

export default function LoginScreenWeb() {
  const { user, signIn, signUp, signInWithGoogle } = useAuth();
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      router.replace('/admin');
    }
  }, [user]);

  const handleEmailAuth = async () => {
    if (!email.trim() || !password) {
      setError('Enter both email and password.');
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      if (isSignUpMode) {
        await signUp(email.trim(), password);
      } else {
        await signIn(email.trim(), password);
      }
      router.replace('/admin');
    } catch (nextError: any) {
      setError(nextError?.message || 'Sign-in failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleAuth = async () => {
    setError('');
    setIsSubmitting(true);

    try {
      await signInWithGoogle();
      router.replace('/admin');
    } catch (nextError: any) {
      setError(nextError?.message || 'Google sign-in failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.card}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>Calmdemy Web Admin</Text>
          </View>

          <Text style={styles.title}>Sign in to manage content</Text>
          <Text style={styles.subtitle}>
            This browser build is tuned for the admin tools, queue monitoring, and content review.
          </Text>

          <View style={styles.form}>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="Email"
              placeholderTextColor={theme.colors.textMuted}
              style={styles.input}
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              autoCapitalize="none"
              autoComplete="password"
              placeholder="Password"
              placeholderTextColor={theme.colors.textMuted}
              secureTextEntry
              style={styles.input}
              value={password}
              onChangeText={setPassword}
            />

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressedButton,
                isSubmitting && styles.disabledButton,
              ]}
              disabled={isSubmitting}
              onPress={handleEmailAuth}
            >
              {isSubmitting ? (
                <ActivityIndicator color={theme.colors.textOnPrimary} />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {isSignUpMode ? 'Create admin account' : 'Sign in'}
                </Text>
              )}
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.pressedButton,
                isSubmitting && styles.disabledButton,
              ]}
              disabled={isSubmitting}
              onPress={handleGoogleAuth}
            >
              <Text style={styles.secondaryButtonText}>Continue with Google</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => {
              setError('');
              setIsSignUpMode((current) => !current);
            }}
          >
            <Text style={styles.switchText}>
              {isSignUpMode
                ? 'Already have an account? Sign in'
                : 'Need a new account? Create one'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 520,
      alignSelf: 'center',
      backgroundColor: theme.colors.surfaceElevated,
      borderRadius: theme.borderRadius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border,
      padding: 28,
      gap: 16,
      ...theme.shadows.md,
    },
    badge: {
      alignSelf: 'flex-start',
      backgroundColor: `${theme.colors.primary}18`,
      borderRadius: theme.borderRadius.full,
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    badgeText: {
      color: theme.colors.primaryDark,
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    title: {
      color: theme.colors.text,
      fontFamily: theme.fonts.display.bold,
      fontSize: 32,
      lineHeight: 38,
    },
    subtitle: {
      color: theme.colors.textLight,
      fontFamily: theme.fonts.body.regular,
      fontSize: 16,
      lineHeight: 24,
    },
    form: {
      gap: 12,
    },
    input: {
      backgroundColor: theme.colors.background,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      color: theme.colors.text,
      fontFamily: theme.fonts.ui.regular,
      fontSize: 16,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    errorText: {
      color: theme.colors.error,
      fontFamily: theme.fonts.ui.medium,
      fontSize: 14,
    },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: theme.colors.primary,
      borderRadius: theme.borderRadius.md,
      justifyContent: 'center',
      minHeight: 52,
      paddingHorizontal: 18,
    },
    primaryButtonText: {
      color: theme.colors.textOnPrimary,
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
    },
    secondaryButton: {
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.border,
      justifyContent: 'center',
      minHeight: 52,
      paddingHorizontal: 18,
    },
    secondaryButtonText: {
      color: theme.colors.text,
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
    },
    pressedButton: {
      opacity: 0.86,
    },
    disabledButton: {
      opacity: 0.7,
    },
    switchText: {
      color: theme.colors.textLight,
      fontFamily: theme.fonts.ui.medium,
      fontSize: 14,
      textAlign: 'center',
    },
  });
