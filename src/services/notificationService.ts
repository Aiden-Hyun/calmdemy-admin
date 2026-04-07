/**
 * Notification Service - Push Notification and Local Notification Management
 *
 * ARCHITECTURAL ROLE:
 * Centralized service for scheduling and managing local notifications across iOS/Android.
 * Uses expo-notifications for cross-platform push/local notification delivery.
 * Implements Singleton pattern (instantiated once as notificationService export).
 *
 * DESIGN PATTERNS:
 * - Singleton: Single instance created and exported for app-wide use
 * - Service/Facade: Simplifies expo-notifications API; provides domain-specific methods
 *   (scheduleDailyReminder, scheduleSessionReminder, etc) instead of raw API calls
 * - Observer: Provides methods to register notification received/response listeners
 * - Persistent State: Uses AsyncStorage to remember reminder settings across app restarts
 *
 * KEY DEPENDENCIES:
 * - expo-notifications: Cross-platform notification scheduling and delivery
 * - AsyncStorage: Persistent storage of reminder IDs and preferences
 * - react-native Platform: Conditional iOS permission handling
 *
 * CONSUMERS:
 * - Settings/profile screens: Call scheduleDailyReminder(), cancelDailyReminder()
 * - Meditation completion screens: Call scheduleSessionReminder(), scheduleStreakReminder()
 * - App root: Calls addNotificationListener(), addResponseListener() for UI navigation
 *
 * NOTIFICATION TYPES:
 * - Daily Reminders: Recurring at user-set time (e.g., 6am meditation)
 * - Session Complete: One-time after meditation finishes
 * - Streak Milestones: Motivational at 3, 7, 14, 21, 30, 50, 100-day streaks
 * - Mindful Moments: Random ambient reminders throughout day
 *
 * PLATFORM NOTES:
 * - iOS: Requires explicit permission grant; done in constructor and requestPermissions()
 * - Android: Permissions typically pre-granted; no UI prompt in modern Android
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Singleton notification service instance.
 * Manages all local notification scheduling and delivery for the app.
 * Initialized once at app startup and reused throughout app lifecycle.
 */
export class NotificationService {
  /**
   * LISTENER STORAGE:
   * Subscribers to notification events. Stored as instance variables
   * so they can be removed later (prevent memory leaks).
   * Listeners are Subscription objects with .remove() method.
   */
  private notificationListener: any = null;
  private responseListener: any = null;

  /**
   * CONSTRUCTOR: Initialize notification handler and request permissions.
   * Called once when service is instantiated.
   */
  constructor() {
    this.configureNotifications();
  }

