/**
 * Left-hand sidebar navigation and worker status card.
 *
 * ARCHITECTURAL ROLE:
 * Primary navigation for admin views (dashboard, content manager, reports).
 * Shows real-time worker heartbeat status and action buttons.
 *
 * DESIGN PATTERN:
 * - Navigation bar: Vertical tab-like UI with active indicator
 * - Badge notifications: Shows open report count on reports tab
 * - Worker status display: Live color-coded heartbeat indicator
 * - Persistent header: Brand, create button, nav always visible
 *
 * SECTIONS:
 * 1. Brand header: Calmdemy logo + "Admin Console" title
 * 2. Create button: "New content" launches form (prominent action)
 * 3. Nav items: Dashboard, Content Manager, Reports (with open report badge)
 * 4. Spacer: Flexible space (flex: 1)
 * 5. Worker status card: Local worker heartbeat + sign out button
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@core/providers/contexts/ThemeContext';
import { Theme } from '@/theme';

export type SidebarNavKey = 'dashboard' | 'content' | 'reports';

export interface SidebarProps {
  activeKey: SidebarNavKey;
  openReportsCount: number;
  workerStateLabel: string;
  workerStateColor: string;
  onNavigate: (key: SidebarNavKey) => void;
  onCreate: () => void;
  onSignOut: () => void;
}

const NAV_ITEMS: {
  key: SidebarNavKey;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'speedometer-outline' },
  { key: 'content', label: 'Content Manager', icon: 'library-outline' },
  { key: 'reports', label: 'Reports', icon: 'flag-outline' },
];

export function Sidebar({
  activeKey,
  openReportsCount,
  workerStateLabel,
  workerStateColor,
  onNavigate,
  onCreate,
  onSignOut,
}: SidebarProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.sidebar}>
      <View style={styles.brand}>
        <View style={[styles.brandIcon, { backgroundColor: `${theme.colors.primary}22` }]}>
          <Ionicons name="flask-outline" size={20} color={theme.colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.brandTitle}>Calmdemy</Text>
          <Text style={styles.brandSubtitle}>Admin Console</Text>
        </View>
      </View>

      <Pressable
        onPress={onCreate}
        style={({ pressed }) => [
          styles.createButton,
          { backgroundColor: theme.colors.primary },
          pressed && { opacity: 0.9 },
        ]}
      >
        <Ionicons name="add" size={18} color="#fff" />
        <Text style={styles.createButtonText}>New content</Text>
      </Pressable>

      <View style={styles.navSection}>
        {NAV_ITEMS.map((item) => {
          const isActive = item.key === activeKey;
          const badge = item.key === 'reports' && openReportsCount > 0 ? openReportsCount : null;
          return (
            <Pressable
              key={item.key}
              onPress={() => onNavigate(item.key)}
              style={({ pressed }) => [
                styles.navItem,
                isActive && styles.navItemActive,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Ionicons
                name={item.icon}
                size={18}
                color={isActive ? theme.colors.primary : theme.colors.textMuted}
              />
              <Text style={[styles.navLabel, isActive && { color: theme.colors.text }]}>
                {item.label}
              </Text>
              {badge !== null ? (
                <View style={[styles.badge, { backgroundColor: theme.colors.error }]}>
                  <Text style={styles.badgeText}>{badge}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View style={{ flex: 1 }} />

      <View style={styles.workerCard}>
        <Text style={styles.workerLabel}>Local worker</Text>
        <View style={styles.workerRow}>
          <View style={[styles.workerDot, { backgroundColor: workerStateColor }]} />
          <Text style={styles.workerStateText}>{workerStateLabel}</Text>
        </View>
      </View>

      <Pressable
        onPress={onSignOut}
        style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name="log-out-outline" size={16} color={theme.colors.textMuted} />
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    sidebar: {
      width: 240,
      minWidth: 240,
      backgroundColor: theme.colors.surface,
      borderRightWidth: 1,
      borderRightColor: theme.colors.border,
      paddingHorizontal: 16,
      paddingVertical: 20,
      gap: 16,
    },
    brand: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    brandIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    brandTitle: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 16,
      color: theme.colors.text,
    },
    brandSubtitle: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.colors.textMuted,
    },
    createButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 10,
      borderRadius: 10,
    },
    createButtonText: {
      color: '#fff',
      fontFamily: 'DMSans-SemiBold',
      fontSize: 14,
    },
    navSection: {
      gap: 4,
    },
    navItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 8,
    },
    navItemActive: {
      backgroundColor: theme.colors.surfaceElevated,
    },
    navLabel: {
      flex: 1,
      fontFamily: 'DMSans-Medium',
      fontSize: 13,
      color: theme.colors.textMuted,
    },
    badge: {
      minWidth: 20,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: {
      color: '#fff',
      fontFamily: 'DMSans-SemiBold',
      fontSize: 11,
    },
    workerCard: {
      padding: 12,
      borderRadius: 10,
      backgroundColor: theme.colors.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.colors.border,
      gap: 6,
    },
    workerLabel: {
      fontFamily: 'DMSans-Regular',
      fontSize: 11,
      color: theme.colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    workerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    workerDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    workerStateText: {
      fontFamily: 'DMSans-SemiBold',
      fontSize: 13,
      color: theme.colors.text,
    },
    signOut: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    signOutText: {
      fontFamily: 'DMSans-Regular',
      fontSize: 12,
      color: theme.colors.textMuted,
    },
  });
