import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Animated,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { SvgXml } from "react-native-svg";
import { useAuth, CredentialCollisionError } from "@core/providers/contexts/AuthContext";
import { useTheme } from "@core/providers/contexts/ThemeContext";
import { AnimatedPressable } from "@shared/ui/AnimatedPressable";
import { AnimatedView } from "@shared/ui/AnimatedView";
import { CredentialCollisionModal } from "@shared/ui/CredentialCollisionModal";
import { AccountSwitchConfirmModal } from "@shared/ui/AccountSwitchConfirmModal";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { Theme } from "@/theme";

export default function LoginScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const isLinkMode = mode === 'link'; // true when user tapped "Link Account" from Settings
  const navigation = useNavigation();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const {
    user,
    isAnonymous,
    signUp,
    signIn,
    signInAnonymously,
    signInWithGoogle,
    signInWithApple,
    upgradeAnonymousWithGoogle,
    upgradeAnonymousWithApple,
    upgradeAnonymousWithEmail,
    signInWithPendingCredential,
    isAppleSignInAvailable,
    loading,
  } = useAuth();
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
  const [collisionError, setCollisionError] = useState<CredentialCollisionError | null>(null);
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false);
  const { theme, isDark } = useTheme();

  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);

  const GOOGLE_SVG_XML = `
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="40" height="40" rx="20" fill="#F2F2F2"/>
    <g clip-path="url(#clip0_710_6221)">
    <path d="M29.6 20.2273C29.6 19.5182 29.5364 18.8364 29.4182 18.1818H20V22.05H25.3818C25.15 23.3 24.4455 24.3591 23.3864 25.0682V27.5773H26.6182C28.5091 25.8364 29.6 23.2727 29.6 20.2273Z" fill="#4285F4"/>
    <path d="M20 30C22.7 30 24.9636 29.1045 26.6181 27.5773L23.3863 25.0682C22.4909 25.6682 21.3454 26.0227 20 26.0227C17.3954 26.0227 15.1909 24.2636 14.4045 21.9H11.0636V24.4909C12.7091 27.7591 16.0909 30 20 30Z" fill="#34A853"/>
    <path d="M14.4045 21.9C14.2045 21.3 14.0909 20.6591 14.0909 20C14.0909 19.3409 14.2045 18.7 14.4045 18.1V15.5091H11.0636C10.3864 16.8591 10 18.3864 10 20C10 21.6136 10.3864 23.1409 11.0636 24.4909L14.4045 21.9Z" fill="#FBBC04"/>
    <path d="M20 13.9773C21.4681 13.9773 22.7863 14.4818 23.8227 15.4727L26.6909 12.6045C24.9591 10.9909 22.6954 10 20 10C16.0909 10 12.7091 12.2409 11.0636 15.5091L14.4045 18.1C15.1909 15.7364 17.3954 13.9773 20 13.9773Z" fill="#E94235"/>
    </g>
    <defs>
    <clipPath id="clip0_710_6221">
    <rect width="20" height="20" fill="white" transform="translate(10 10)"/>
    </clipPath>
    </defs>
    </svg>
  `;

  // Button loading animation
  const buttonScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (loading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(buttonScale, {
            toValue: 0.98,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(buttonScale, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      buttonScale.setValue(1);
    }
  }, [loading, buttonScale]);

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert("Error", "Please fill in all fields");
      return;
    }

    try {
      // Link mode: link email/password to anonymous account
      if (isLinkMode && isAnonymous) {
        await upgradeAnonymousWithEmail(email, password);
        Alert.alert("Success", "Email linked to your account!");
        router.replace('/(tabs)/home');
        return;
      }
      
      // Normal sign up/sign in
      if (isSignUp) {
        await signUp(email, password);
        Alert.alert(
          "Success",
          "Account created! Please check your email to verify.",
        );
        router.replace('/(tabs)/home');
      } else {
        await signIn(email, password);
        router.replace('/(tabs)/home');
      }
    } catch (error: any) {
      // Handle collision in link mode
      if (error instanceof CredentialCollisionError) {
        setCollisionError(error);
      } else {
        Alert.alert("Error", error.message);
      }
    }
  };

  const handleGoogleSignIn = async () => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/abd8d170-6f53-45be-bd37-3634e6180c4d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'login.tsx:handleGoogleSignIn:entry',message:'Google sign-in button pressed',data:{isAnonymous,isLinkMode,hasUser:!!user},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'FIX'})}).catch(()=>{});
    // #endregion
    try {
      setGoogleLoading(true);
      
      // Only use upgrade (link) when user explicitly tapped "Link Account" (mode=link)
      // Otherwise, use regular sign-in which replaces the anonymous user
      if (isLinkMode && isAnonymous) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/abd8d170-6f53-45be-bd37-3634e6180c4d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'login.tsx:handleGoogleSignIn:upgrading',message:'Link mode - using upgradeAnonymousWithGoogle',data:{userId:user?.uid},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'FIX'})}).catch(()=>{});
        // #endregion
        await upgradeAnonymousWithGoogle();
        router.replace('/(tabs)/home');
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/abd8d170-6f53-45be-bd37-3634e6180c4d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'login.tsx:handleGoogleSignIn:signIn',message:'Sign-in mode - using signInWithGoogle',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'FIX'})}).catch(()=>{});
        // #endregion
        await signInWithGoogle();
        router.replace('/(tabs)/home');
      }
    } catch (error: any) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/abd8d170-6f53-45be-bd37-3634e6180c4d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'login.tsx:handleGoogleSignIn:catch',message:'Caught error',data:{errorType:error?.constructor?.name,isCollisionError:error instanceof CredentialCollisionError,errorMessage:error?.message},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'FIX'})}).catch(()=>{});
      // #endregion
      if (error instanceof CredentialCollisionError) {
        setCollisionError(error);
      } else if (error.message && error.message !== "User cancelled") {
        Alert.alert("Error", error.message);
      }
      // User cancelled - do nothing, stay on current page
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/abd8d170-6f53-45be-bd37-3634e6180c4d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'login.tsx:handleAppleSignIn:entry',message:'Apple sign-in button pressed',data:{isAnonymous,isLinkMode,hasUser:!!user},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'FIX'})}).catch(()=>{});
    // #endregion
    try {
      setAppleLoading(true);
      
      // Only use upgrade (link) when user explicitly tapped "Link Account" (mode=link)
      // Otherwise, use regular sign-in which replaces the anonymous user
      if (isLinkMode && isAnonymous) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/abd8d170-6f53-45be-bd37-3634e6180c4d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'login.tsx:handleAppleSignIn:upgrading',message:'Link mode - using upgradeAnonymousWithApple',data:{userId:user?.uid},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'FIX'})}).catch(()=>{});
        // #endregion
        await upgradeAnonymousWithApple();
        router.replace('/(tabs)/home');
      } else {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/abd8d170-6f53-45be-bd37-3634e6180c4d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'login.tsx:handleAppleSignIn:signIn',message:'Sign-in mode - using signInWithApple',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'FIX'})}).catch(()=>{});
        // #endregion
        await signInWithApple();
        router.replace('/(tabs)/home');
      }
    } catch (error: any) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/abd8d170-6f53-45be-bd37-3634e6180c4d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'login.tsx:handleAppleSignIn:catch',message:'Caught error',data:{errorType:error?.constructor?.name,isCollisionError:error instanceof CredentialCollisionError,errorMessage:error?.message},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'FIX'})}).catch(()=>{});
      // #endregion
      if (error instanceof CredentialCollisionError) {
        setCollisionError(error);
      } else if (error.message && error.message !== "User cancelled") {
        Alert.alert("Error", error.message);
      }
      // User cancelled - do nothing, stay on current page
    } finally {
      setAppleLoading(false);
    }
  };

  const handleSkipLogin = async () => {
    // If not signed in, create an anonymous session first
    if (!user) {
      try {
        await signInAnonymously();
      } catch (error: any) {
        Alert.alert("Error", error.message);
        return;
      }
    }

    // Prefer going back when history exists; otherwise fall back to home
    const canGoBack = typeof (navigation as any)?.canGoBack === "function"
      ? (navigation as any).canGoBack()
      : false;

    if (canGoBack) {
      (navigation as any).goBack();
    } else {
      router.replace('/(tabs)/home');
    }
  };

  // Collision modal handler - show switch confirmation modal
  const handleCollisionSignIn = () => {
    setShowSwitchConfirm(true);
  };

  // Handle confirmed account switch - auto sign in with pending credential
  const handleConfirmSwitch = async () => {
    if (!collisionError?.pendingCredential) return;
    try {
      await signInWithPendingCredential(collisionError.pendingCredential);
      setCollisionError(null);
      setShowSwitchConfirm(false);
      router.replace('/(tabs)/home');
    } catch (error: any) {
      Alert.alert("Error", error.message || "Failed to sign in");
    }
  };

  // Cancel switch - go back to collision modal
  const handleCancelSwitch = () => {
    setShowSwitchConfirm(false);
  };

  // Link mode uses a blue/purple accent to visually distinguish from regular login
  const linkAccentColor = '#6366F1'; // Indigo
  const linkAccentLight = '#E0E7FF'; // Indigo light
  
  const heroGradient = isDark
    ? ([theme.colors.gray[100], theme.colors.background] as [string, string])
    : isLinkMode
    ? ([linkAccentLight, theme.colors.background] as [string, string])
    : ([theme.colors.primaryLight, theme.colors.background] as [
        string,
        string,
      ]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Section */}
        <LinearGradient
          colors={heroGradient}
          style={styles.hero}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        >
          <AnimatedView delay={0} duration={600}>
            <View style={styles.logoContainer}>
              <View style={[styles.logoCircle, isLinkMode && { backgroundColor: linkAccentLight }]}>
                <Ionicons 
                  name={isLinkMode ? "link" : "leaf"} 
                  size={40} 
                  color={isLinkMode ? linkAccentColor : theme.colors.primary} 
                />
              </View>
            </View>
          </AnimatedView>

          <AnimatedView delay={100} duration={600}>
            <Text style={[styles.title, isLinkMode && { color: linkAccentColor }]}>
              {isLinkMode ? "Link Account" : "Calmdemy"}
            </Text>
          </AnimatedView>

          <AnimatedView delay={200} duration={600}>
            <Text style={styles.subtitle}>
              {isLinkMode ? "Secure your subscription" : "Find your inner peace"}
            </Text>
          </AnimatedView>
        </LinearGradient>

        {/* Form Section */}
        <View style={styles.formContainer}>
          <AnimatedView delay={300} duration={500}>
            <View style={styles.formHeader}>
              <Text style={styles.formTitle}>
                {isLinkMode
                  ? "Link Your Account"
                  : isSignUp
                  ? "Create Account"
                  : "Welcome Back"}
              </Text>
              <Text style={styles.formSubtitle}>
                {isLinkMode
                  ? "Connect a sign-in method to secure your subscription"
                  : isSignUp
                  ? "Start your mindfulness journey today"
                  : "Continue your mindfulness journey"}
              </Text>
            </View>
          </AnimatedView>

          {/* Google Sign In Button */}
          <AnimatedView delay={400} duration={500}>
            <AnimatedPressable
              onPress={handleGoogleSignIn}
              disabled={googleLoading}
              style={styles.googleButton}
            >
              <View style={styles.googleButtonInner}>
                {googleLoading ? (
                  <ActivityIndicator color={theme.colors.text} size="small" />
                ) : (
                  <>
                    <View style={styles.googleIconContainer}>
                      <SvgXml xml={GOOGLE_SVG_XML} width={35} height={35} />
                    </View>
                    <Text style={styles.googleButtonText}>
                      {isLinkMode ? "Link with Google" : "Continue with Google"}
                    </Text>
                  </>
                )}
              </View>
            </AnimatedPressable>
          </AnimatedView>

          {/* Apple Sign In Button - iOS only */}
          {isAppleSignInAvailable && (
            <AnimatedView delay={500} duration={500}>
              <AnimatedPressable
                onPress={handleAppleSignIn}
                disabled={appleLoading}
                style={styles.appleButton}
              >
                <View style={styles.appleButtonInner}>
                  {appleLoading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Ionicons name="logo-apple" size={20} color="#fff" />
                      <Text style={styles.appleButtonText}>
                        {isLinkMode ? "Link with Apple" : "Continue with Apple"}
                      </Text>
                    </>
                  )}
                </View>
              </AnimatedPressable>
            </AnimatedView>
          )}

          {/* Link mode info banner */}
          {isLinkMode && (
            <AnimatedView delay={600} duration={500}>
              <View style={[styles.linkInfoBanner, { backgroundColor: `${linkAccentColor}15` }]}>
                <Ionicons name="information-circle-outline" size={20} color={linkAccentColor} />
                <Text style={styles.linkInfoText}>
                  Linking preserves your subscription and data. Choose a sign-in method you'll remember.
                </Text>
              </View>
            </AnimatedView>
          )}

          {/* Divider */}
          <AnimatedView delay={600} duration={500}>
            <View style={styles.dividerContainer}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>
          </AnimatedView>

          {/* Email / Password */}
          <AnimatedView delay={700} duration={500}>
                <View
                  style={[
                    styles.inputContainer,
                    emailFocused && styles.inputContainerFocused,
                    emailFocused && isLinkMode && { borderColor: linkAccentColor },
                  ]}
                >
                  <Ionicons
                    name="mail-outline"
                    size={20}
                    color={
                      emailFocused 
                        ? (isLinkMode ? linkAccentColor : theme.colors.primary) 
                        : theme.colors.textMuted
                    }
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Email"
                    placeholderTextColor={theme.colors.textMuted}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    onFocus={() => setEmailFocused(true)}
                    onBlur={() => setEmailFocused(false)}
                  />
                </View>
              </AnimatedView>

              <AnimatedView delay={800} duration={500}>
                <View
                  style={[
                    styles.inputContainer,
                    passwordFocused && styles.inputContainerFocused,
                    passwordFocused && isLinkMode && { borderColor: linkAccentColor },
                  ]}
                >
                  <Ionicons
                    name="lock-closed-outline"
                    size={20}
                    color={
                      passwordFocused
                        ? (isLinkMode ? linkAccentColor : theme.colors.primary)
                        : theme.colors.textMuted
                    }
                    style={styles.inputIcon}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor={theme.colors.textMuted}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    onFocus={() => setPasswordFocused(true)}
                    onBlur={() => setPasswordFocused(false)}
                  />
                </View>
              </AnimatedView>

          <AnimatedView delay={900} duration={500}>
            <AnimatedPressable
              onPress={handleAuth}
              disabled={loading}
              style={styles.authButton}
            >
              <Animated.View
                style={[
                  styles.authButtonInner,
                  isLinkMode && { backgroundColor: linkAccentColor },
                  { transform: [{ scale: buttonScale }] },
                ]}
              >
                {loading ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <>
                    <Text style={styles.authButtonText}>
                      {isLinkMode
                        ? "Link with Email"
                        : isSignUp
                        ? "Create Account"
                        : "Sign In"}
                    </Text>
                    <Ionicons name="arrow-forward" size={20} color="white" />
                  </>
                )}
              </Animated.View>
            </AnimatedPressable>
          </AnimatedView>

          {/* Toggle between Sign Up / Sign In - hide in link mode */}
          {!isLinkMode && (
            <AnimatedView delay={1000} duration={500}>
              <AnimatedPressable
                onPress={() => setIsSignUp(!isSignUp)}
                style={styles.switchButton}
              >
                <Text style={styles.switchText}>
                  {isSignUp
                    ? "Already have an account? "
                    : "Don't have an account? "}
                  <Text style={styles.switchTextHighlight}>
                    {isSignUp ? "Sign In" : "Sign Up"}
                  </Text>
                </Text>
              </AnimatedPressable>
            </AnimatedView>
          )}
          
          {/* Link mode helper text */}
          {isLinkMode && (
            <AnimatedView delay={1000} duration={500}>
              <Text style={styles.linkHelperText}>
                Enter a new email and password to secure your account. If the email is already in use, you'll be prompted to sign in to that account instead.
              </Text>
            </AnimatedView>
          )}
        </View>
      </ScrollView>

      {/* Skip/Close Button - rendered AFTER ScrollView to ensure it's on top */}
      <View style={styles.skipButton}>
        <AnimatedPressable
          onPress={handleSkipLogin}
          style={styles.skipButtonInner}
        >
          <Ionicons name="close" size={24} color={theme.colors.textMuted} />
        </AnimatedPressable>
      </View>
      
      {/* Credential collision modal */}
      {collisionError && !showSwitchConfirm && (
        <CredentialCollisionModal
          visible={!!collisionError && !showSwitchConfirm}
          onClose={() => setCollisionError(null)}
          providerType={collisionError.providerType}
          pendingCredential={collisionError.pendingCredential}
          email={collisionError.email}
          onSignInToOtherAccount={handleCollisionSignIn}
          onUseDifferentMethod={() => setCollisionError(null)}
        />
      )}

      {/* Account switch confirmation modal */}
      {collisionError && showSwitchConfirm && (
        <AccountSwitchConfirmModal
          visible={showSwitchConfirm}
          email={collisionError.email}
          providerType={collisionError.providerType}
          onConfirm={handleConfirmSwitch}
          onCancel={handleCancelSwitch}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const createStyles = (theme: Theme, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    skipButton: {
      position: "absolute",
      top: 60,
      right: 20,
      zIndex: 100,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.colors.surface,
      alignItems: "center",
      justifyContent: "center",
      elevation: 10,
      ...theme.shadows.sm,
    },
    skipButtonInner: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    scrollContent: {
      flexGrow: 1,
    },
    hero: {
      paddingTop: 80,
      paddingBottom: 60,
      alignItems: "center",
    },
    logoContainer: {
      marginBottom: theme.spacing.lg,
    },
    logoCircle: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: theme.colors.surface,
      alignItems: "center",
      justifyContent: "center",
      ...theme.shadows.md,
    },
    title: {
      fontFamily: theme.fonts.display.bold,
      fontSize: 36,
      color: theme.colors.text,
      letterSpacing: -0.5,
      marginBottom: theme.spacing.xs,
    },
    subtitle: {
      fontFamily: theme.fonts.body.italic,
      fontSize: 16,
      color: theme.colors.textLight,
    },
    formContainer: {
      flex: 1,
      padding: theme.spacing.xl,
      paddingTop: theme.spacing.lg,
    },
    formHeader: {
      marginBottom: theme.spacing.xl,
    },
    formTitle: {
      fontFamily: theme.fonts.display.semiBold,
      fontSize: 24,
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
    },
    formSubtitle: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 15,
      color: theme.colors.textLight,
    },
    inputContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.lg,
      marginBottom: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
      borderWidth: 2,
      borderColor: "transparent",
      ...theme.shadows.sm,
    },
    inputContainerFocused: {
      borderColor: theme.colors.primary,
      backgroundColor: isDark
        ? theme.colors.gray[100]
        : theme.colors.surfaceElevated,
    },
    inputIcon: {
      marginRight: theme.spacing.sm,
    },
    input: {
      flex: 1,
      fontFamily: theme.fonts.ui.regular,
      fontSize: 16,
      color: theme.colors.text,
      paddingVertical: theme.spacing.md,
    },
    authButton: {
      marginTop: theme.spacing.md,
      marginBottom: theme.spacing.lg,
    },
    authButtonInner: {
      backgroundColor: theme.colors.primary,
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.xl,
      borderRadius: theme.borderRadius.lg,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing.sm,
      ...theme.shadows.md,
    },
    authButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
      color: "white",
    },
    switchButton: {
      alignItems: "center",
      paddingVertical: theme.spacing.md,
    },
    switchText: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 14,
      color: theme.colors.textLight,
    },
    switchTextHighlight: {
      fontFamily: theme.fonts.ui.semiBold,
      color: theme.colors.primary,
    },
    dividerContainer: {
      flexDirection: "row",
      alignItems: "center",
      marginVertical: theme.spacing.sm,
    },
    dividerLine: {
      flex: 1,
      height: 1,
      backgroundColor: theme.colors.border,
    },
    dividerText: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 14,
      color: theme.colors.textMuted,
      paddingHorizontal: theme.spacing.md,
    },
    googleButton: {
      marginBottom: theme.spacing.md,
      alignSelf: "stretch",
    },
    googleButtonInner: {
      backgroundColor: theme.colors.surface,
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.xl,
      borderRadius: theme.borderRadius.full,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing.md,
      borderWidth: 1,
      borderColor: theme.colors.gray[200],
      ...theme.shadows.sm,
    },
    googleIconContainer: {
      width: 35,
      height: 35,
      borderRadius: 16,
      backgroundColor: "#fff",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
      ...theme.shadows.sm,
    },
    googleButtonText: {
      fontFamily: theme.fonts.ui.bold,
      fontSize: 17,
      color: theme.colors.text,
    },
    appleButton: {
      marginBottom: theme.spacing.sm,
      alignSelf: "stretch",
    },
    appleButtonInner: {
      backgroundColor: "#000",
      paddingVertical: theme.spacing.md + 2,
      paddingHorizontal: theme.spacing.xl,
      borderRadius: theme.borderRadius.full,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: theme.spacing.md,
      ...theme.shadows.sm,
    },
    appleButtonText: {
      fontFamily: theme.fonts.ui.bold,
      fontSize: 17,
      color: "#fff",
    },
    linkInfoBanner: {
      flexDirection: "row",
      alignItems: "flex-start",
      backgroundColor: `${theme.colors.primary}10`,
      borderRadius: theme.borderRadius.lg,
      padding: theme.spacing.md,
      marginBottom: theme.spacing.lg,
      gap: theme.spacing.sm,
    },
    linkInfoText: {
      flex: 1,
      fontFamily: theme.fonts.ui.regular,
      fontSize: 14,
      color: theme.colors.textLight,
      lineHeight: 20,
    },
    linkHelperText: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 13,
      color: theme.colors.textMuted,
      textAlign: 'center',
      lineHeight: 18,
      marginTop: theme.spacing.md,
    },
  });