  /**
   * INITIALIZATION: Configure notification handler and request iOS permissions.
   * Must be called before scheduling any notifications.
   *
   * NOTIFICATION HANDLER:
   * Defines how notifications appear when app is in foreground.
   * By default, notifications don't show if app is open; this handler overrides that.
   *
   * iOS PERMISSIONS:
   * iOS requires explicit user permission to show notifications.
   * Android 13+ also requires permission, but handled at install time.
   * This request happens on first app launch (user prompted once).
   */
  private async configureNotifications() {
    /**
     * SET NOTIFICATION HANDLER:
     * Configures behavior when notification arrives while app is in foreground.
     * Default would be silent; we override to show banner, list item, and sound.
     */
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,  // Show notification banner at top of screen
        shouldShowList: true,    // Add to notification list (pull-down menu)
        shouldPlaySound: true,   // Play notification sound
        shouldSetBadge: false,   // Don't add badge count to app icon (avoid badge spam)
      }),
    });

    /**
     * iOS PERMISSION REQUEST:
     * iOS is unique in requiring explicit notification permission.
     * Android doesn't prompt (permissions pre-granted at install).
     * If user denies, notifications won't show; graceful degradation.
     */
    if (Platform.OS === 'ios') {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        console.log('Notification permissions not granted');
      }
    }
  }

  /**
   * Request notification permissions from user.
   * Used when user enables notifications in settings (after previously denying).
   *
   * LOGIC:
   * 1. Check current permission status
   * 2. If not granted, request permission from user
   * 3. Return final status
   *
   * @returns true if permissions granted, false if denied
   */
  async requestPermissions(): Promise<boolean> {
    // Check current status without prompting
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    /**
     * GUARD CLAUSE: Only request if not already granted.
     * Prevents duplicate permission prompts; respects prior user choice.
     */
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    return finalStatus === 'granted';
  }

  /**
   * Schedule a daily recurring notification at specified time.
   * Used for "morning meditation" reminders at user-chosen time.
   *
   * BEHAVIOR:
   * - Repeats daily forever until canceled
   * - Only one daily reminder allowed (cancels previous)
   * - Persists reminder ID for later cancellation
   *
   * ERROR HANDLING:
   * - Throws if notification permission not granted (requires caller to handle)
   * - Otherwise persists state even if notification service fails
   *
   * @param hour - Hour (0-23) for reminder time
   * @param minute - Minute (0-59) for reminder time
   * @param title - Notification title
   * @param body - Notification message
   * @returns Notification ID for tracking/cancellation
   * @throws Error if permissions not granted
   */
  async scheduleDailyReminder(hour: number, minute: number, title: string, body: string) {
    // Permission guard: ensure user has enabled notifications before scheduling
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      throw new Error('Notification permissions not granted');
    }

    /**
     * IDEMPOTENCY: Cancel any existing reminder before scheduling new one.
     * Ensures only one daily reminder active at a time.
     * Prevents duplicate notifications if user changes reminder time.
     */
    await this.cancelDailyReminder();

    /**
     * SCHEDULE RECURRING NOTIFICATION:
     * CALENDAR trigger: Repeats at specific time each day.
     * Alternative: TIME_INTERVAL (e.g., every 2 hours, not tied to clock).
     */
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        // data: Used for deep linking when user taps notification
        data: { type: 'daily_reminder' },
      },
      trigger: {
        /**
         * CALENDAR TRIGGER: Fires at specific hour:minute every day.
         * repeats: true means it continues indefinitely until canceled.
         */
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        hour,
        minute,
        repeats: true,
      },
    });

    /**
     * PERSIST REMINDER STATE:
     * Store notification ID and time in AsyncStorage.
     * Enables getDailyReminderTime() and cancelDailyReminder() on future app launches.
     * Without this, user's reminder settings would be lost after app restart.
     */
    await AsyncStorage.setItem('daily_reminder_id', identifier);
    await AsyncStorage.setItem('daily_reminder_time', `${hour}:${minute}`);

    return identifier;
  }

  /**
   * Cancel the currently scheduled daily reminder.
   * Called when user disables reminders or changes time.
   *
   * IDEMPOTENCY: Safe to call even if no reminder is scheduled.
   * Checks if reminderId exists before attempting cancellation.
   */
  async cancelDailyReminder() {
    /**
     * LOOKUP: Retrieve stored reminder ID from persistent storage.
     * If no ID found, no reminder was scheduled; return silently.
     */
    const reminderId = await AsyncStorage.getItem('daily_reminder_id');
    if (reminderId) {
      /**
       * CANCEL: Tell expo-notifications to stop sending this scheduled notification.
       * After this, the notification will never fire again.
       */
      await Notifications.cancelScheduledNotificationAsync(reminderId);

      /**
       * CLEANUP: Remove persisted reminder ID and time.
       * Ensures next app launch doesn't restore this reminder.
       */
      await AsyncStorage.removeItem('daily_reminder_id');
      await AsyncStorage.removeItem('daily_reminder_time');
    }
  }

  /**
   * Get the time of currently scheduled daily reminder.
   * Used in settings screen to show user their chosen reminder time.
   *
   * @returns Time string "HH:MM" (e.g., "06:30") or null if no reminder scheduled
   */
  async getDailyReminderTime(): Promise<string | null> {
    return await AsyncStorage.getItem('daily_reminder_time');
  }

  /**
   * Send immediate notification when user completes a meditation session.
   * Called from meditation completion screen to show success message.
   *
   * BEHAVIOR:
   * - Sends immediately (trigger: null)
   * - Shows user their session duration
   * - No persistence; one-time notification
   *
   * ERROR HANDLING: Silent fail if permissions denied (doesn't throw).
   *
   * @param minutes - Duration of completed session
   * @returns Notification ID or undefined if permission denied
   */
  async scheduleSessionReminder(minutes: number) {
    // Silent guard: skip if permission not granted (graceful degradation)
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return;

    /**
     * IMMEDIATE NOTIFICATION:
     * trigger: null means send right now (not scheduled for future).
     * data.type allows app to differentiate this from other notification types
     * when user taps notification (deep linking).
     */
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Meditation Complete! 🧘',
        body: `Great job! You meditated for ${minutes} minutes today.`,
        sound: 'default',
        // data: Can be used for navigation when user taps notification
        data: { type: 'session_complete' },
      },
      trigger: null, // Immediate notification
    });

    return identifier;
  }

  /**
   * Send motivational notification on meditation streak milestones.
   * Celebrates user achievement at specific day counts (3, 7, 14, 21, 30, 50, 100).
   * Encourages continued habit formation.
   *
   * MILESTONE STRATEGY:
   * Only send at specific days to avoid notification spam.
   * Gaps between milestones increase (3, 7, 14...) to maintain novelty.
   *
   * ERROR HANDLING: Silent fail if permission denied.
   *
   * @param streak - Current meditation streak (number of consecutive days)
   * @returns Notification ID or undefined if not a milestone or permission denied
   */
  async scheduleStreakReminder(streak: number) {
    // Guard: skip if permissions not granted
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return;

    /**
     * MILESTONE FILTERING:
     * Only send notifications at specific milestones to prevent notification fatigue.
     * Users see celebratory message at 3 days, 1 week, 2 weeks, etc.
     * If streak is not in this list, return silently (no notification).
     */
    const milestones = [3, 7, 14, 21, 30, 50, 100];
    if (!milestones.includes(streak)) return;

    /**
     * IMMEDIATE MILESTONE NOTIFICATION:
     * Sent right when user hits the milestone (not scheduled).
     * data.streak included for app tracking/analytics.
     */
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: `${streak} Day Streak! 🔥`,
        body: `Amazing! You've meditated for ${streak} days in a row. Keep it up!`,
        sound: 'default',
        data: { type: 'streak_milestone', streak },
      },
      trigger: null, // Immediate notification
    });

    return identifier;
  }

  /**
   * Schedule ambient "mindful moment" reminder at random time.
   * Provides gentle nudge during day to practice mindfulness.
   * Complements daily reminders with unexpected ambient moments.
   *
   * BEHAVIOR:
   * - Scheduled for 1-3 hours from now (random)
   * - Random message from list of mindfulness prompts
   * - Shows mindful reminder style notification
   *
   * USE CASE: Called after user enables mindful moments in settings.
   *
   * ERROR HANDLING: Silent fail if permission denied.
   *
   * @returns Notification ID or undefined if permission denied
   */
  async scheduleMindfulMoment() {
    // Guard: skip if permission not granted
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return;

    /**
     * CONTENT VARIETY:
     * Array of different mindful prompts.
     * Random selection prevents repetition/monotony.
     * Each message is short, actionable, and fits mindfulness theme.
     */
    const mindfulMessages = [
      'Take a deep breath and center yourself.',
      'Notice three things you can see right now.',
      'How are you feeling in this moment?',
      'Pause and appreciate where you are.',
      'Take a moment to relax your shoulders.',
    ];

    /**
     * RANDOM MESSAGE SELECTION:
     * Picks random index; varies notification message.
     * Adds perceived randomness to improve UX (feels less mechanical).
     */
    const randomMessage = mindfulMessages[Math.floor(Math.random() * mindfulMessages.length)];

    /**
     * TIME_INTERVAL TRIGGER:
     * Fires in X seconds from now (not at a fixed clock time).
     * Random delay between 1-3 hours (3600 + random 0-7200 seconds).
     * Provides ambient, unexpected reminders throughout day.
     *
     * Difference from CALENDAR trigger:
     * - CALENDAR: 6:00 AM every day (fixed time)
     * - TIME_INTERVAL: 90 minutes from now, one time (relative time)
     */
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Mindful Moment 🌸',
        body: randomMessage,
        sound: 'default',
        data: { type: 'mindful_moment' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        /**
         * RANDOM DELAY CALCULATION:
         * 3600 seconds (1 hour) + random 0 to 7200 seconds (0 to 2 hours)
         * = 1 to 3 hours from now
         * Prevents predictability and notification spam at fixed intervals.
         */
        seconds: 3600 + Math.floor(Math.random() * 7200),
      },
    });

    return identifier;
  }

  /**
   * Register callback for when notification is received (while app is open).
   * Used by app root to handle incoming notifications during foreground.
   *
   * LISTENER LIFECYCLE:
   * - Stored as instance variable for later cleanup
   * - Call removeListeners() when app unmounts to avoid memory leak
   * - Only one notification listener allowed; calling twice overwrites first
   *
   * USE CASE: App root calls this in useEffect() to enable deep linking/navigation
   * when notification arrives (e.g., user gets notification while using app).
   *
   * @param callback - Invoked when notification received (notification object provided)
   */
  addNotificationListener(callback: (notification: Notifications.Notification) => void) {
    /**
     * STORE LISTENER: Keep reference so we can remove later (via removeListeners).
     * Prevents memory leak if component unmounts without cleanup.
     * expo-notifications returns a Subscription object with .remove() method.
     */
    this.notificationListener = Notifications.addNotificationReceivedListener(callback);
  }

  /**
   * Register callback for when user TAPS a notification.
   * Different from addNotificationListener (which fires when notification arrives).
   * This fires when user interacts with notification (taps it).
   *
   * USE CASE: App uses this to navigate to relevant screen when user taps notification.
   * Example: User taps "meditation complete" notification -> navigate to home screen.
   *
   * LISTENER LIFECYCLE:
   * - Stored as instance variable for cleanup
   * - Must call removeListeners() on unmount
   *
   * @param callback - Invoked when user taps notification (response object with data provided)
   */
  addResponseListener(callback: (response: Notifications.NotificationResponse) => void) {
    /**
     * STORE LISTENER: Keep reference for cleanup.
     * Response object includes notification data for deep linking logic.
     */
    this.responseListener = Notifications.addNotificationResponseReceivedListener(callback);
  }

  /**
   * Remove all registered notification listeners.
   * CRITICAL: Must be called in useEffect cleanup to prevent memory leaks.
   *
   * MEMORY LEAK PREVENTION:
   * Each listener keeps app in memory; without cleanup, listeners pile up
   * if component mounts/unmounts repeatedly (e.g., navigation).
   * Calling .remove() releases the listener and allows garbage collection.
   *
   * TYPICAL PATTERN:
   * useEffect(() => {
   *   notificationService.addNotificationListener(handler);
   *   return () => notificationService.removeListeners();
   * }, []);
   *
   * ERROR HANDLING: Safe to call even if listeners were never added (checks null).
   */
  removeListeners() {
    /**
     * REMOVE NOTIFICATION LISTENER:
     * Call .remove() on subscription to unregister the listener.
     */
    if (this.notificationListener) {
      this.notificationListener.remove();
      this.notificationListener = null;
    }

    /**
     * REMOVE RESPONSE LISTENER:
     * Same cleanup pattern for response listener.
     */
    if (this.responseListener) {
      this.responseListener.remove();
      this.responseListener = null;
    }
  }
}

/**
 * SINGLETON INSTANCE:
 * Single NotificationService instance created here and exported for app-wide use.
 * Constructor runs once at app startup, initializing notification handler and permissions.
 * All code imports and uses this singleton instance: notificationService.scheduleDailyReminder(...).
 *
 * RATIONALE FOR SINGLETON:
 * - Notification state is app-global (only one daily reminder across whole app)
 * - Listeners are app-global (only one foreground listener at a time)
 * - Initialization should happen once, not per component
 */
export const notificationService = new NotificationService();
