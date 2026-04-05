import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Alert,
  Linking,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@core/providers/contexts/ThemeContext";
import { useAuth } from "@core/providers/contexts/AuthContext";
import { useSubscription } from "@core/providers/contexts/SubscriptionContext";
import { Theme } from "@/theme";

interface RecoveryWizardProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type RecoveryStep = "methods" | "email_login" | "tips" | "success";

export function RecoveryWizard({
  visible,
  onClose,
  onSuccess,
}: RecoveryWizardProps) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(theme, isDark), [theme, isDark]);
  const {
    signInWithGoogle,
    signInWithApple,
    signIn,
    sendPasswordReset,
    isAppleSignInAvailable,
  } = useAuth();
  const { isPremium, checkSubscriptionStatus } = useSubscription();

  const [step, setStep] = useState<RecoveryStep>("methods");
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      await signInWithGoogle();
      // Check if premium is now active
      await checkSubscriptionStatus();
      // Small delay to let state update
      setTimeout(() => {
        if (isPremium) {
          setStep("success");
          onSuccess?.();
        } else {
          // Still not premium, show message
          Alert.alert(
            "Not the Right Account",
            "This account doesn't have an active subscription. Try another sign-in method."
          );
        }
      }, 500);
    } catch (error: any) {
      // Use generic message for anti-enumeration
      Alert.alert("Unable to Sign In", "Please try again or use another method.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setIsLoading(true);
    try {
      await signInWithApple();
      await checkSubscriptionStatus();
      setTimeout(() => {
        if (isPremium) {
          setStep("success");
          onSuccess?.();
        } else {
          Alert.alert(
            "Not the Right Account",
            "This account doesn't have an active subscription. Try another sign-in method."
          );
        }
      }, 500);
    } catch (error: any) {
      Alert.alert("Unable to Sign In", "Please try again or use another method.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSignIn = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert("Required", "Please enter your email and password.");
      return;
    }
    setIsLoading(true);
    try {
      await signIn(email.trim(), password);
      await checkSubscriptionStatus();
      setTimeout(() => {
        if (isPremium) {
          setStep("success");
          onSuccess?.();
        } else {
          Alert.alert(
            "Not the Right Account",
            "This account doesn't have an active subscription. Try another sign-in method."
          );
        }
      }, 500);
    } catch (error: any) {
      // Generic message for anti-enumeration
      Alert.alert("Unable to Sign In", "Please check your credentials and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert("Email Required", "Please enter your email address first.");
      return;
    }
    setIsLoading(true);
    try {
      await sendPasswordReset(email.trim());
      Alert.alert(
        "Check Your Email",
        "If an account exists with this email, you'll receive a password reset link."
      );
    } catch {
      // Generic message for anti-enumeration
      Alert.alert(
        "Check Your Email",
        "If an account exists with this email, you'll receive a password reset link."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleContactSupport = () => {
    const subject = encodeURIComponent("Subscription Recovery Help");
    const body = encodeURIComponent(
      "Hi,\n\nI need help recovering my subscription. I have an active subscription on my Apple ID but can't find my account.\n\nPlease help me recover access.\n\nThank you"
    );
    Linking.openURL(`mailto:support@calmnest.app?subject=${subject}&body=${body}`);
  };

  const handleClose = () => {
    setStep("methods");
    setEmail("");
    setPassword("");
    onClose();
  };

  const handleSuccess = () => {
    handleClose();
    onSuccess?.();
  };

  const renderMethods = () => (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Ionicons name="key-outline" size={32} color={theme.colors.primary} />
        </View>
        <Text style={styles.title}>Recover Your Subscription</Text>
        <Text style={styles.description}>
          We found an active subscription on this device's App Store account,
          but it's linked to a different in-app account.
        </Text>
      </View>

      {/* Sign-in methods */}
      <Text style={styles.sectionTitle}>Try signing in with:</Text>

      {/* Apple Sign In */}
      {isAppleSignInAvailable && (
        <Pressable
          style={({ pressed }) => [
            styles.methodButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={handleAppleSignIn}
          disabled={isLoading}
        >
          <View style={[styles.methodIcon, { backgroundColor: "#000" }]}>
            <Ionicons name="logo-apple" size={20} color="#fff" />
          </View>
          <Text style={styles.methodText}>Sign in with Apple</Text>
          {isLoading && <ActivityIndicator size="small" color={theme.colors.primary} />}
        </Pressable>
      )}

      {/* Google Sign In */}
      <Pressable
        style={({ pressed }) => [
          styles.methodButton,
          pressed && styles.buttonPressed,
        ]}
        onPress={handleGoogleSignIn}
        disabled={isLoading}
      >
        <View style={[styles.methodIcon, { backgroundColor: "#4285F4" }]}>
          <Ionicons name="logo-google" size={20} color="#fff" />
        </View>
        <Text style={styles.methodText}>Sign in with Google</Text>
        {isLoading && <ActivityIndicator size="small" color={theme.colors.primary} />}
      </Pressable>

      {/* Email Sign In */}
      <Pressable
        style={({ pressed }) => [
          styles.methodButton,
          pressed && styles.buttonPressed,
        ]}
        onPress={() => setStep("email_login")}
        disabled={isLoading}
      >
        <View style={[styles.methodIcon, { backgroundColor: theme.colors.primary }]}>
          <Ionicons name="mail-outline" size={20} color="#fff" />
        </View>
        <Text style={styles.methodText}>Sign in with Email</Text>
      </Pressable>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Help options */}
      <Pressable
        style={({ pressed }) => [
          styles.helpButton,
          pressed && styles.buttonPressed,
        ]}
        onPress={() => setStep("tips")}
      >
        <Ionicons
          name="help-circle-outline"
          size={20}
          color={theme.colors.textMuted}
        />
        <Text style={styles.helpButtonText}>Don't remember your login?</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [
          styles.helpButton,
          pressed && styles.buttonPressed,
        ]}
        onPress={handleContactSupport}
      >
        <Ionicons
          name="chatbubble-outline"
          size={20}
          color={theme.colors.textMuted}
        />
        <Text style={styles.helpButtonText}>Contact Support</Text>
      </Pressable>
    </ScrollView>
  );

  const renderEmailLogin = () => (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Back button */}
      <Pressable
        style={styles.backButton}
        onPress={() => setStep("methods")}
      >
        <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
      </Pressable>

      <Text style={styles.title}>Sign in with Email</Text>
      <Text style={styles.description}>
        Enter the email and password you used to create your account.
      </Text>

      {/* Email input */}
      <View style={styles.inputContainer}>
        <Ionicons
          name="mail-outline"
          size={20}
          color={theme.colors.textMuted}
          style={styles.inputIcon}
        />
        <TextInput
          style={styles.input}
          placeholder="Email address"
          placeholderTextColor={theme.colors.textMuted}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isLoading}
        />
      </View>

      {/* Password input */}
      <View style={styles.inputContainer}>
        <Ionicons
          name="lock-closed-outline"
          size={20}
          color={theme.colors.textMuted}
          style={styles.inputIcon}
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          placeholder="Password"
          placeholderTextColor={theme.colors.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          editable={!isLoading}
        />
        <Pressable onPress={() => setShowPassword(!showPassword)}>
          <Ionicons
            name={showPassword ? "eye-off-outline" : "eye-outline"}
            size={20}
            color={theme.colors.textMuted}
          />
        </Pressable>
      </View>

      {/* Forgot password */}
      <Pressable
        style={styles.forgotPassword}
        onPress={handleForgotPassword}
        disabled={isLoading}
      >
        <Text style={styles.forgotPasswordText}>Forgot password?</Text>
      </Pressable>

      {/* Sign in button */}
      <Pressable
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.buttonPressed,
          isLoading && styles.buttonDisabled,
        ]}
        onPress={handleEmailSignIn}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryButtonText}>Sign In</Text>
        )}
      </Pressable>
    </ScrollView>
  );

  const renderTips = () => (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Back button */}
      <Pressable
        style={styles.backButton}
        onPress={() => setStep("methods")}
      >
        <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
      </Pressable>

      <Text style={styles.title}>Recovery Tips</Text>

      {/* Apple tip */}
      {Platform.OS === "ios" && (
        <View style={styles.tipCard}>
          <View style={[styles.tipIcon, { backgroundColor: "#000" }]}>
            <Ionicons name="logo-apple" size={20} color="#fff" />
          </View>
          <View style={styles.tipContent}>
            <Text style={styles.tipTitle}>Used "Hide My Email"?</Text>
            <Text style={styles.tipText}>
              Go to Settings {">"} Apple ID {">"} Sign in with Apple {">"} Apps
              Using Apple ID to see if Calmdemy is listed.
            </Text>
          </View>
        </View>
      )}

      {/* Google tip */}
      <View style={styles.tipCard}>
        <View style={[styles.tipIcon, { backgroundColor: "#4285F4" }]}>
          <Ionicons name="logo-google" size={20} color="#fff" />
        </View>
        <View style={styles.tipContent}>
          <Text style={styles.tipTitle}>Multiple Google Accounts?</Text>
          <Text style={styles.tipText}>
            Try signing in with each Google account you may have used when
            setting up Calmdemy.
          </Text>
        </View>
      </View>

      {/* Email tip */}
      <View style={styles.tipCard}>
        <View style={[styles.tipIcon, { backgroundColor: theme.colors.primary }]}>
          <Ionicons name="mail-outline" size={20} color="#fff" />
        </View>
        <View style={styles.tipContent}>
          <Text style={styles.tipTitle}>Forgot Your Email?</Text>
          <Text style={styles.tipText}>
            Check your inbox for any emails from Calmdemy to find which email
            address you used.
          </Text>
        </View>
      </View>

      {/* Contact support */}
      <View style={styles.tipCard}>
        <View style={[styles.tipIcon, { backgroundColor: theme.colors.textMuted }]}>
          <Ionicons name="chatbubble-outline" size={20} color="#fff" />
        </View>
        <View style={styles.tipContent}>
          <Text style={styles.tipTitle}>Still Stuck?</Text>
          <Text style={styles.tipText}>
            Contact our support team and we'll help you recover your account.
          </Text>
          <Pressable
            style={styles.tipLink}
            onPress={handleContactSupport}
          >
            <Text style={styles.tipLinkText}>Contact Support</Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );

  const renderSuccess = () => (
    <View style={styles.successContainer}>
      <View style={styles.successIcon}>
        <Ionicons name="checkmark-circle" size={64} color={theme.colors.success} />
      </View>
      <Text style={styles.successTitle}>Welcome Back!</Text>
      <Text style={styles.successText}>
        This is the account linked to your subscription. You now have full
        access to all premium content.
      </Text>
      <Pressable
        style={({ pressed }) => [
          styles.primaryButton,
          pressed && styles.buttonPressed,
        ]}
        onPress={handleSuccess}
      >
        <Text style={styles.primaryButtonText}>Continue</Text>
      </Pressable>
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Close button */}
        <Pressable style={styles.closeButton} onPress={handleClose}>
          <Ionicons name="close" size={24} color={theme.colors.textLight} />
        </Pressable>

        {step === "methods" && renderMethods()}
        {step === "email_login" && renderEmailLogin()}
        {step === "tips" && renderTips()}
        {step === "success" && renderSuccess()}
      </View>
    </Modal>
  );
}

