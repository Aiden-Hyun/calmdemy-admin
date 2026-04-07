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
   * LISTENER STORAGE: Subscription references for cleanup.
   * Stored as instance variables so they can be removed later (prevent memory leaks).
   * Each listener is a Subscription object from expo-notifications with .remove() method.
   *
   * LIFECYCLE:
   * - addNotificationListener() -> stored here
   * - removeListeners() -> calls .remove() and nullifies reference
   * - Must be cleaned up in App useEffect cleanup to avoid memory accumulation
   *
   * WHY INSTANCE VARIABLES:
   * - Single service instance (singleton) has one listener pair
   * - Persists across component mounts/unmounts
   * - Different from per-component listeners (which would accumulate without cleanup)
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
   * Called once in constructor during app startup.
   * Must complete before scheduling any notifications (but errors are non-blocking).
   *
   * RESPONSIBILITY 1: NOTIFICATION HANDLER
   * Defines how notifications appear when app is in foreground.
   * By default, notifications don't show if app is open; this handler overrides that.
   * Critical for "received notification while using app" UX.
   *
   * RESPONSIBILITY 2: iOS PERMISSIONS
   * iOS requires explicit user permission to show notifications.
   * Android 13+ also requires permission, but handled at install time.
   * This request happens on first app launch (user prompted once).
   * If denied, notifications silently fail (graceful degradation).
   */
  private async configureNotifications() {
    /**
     * SET NOTIFICATION HANDLER:
     * Defines behavior when notification arrives while app is in foreground (user has app open).
     *
     * DEFAULT BEHAVIOR (without this):
     * - Notification received but not shown to user
     * - Would only be visible if user backgrounded app
     *
     * OUR OVERRIDE:
     * - shouldShowBanner: true -> Shows notification banner at top of screen
     * - shouldShowList: true -> Adds to notification list (visible in pull-down)
     * - shouldPlaySound: true -> Plays notification sound
     * - shouldSetBadge: false -> Don't add badge count to app icon (would accumulate)
     *
     * RETURN TYPE: Must return Promise of NotificationHandlerResponse (async function).
     */
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,  // Show notification banner at top of screen
        shouldShowList: true,    // Add to notification list (pull-down menu)
        shouldPlaySound: true,   // Play notification sound (respect silent mode)
        shouldSetBadge: false,   // Don't add badge count to app icon (avoid spam)
      }),
    });

    /**
     * iOS PERMISSION REQUEST:
     * Platform-specific because iOS and Android differ significantly.
     *
     * iOS BEHAVIOR:
     * - Requires explicit permission grant on first request
     * - Shows system dialog to user
     * - Can be denied; once denied, requires user to manually enable in Settings
     * - This is called on first app launch
     *
     * ANDROID BEHAVIOR:
     * - Android 12 and below: No permission request (pre-granted at install)
     * - Android 13+: Requires POST_NOTIFICATIONS permission, but requested at install time
     * - No per-app permission dialog (system handles at install)
     * - This call is safe but often unnecessary on Android
     */
    if (Platform.OS === 'ios') {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        // Non-critical: notifications will fail silently if user denied
        // App continues to function; just without notifications
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
   * Used for "morning meditation" reminders at user-chosen time (e.g., 6:00 AM).
   *
   * BEHAVIOR:
   * - Repeats daily forever until canceled via cancelDailyReminder()
   * - Only one daily reminder allowed (auto-cancels previous if exists)
   * - Persists reminder ID and time in AsyncStorage for recovery after app restart
   *
   * TIMING: Scheduled for exact clock time via CALENDAR trigger.
   * Example: hour=6, minute=30 -> fires at 6:30 AM every day (device timezone).
   *
   * ERROR HANDLING STRATEGY:
   * - Throws if notification permission not granted (caller must handle)
   * - Caller can catch and show user "enable notifications in Settings" message
   * - If scheduling fails after permission check, exception propagates (non-recoverable)
   *
   * PERMISSION FLOW:
   * 1. Call requestPermissions() (checks current status, prompts if needed)
   * 2. If denied, throw error -> caller decides how to handle
   * 3. If granted, proceed with scheduling
   *
   * @param hour - Hour in 24-hour format (0-23); 6 = 6 AM, 18 = 6 PM
   * @param minute - Minute (0-59); 30 = half-past the hour
   * @param title - Notification title (e.g., "Time to Meditate")
   * @param body - Notification message (e.g., "Start your day with calm")
   * @returns Notification ID for tracking/cancellation (stored internally)
   * @throws Error with message "Notification permissions not granted" if permissions denied
   */
  async scheduleDailyReminder(hour: number, minute: number, title: string, body: string) {
    // Permission guard: ensure user has enabled notifications before scheduling
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      throw new Error('Notification permissions not granted');
    }

    /**
     * IDEMPOTENCY PATTERN: Cancel any existing reminder before scheduling new one.
     *
     * SCENARIO: User enables daily reminders at 6:00 AM, later changes to 7:00 AM.
     * Without cancel first: Both 6:00 AM and 7:00 AM reminders would fire (duplicate).
     * With cancel first: Old 6:00 AM canceled, only 7:00 AM fires.
     *
     * SIDE EFFECT: Calling when no reminder exists is safe (idempotent).
     */
    await this.cancelDailyReminder();

    /**
     * SCHEDULE RECURRING NOTIFICATION:
     *
     * TRIGGER TYPE: CALENDAR (clock time-based) vs TIME_INTERVAL (elapsed time-based).
     * - CALENDAR: Fires at 6:00 AM every day (clock time)
     *   Used for: Daily reminders, scheduled events, fixed-time tasks
     * - TIME_INTERVAL: Fires in 1 hour from now, once (no repeat)
     *   Used for: Delays, ambient reminders, relative timing
     *
     * CHOICE: CALENDAR for daily reminders (time-independent of app restart).
     */
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        // data: Custom payload passed to app when user taps notification
        // Used for deep linking (e.g., "navigate to home screen" when tapped)
        data: { type: 'daily_reminder' },
      },
      trigger: {
        /**
         * CALENDAR TRIGGER: Fires at specific hour:minute every day.
         *
         * PARAMETERS:
         * - type: CALENDAR tells expo-notifications to use clock time
         * - hour: 0-23 (6 = 6 AM)
         * - minute: 0-59
         * - repeats: true means daily forever until canceled
         * Alternative: weekday (0=Sunday) to limit to certain days
         */
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        hour,
        minute,
        repeats: true, // Continue daily forever
      },
    });

    /**
     * PERSIST REMINDER STATE: Store in AsyncStorage for recovery after app restart.
     *
     * WHY PERSIST:
     * - expo-notifications forgets scheduled notifications on app uninstall/reinstall
     * - User restarts phone -> app needs to know about reminder and re-schedule it
     * - We use AsyncStorage as "source of truth" for user's reminder preference
     *
     * STORAGE:
     * - daily_reminder_id: Identifier returned by expo-notifications (for cancellation)
     * - daily_reminder_time: User-readable time (used by getDailyReminderTime() for UI)
     *
     * RECOVERY PATTERN (not implemented here, but in app startup):
     * 1. App launches
     * 2. Check AsyncStorage for stored reminder time
     * 3. If exists, call scheduleDailyReminder() to reschedule
     * 4. Ensures reminders survive app restart
     */
    await AsyncStorage.setItem('daily_reminder_id', identifier);
    await AsyncStorage.setItem('daily_reminder_time', `${hour}:${minute}`);

    return identifier;
  }

  /**
   * Cancel the currently scheduled daily reminder.
   * Called when user disables reminders in settings or changes reminder time.
   *
   * IDEMPOTENCY: Safe to call even if no reminder is scheduled.
   * Checks if reminderId exists before attempting cancellation (no error if missing).
   *
   * STATE CLEANUP:
   * 1. Cancels the notification in expo-notifications (stops firing)
   * 2. Removes persistent storage (prevents re-scheduling on app restart)
   * 3. After this, reminder is completely cleared (both in-app and persisted)
   */
  async cancelDailyReminder() {
    /**
     * LOOKUP: Retrieve stored reminder ID from AsyncStorage.
     *
     * FLOW:
     * - If no ID found: reminder was never scheduled, return silently (idempotent)
     * - If ID found: proceed with cancellation
     *
     * WHY LOOKUP FIRST:
     * - Avoid trying to cancel non-existent notification (would error)
     * - More robust if expo-notifications API changes
     */
    const reminderId = await AsyncStorage.getItem('daily_reminder_id');
    if (reminderId) {
      /**
       * CANCEL IN EXPO:
       * Tell expo-notifications to stop sending this scheduled notification.
       * After this call, the notification will never fire again.
       * Safe to call even if notification already fired or was previously canceled.
       */
      await Notifications.cancelScheduledNotificationAsync(reminderId);

      /**
       * CLEANUP PERSISTENT STORAGE:
       * Remove persisted reminder ID and time from AsyncStorage.
       *
       * CRITICAL: This prevents the reminder from being re-scheduled on app restart.
       * Without this, on app relaunch, app would read these values and reschedule.
       *
       * TWO KEYS TO REMOVE:
       * - daily_reminder_id: Identifier for expo-notifications
       * - daily_reminder_time: User-readable time (for settings display)
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
   * Provides positive feedback and motivates continued practice.
   *
   * BEHAVIOR:
   * - Sends immediately (trigger: null) no delay
   * - Shows user their session duration (dynamic content)
   * - No persistence; one-time notification (not repeated)
   *
   * ERROR HANDLING: Silent fail if permissions denied (graceful degradation).
   * Even if this notification fails, session is still saved; user sees it in history.
   *
   * USE CASE: User finishes 10-minute meditation -> notification shows "Great job! 10 min".
   *
   * @param minutes - Duration of completed session (passed to UI message)
   * @returns Notification ID or undefined if permission denied (not used by caller)
   */
  async scheduleSessionReminder(minutes: number) {
    // Silent guard: skip if permission not granted (graceful degradation)
    // Unlike scheduleDailyReminder, we don't throw; this is "nice-to-have" feedback
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return;

    /**
     * IMMEDIATE NOTIFICATION: Fire right now, not scheduled for future.
     *
     * TRIGGER: null has special meaning in expo-notifications.
     * - null = Send immediately (on next event loop tick)
     * - Alternative would be TIME_INTERVAL with 0 seconds (less common)
     *
     * CONTENT:
     * - title: Fixed ("Meditation Complete!")
     * - body: Dynamic (includes user's session duration)
     * - data.type: Identifies this as session completion (used if tapped)
     *
     * EMOJI: 🧘 used intentionally for visual appeal (builds positive association).
     */
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Meditation Complete! 🧘',
        body: `Great job! You meditated for ${minutes} minutes today.`,
        sound: 'default',
        // data: Custom payload for app handling when user taps notification
        // Allows app to navigate to appropriate screen or take action
        data: { type: 'session_complete' },
      },
      trigger: null, // Immediate notification (no delay)
    });

    return identifier;
  }

  /**
   * Send motivational notification on meditation streak milestones.
   * Celebrates user achievement at specific day counts (3, 7, 14, 21, 30, 50, 100).
   * Encourages continued habit formation through positive reinforcement.
   *
   * MILESTONE STRATEGY:
   * Only send at specific days to avoid notification spam/fatigue.
   * Gaps between milestones increase (3, 7, 14, 21, 30...) to maintain novelty.
   * Example: If user has 4-day streak, no notification (milestone only at 3, 7, 14, etc).
   *
   * ERROR HANDLING: Silent fail if permission denied (non-critical feedback).
   *
   * HABIT FORMATION: Streak notifications leverage habit loops:
   * - Day 3: "You can do this" (early momentum)
   * - Day 7: "One week!" (psychological milestone)
   * - Day 30: "One month!" (major achievement)
   *
   * @param streak - Current meditation streak (number of consecutive days, e.g., 7)
   * @returns Notification ID or undefined if not a milestone or permission denied
   */
  async scheduleStreakReminder(streak: number) {
    // Guard: skip if permissions not granted (graceful degradation)
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return;

    /**
     * MILESTONE FILTERING: Only send at specific streak counts.
     *
     * CHOSEN MILESTONES:
     * - 3: Early encouragement (habit formation accelerates around day 3)
     * - 7: "One week" psychological milestone
     * - 14: "Two weeks" (doubled)
     * - 21: "Three weeks" (forming habit, 21-day rule)
     * - 30: "One month" (major milestone)
     * - 50: "50 days" (significant achievement, rarer)
     * - 100: "One hundred days" (very rare, ultimate achievement)
     *
     * RATIONALE: Spacing increases (3, 7, 14, 21...) so notifications don't feel mechanical.
     * If streak is not in list, return silently (no notification sent).
     */
    const milestones = [3, 7, 14, 21, 30, 50, 100];
    if (!milestones.includes(streak)) return;

    /**
     * IMMEDIATE MILESTONE NOTIFICATION: Fire when user hits the streak.
     *
     * TIMING:
     * - Called from streak tracking logic (when user logs meditation)
     * - Sent immediately (trigger: null) for instant gratification
     * - User sees celebration right after completing session
     *
     * CONTENT:
     * - title: Includes emoji (🔥) for emotional impact
     * - body: Personalized with streak count
     * - data.streak: Included for app analytics/tracking
     */
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: `${streak} Day Streak! 🔥`,
        body: `Amazing! You've meditated for ${streak} days in a row. Keep it up!`,
        sound: 'default',
        // Include streak in data for app to log/track in analytics
        data: { type: 'streak_milestone', streak },
      },
      trigger: null, // Immediate notification
    });

    return identifier;
  }

  /**
   * Schedule ambient "mindful moment" reminder at random time.
   * Provides gentle nudge during day to practice mindfulness.
   * Complements daily reminders (structured) with ambient moments (spontaneous).
   *
   * BEHAVIOR:
   * - Scheduled for 1-3 hours from now (random delay each time)
   * - Random message from list of mindfulness prompts (prevents monotony)
   * - One-time notification (not recurring)
   *
   * USE CASE: Called after user enables "mindful moments" in settings.
   * Creates element of surprise throughout day ("when will next moment appear?").
   *
   * ERROR HANDLING: Silent fail if permission denied (non-critical feature).
   *
   * @returns Notification ID or undefined if permission denied
   */
  async scheduleMindfulMoment() {
    // Guard: skip if permission not granted (graceful degradation)
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return;

    /**
     * CONTENT VARIETY: Array of different mindfulness prompts.
     *
     * DESIGN:
     * - All short (1 sentence) for quick consumption
     * - All actionable (users can immediately do them)
     * - Variety maintains engagement (prevents "this notification again" fatigue)
     * - Emotionally positive tone (aligned with wellness app)
     *
     * USAGE: Random selection on each call.
     * If scheduleMindfulMoment() called again, user might get different message.
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
     * Math.random() * length -> random index
     * Math.floor() -> integer index (0 to length-1)
     *
     * UX BENEFIT: Perceived randomness improves engagement.
     * Each notification feels fresh, not scripted/mechanical.
     */
    const randomMessage = mindfulMessages[Math.floor(Math.random() * mindfulMessages.length)];

    /**
     * TIME_INTERVAL TRIGGER: Fires in X seconds from now (relative time).
     * Different from CALENDAR which fires at fixed clock times.
     *
     * TRIGGER TYPES:
     * - CALENDAR: 6:00 AM daily (fixed time, repeating)
     *   Use for: Reminders tied to time of day (wake-up, bedtime)
     * - TIME_INTERVAL: 90 minutes from now (relative time, one-time)
     *   Use for: Delays, ambient reminders, random notifications
     *
     * WHY TIME_INTERVAL FOR THIS:
     * - Random timing throughout day (not tied to specific hour)
     * - One-time notification (ambient moment, not daily recurring)
     * - Can schedule multiple mindful moments with different delays
     */
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Mindful Moment 🌸',
        body: randomMessage,
        sound: 'default',
        // Quiet notification sound (gentle, not jarring)
        data: { type: 'mindful_moment' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        /**
         * RANDOM DELAY CALCULATION:
         * Goal: 1 to 3 hours from now (random)
         *
         * Formula:
         * - Base: 3600 seconds (1 hour)
         * - Random: 0 to 7200 seconds (0 to 2 hours)
         * - Total: 3600 to 10800 seconds (1 to 3 hours)
         *
         * Randomization prevents predictability:
         * - Without randomness: notification every 2 hours (feels mechanical)
         * - With randomness: 1h 15min, then 2h 45min, then 1h 30min (feels organic)
         *
         * PRACTICAL EFFECT: Users get gentle nudges throughout day, unpredictably.
         */
        seconds: 3600 + Math.floor(Math.random() * 7200),
      },
    });

    return identifier;
  }

  /**
   * Register callback for when notification is received (while app is open).
   * Used by app root to handle incoming notifications during foreground.
   * Enables real-time response to notifications without user dismissing them.
   *
   * NOTIFICATION LIFECYCLE:
   * 1. Notification scheduled (via scheduleDailyReminder, etc)
   * 2. Notification fires (app in foreground)
   * 3. configureNotifications() handler runs (shows banner)
   * 4. THIS listener's callback runs (app can respond internally)
   * 5. User may tap notification -> responseListener callback runs
   *
   * LISTENER LIFECYCLE:
   * - Stored as instance variable (this.notificationListener) for later cleanup
   * - Call removeListeners() when app unmounts to avoid memory leak
   * - Only one notification listener at a time (calling twice overwrites first)
   *
   * USE CASE: App root calls this in useEffect() for:
   * - Deep linking (navigate to relevant screen when notification arrives)
   * - Logging/analytics (track which notifications users see)
   * - Triggering side effects (refresh data when notification arrives)
   *
   * EXAMPLE:
   * ```
   * useEffect(() => {
   *   notificationService.addNotificationListener((notification) => {
   *     if (notification.request.content.data.type === 'daily_reminder') {
   *       // Navigate to meditation screen
   *     }
   *   });
   *   return () => notificationService.removeListeners();
   * }, []);
   * ```
   *
   * @param callback - Invoked when notification received (notification object provided)
   */
  addNotificationListener(callback: (notification: Notifications.Notification) => void) {
    /**
     * STORE LISTENER: Keep reference so removeListeners() can call .remove() later.
     *
     * WHY REQUIRED:
     * - expo-notifications returns a Subscription object with .remove() method
     * - Without storing it, we can't clean up later (memory leak)
     * - If component unmounts, listeners pile up if not removed
     *
     * CRITICAL: Must call removeListeners() in cleanup to prevent accumulation.
     */
    this.notificationListener = Notifications.addNotificationReceivedListener(callback);
  }

  /**
   * Register callback for when user TAPS a notification.
   * Different from addNotificationListener (which fires when notification arrives).
   * This fires only when user interacts with notification (taps/responds to it).
   *
   * NOTIFICATION INTERACTION FLOW:
   * 1. Notification sent to notification tray
   * 2. User sees notification in tray (doesn't tap = only addNotificationListener fires)
   * 3. User taps notification (THIS callback fires)
   * 4. Notification response data available (use for deep linking/navigation)
   *
   * USE CASE: App uses this to navigate to relevant screen when user taps notification.
   *
   * EXAMPLES:
   * - User taps "Meditation Complete" notification -> navigate to achievements screen
   * - User taps "Daily Reminder" notification -> navigate to meditation list
   * - User taps "Streak Milestone" notification -> show streak details
   *
   * LISTENER LIFECYCLE:
   * - Stored as instance variable (this.responseListener) for later cleanup
   * - Must call removeListeners() on unmount to prevent memory leaks
   * - Critical in navigation-heavy apps (listener may accumulate on route changes)
   *
   * @param callback - Invoked when user taps notification
   *   Response object includes:
   *   - notification: The notification that was tapped
   *   - notification.request.content.data: Custom data (use for navigation decisions)
   */
  addResponseListener(callback: (response: Notifications.NotificationResponse) => void) {
    /**
     * STORE LISTENER: Keep reference for cleanup (via removeListeners).
     *
     * RESPONSE OBJECT: Contains everything needed for deep linking:
     * - response.notification.request.content.data.type
     * - response.notification.request.content.data.streak (if present)
     *
     * Example implementation:
     * ```
     * notificationService.addResponseListener((response) => {
     *   const type = response.notification.request.content.data.type;
     *   if (type === 'streak_milestone') {
     *     navigation.navigate('Achievements');
     *   }
     * });
     * ```
     */
    this.responseListener = Notifications.addNotificationResponseReceivedListener(callback);
  }

  /**
   * Remove all registered notification listeners.
   * CRITICAL: Must be called in useEffect cleanup to prevent memory leaks.
   *
   * MEMORY LEAK PREVENTION:
   * Each listener keeps references and callbacks in memory.
   * Without cleanup, listeners pile up if component mounts/unmounts repeatedly.
   * Example: User navigates to Settings screen -> back to Home 10 times.
   * Without cleanup: 10 listeners accumulated (memory waste, potential crashes).
   * With cleanup: 1 listener at a time (listener removed on unmount, new one on mount).
   *
   * SOLUTION: Calling .remove() on subscription releases listener and allows GC.
   *
   * TYPICAL REACT PATTERN:
   * ```javascript
   * useEffect(() => {
   *   notificationService.addNotificationListener(handler);
   *   return () => notificationService.removeListeners(); // Cleanup on unmount
   * }, []);
   * ```
   *
   * ERROR HANDLING: Safe to call even if listeners were never added (checks null).
   * Idempotent: Calling multiple times is safe (first call removes, rest no-op).
   */
  removeListeners() {
    /**
     * REMOVE NOTIFICATION LISTENER: Unregister "notification received" listener.
     *
     * STEP 1: Check if listener exists (could be null if never added)
     * STEP 2: Call .remove() to unregister with expo-notifications
     * STEP 3: Nullify reference to help garbage collector (clear strong reference)
     *
     * CRITICAL: Calling .remove() tells expo to stop invoking this callback.
     * Without this, callback remains registered and fires on notifications.
     */
    if (this.notificationListener) {
      this.notificationListener.remove();
      this.notificationListener = null;
    }

    /**
     * REMOVE RESPONSE LISTENER: Unregister "notification tapped" listener.
     *
     * Same cleanup pattern as notification listener.
     * Handles the "user tapped notification" event.
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
 * Constructor runs once at app startup:
 * 1. Calls configureNotifications() (sets handler, requests iOS permission)
 * 2. Service ready to schedule notifications immediately
 *
 * IMPORT USAGE:
 * ```javascript
 * import { notificationService } from './services/notificationService';
 * notificationService.scheduleDailyReminder(6, 30, 'Meditate', 'Time to meditate');
 * ```
 *
 * SINGLETON RATIONALE:
 * Why not create new instance per feature?
 *
 * NOTIFICATION STATE IS APP-GLOBAL:
 * - User can have only one daily reminder active (shared across entire app)
 * - Only one listener for "notification received" can be active at a time
 * - Notification permissions are device-level (not per-component)
 *
 * INITIALIZATION IS ONE-TIME:
 * - configureNotifications() should run once (sets global handler)
 * - Running multiple times wastes resources and may cause issues
 *
 * EXAMPLE MISUSE (if not singleton):
 * ```javascript
 * // BAD: Each screen creates its own service
 * const HomeService = new NotificationService(); // Initializes again (wasteful)
 * const SettingsService = new NotificationService(); // Initializes again (wasteful)
 * // Now both initialize handler, request permissions separately (conflicting)
 * // HomeService.scheduleDailyReminder() and SettingsService.scheduleDailyReminder()
 * // might create competing reminders (only one wins, unpredictable)
 * ```
 *
 * CORRECT USAGE (singleton):
 * ```javascript
 * // All screens import same instance
 * import { notificationService } from './services/notificationService';
 * // HomeService and SettingsService use SAME notificationService
 * // Only one daily reminder possible (as intended)
 * // Single handler, single listener (coordinated, predictable)
 * ```
 */
export const notificationService = new NotificationService();
