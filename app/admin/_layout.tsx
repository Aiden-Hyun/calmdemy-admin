import React from 'react';
import { Stack, Redirect, useRouter } from 'expo-router';
import { View, Text, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { useAdminAuth } from '@features/admin/hooks/useAdminAuth';

export default function AdminLayout() {
  const { theme } = useTheme();
  const router = useRouter();
  const { isAdmin, isLoading } = useAdminAuth();

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.textMuted }]}>
          Checking access...
        </Text>
      </View>
    );
  }

  if (!isAdmin) {
    return <Redirect href="/" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { fontFamily: 'DMSans-SemiBold' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'Content Factory',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={8} style={{ marginRight: 8 }}>
              <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="create"
        options={{
          title: 'Create Content',
          presentation: 'modal',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} hitSlop={8}>
              <Ionicons name="close" size={24} color={theme.colors.text} />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen
        name="job/[id]"
        options={{ headerTitle: () => null }}
      />
      <Stack.Screen
        name="job/[id]/review"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="job/[id]/review/[sessionCode]"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="content/index"
        options={{
          title: 'Content Manager',
        }}
      />
      <Stack.Screen
        name="content/reports"
        options={{
          title: 'Reports Inbox',
        }}
      />
      <Stack.Screen
        name="content/[collection]/[id]"
        options={{
          title: 'Content Detail',
        }}
      />
    </Stack>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: 'DMSans-Regular',
  },
});
