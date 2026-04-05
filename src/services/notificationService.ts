import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export class NotificationService {
  private notificationListener: any = null;
  private responseListener: any = null;

  constructor() {
    this.configureNotifications();
  }

  private async configureNotifications() {
    // Set notification handler
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    // Request permissions on iOS
    if (Platform.OS === 'ios') {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        console.log('Notification permissions not granted');
      }
    }
  }

  async requestPermissions(): Promise<boolean> {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    return finalStatus === 'granted';
  }

  async scheduleDailyReminder(hour: number, minute: number, title: string, body: string) {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      throw new Error('Notification permissions not granted');
    }

    // Cancel existing daily reminder
    await this.cancelDailyReminder();

    // Schedule new daily reminder
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        data: { type: 'daily_reminder' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
        hour,
        minute,
        repeats: true,
      },
    });

    // Save reminder ID
    await AsyncStorage.setItem('daily_reminder_id', identifier);
    await AsyncStorage.setItem('daily_reminder_time', `${hour}:${minute}`);

    return identifier;
  }

  async cancelDailyReminder() {
    const reminderId = await AsyncStorage.getItem('daily_reminder_id');
    if (reminderId) {
      await Notifications.cancelScheduledNotificationAsync(reminderId);
      await AsyncStorage.removeItem('daily_reminder_id');
      await AsyncStorage.removeItem('daily_reminder_time');
    }
  }

  async getDailyReminderTime(): Promise<string | null> {
    return await AsyncStorage.getItem('daily_reminder_time');
  }

  async scheduleSessionReminder(minutes: number) {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return;

    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Meditation Complete! 🧘',
        body: `Great job! You meditated for ${minutes} minutes today.`,
        sound: 'default',
        data: { type: 'session_complete' },
      },
      trigger: null, // Immediate notification
    });

    return identifier;
  }

  async scheduleStreakReminder(streak: number) {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return;

    // Only send streak reminders for milestones
    const milestones = [3, 7, 14, 21, 30, 50, 100];
    if (!milestones.includes(streak)) return;

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

  async scheduleMindfulMoment() {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) return;

    const mindfulMessages = [
      'Take a deep breath and center yourself.',
      'Notice three things you can see right now.',
      'How are you feeling in this moment?',
      'Pause and appreciate where you are.',
      'Take a moment to relax your shoulders.',
    ];

    const randomMessage = mindfulMessages[Math.floor(Math.random() * mindfulMessages.length)];

    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Mindful Moment 🌸',
        body: randomMessage,
        sound: 'default',
        data: { type: 'mindful_moment' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 3600 + Math.floor(Math.random() * 7200), // Random between 1-3 hours
      },
    });

    return identifier;
  }

  addNotificationListener(callback: (notification: Notifications.Notification) => void) {
    this.notificationListener = Notifications.addNotificationReceivedListener(callback);
  }

  addResponseListener(callback: (response: Notifications.NotificationResponse) => void) {
    this.responseListener = Notifications.addNotificationResponseReceivedListener(callback);
  }

  removeListeners() {
    if (this.notificationListener) {
      this.notificationListener.remove();
      this.notificationListener = null;
    }
    if (this.responseListener) {
      this.responseListener.remove();
      this.responseListener = null;
    }
  }
}

export const notificationService = new NotificationService();
