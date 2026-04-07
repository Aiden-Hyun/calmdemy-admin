import React from 'react';
import { Stack, useRouter } from 'expo-router';
import { View, Text, ActivityIndicator, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { useAuth } from '@core/providers/contexts/AuthContext';
import { useAdminAuth } from '@features/admin/hooks/useAdminAuth';

export default function AdminLayout() {
  const { theme } = useTheme();
  const router = useRouter();
  const { isAdmin, isLoading } = useAdminAuth();
  const { logout } = useAuth();

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
    return (
      <View style={[styles.center, { backgroundColor: theme.colors.background }]}>
        <Ionicons name="lock-closed-outline" size={48} color={theme.colors.textMuted} />
        <Text style={[styles.deniedTitle, { color: theme.colors.text }]}>
          Admin access only
        </Text>
        <Text style={[styles.loadingText, { color: theme.colors.textMuted }]}>
          This account is not authorized to use Calmdemy Admin.
        </Text>
        <Pressable
          onPress={async () => {
            try {
              await logout();
            } finally {
              router.replace('/login');
            }
          }}
          style={[styles.logoutButton, { backgroundColor: theme.colors.primary }]}
        >
          <Text style={styles.logoutText}>Sign out</Text>
        </Pressable>
      </View>
    );
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
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  deniedTitle: {
    fontSize: 20,
    fontFamily: 'DMSans-SemiBold',
  },
  logoutButton: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  logoutText: {
    color: '#fff',
    fontFamily: 'DMSans-SemiBold',
    fontSize: 14,
  },
});