const createStyles = (theme: Theme, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    closeButton: {
      position: "absolute",
      top: 16,
      right: 16,
      zIndex: 10,
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.colors.surface,
      alignItems: "center",
      justifyContent: "center",
      ...theme.shadows.sm,
    },
    scrollContent: {
      paddingHorizontal: 24,
      paddingTop: 60,
      paddingBottom: 40,
    },
    header: {
      alignItems: "center",
      marginBottom: 32,
    },
    iconContainer: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: `${theme.colors.primary}15`,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 20,
    },
    title: {
      fontFamily: theme.fonts.display.bold,
      fontSize: 24,
      color: theme.colors.text,
      textAlign: "center",
      marginBottom: 12,
    },
    description: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 15,
      color: theme.colors.textLight,
      textAlign: "center",
      lineHeight: 22,
    },
    sectionTitle: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 15,
      color: theme.colors.textMuted,
      marginBottom: 16,
    },
    methodButton: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.lg,
      padding: 16,
      marginBottom: 12,
      ...theme.shadows.sm,
    },
    methodIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 16,
    },
    methodText: {
      flex: 1,
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 16,
      color: theme.colors.text,
    },
    divider: {
      height: 1,
      backgroundColor: theme.colors.gray[200],
      marginVertical: 24,
    },
    helpButton: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      gap: 12,
    },
    helpButtonText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 15,
      color: theme.colors.textMuted,
    },
    backButton: {
      marginBottom: 24,
    },
    inputContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.lg,
      paddingHorizontal: 16,
      paddingVertical: 14,
      marginBottom: 12,
      ...theme.shadows.sm,
    },
    inputIcon: {
      marginRight: 12,
    },
    input: {
      flex: 1,
      fontFamily: theme.fonts.ui.regular,
      fontSize: 16,
      color: theme.colors.text,
    },
    forgotPassword: {
      alignSelf: "flex-end",
      marginBottom: 24,
    },
    forgotPasswordText: {
      fontFamily: theme.fonts.ui.medium,
      fontSize: 14,
      color: theme.colors.primary,
    },
    primaryButton: {
      backgroundColor: theme.colors.primary,
      borderRadius: theme.borderRadius.lg,
      paddingVertical: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 17,
      color: "#fff",
    },
    buttonPressed: {
      opacity: 0.8,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    tipCard: {
      flexDirection: "row",
      backgroundColor: theme.colors.surface,
      borderRadius: theme.borderRadius.lg,
      padding: 16,
      marginBottom: 12,
      ...theme.shadows.sm,
    },
    tipIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 16,
    },
    tipContent: {
      flex: 1,
    },
    tipTitle: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 15,
      color: theme.colors.text,
      marginBottom: 4,
    },
    tipText: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 14,
      color: theme.colors.textLight,
      lineHeight: 20,
    },
    tipLink: {
      marginTop: 8,
    },
    tipLinkText: {
      fontFamily: theme.fonts.ui.semiBold,
      fontSize: 14,
      color: theme.colors.primary,
    },
    successContainer: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 24,
    },
    successIcon: {
      marginBottom: 24,
    },
    successTitle: {
      fontFamily: theme.fonts.display.bold,
      fontSize: 28,
      color: theme.colors.text,
      marginBottom: 12,
    },
    successText: {
      fontFamily: theme.fonts.ui.regular,
      fontSize: 16,
      color: theme.colors.textLight,
      textAlign: "center",
      lineHeight: 24,
      marginBottom: 32,
    },
  });
