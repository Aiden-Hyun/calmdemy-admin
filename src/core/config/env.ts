const getEnv = (key: string, fallback?: string): string => {
  const value = process.env[key] ?? fallback;
  if (!value) {
    console.warn(`[config] Missing environment variable: ${key}`);
    return '';
  }
  return value;
};

export const env = {
  firebase: {
    apiKey: getEnv('EXPO_PUBLIC_FIREBASE_API_KEY'),
    authDomain: getEnv('EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN'),
    projectId: getEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID'),
    storageBucket: getEnv('EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: getEnv('EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID'),
    appId: getEnv('EXPO_PUBLIC_FIREBASE_APP_ID'),
  },
  google: {
    webClientId: getEnv('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'),
    iosClientId: getEnv('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'),
  },
  revenuecat: {
    apiKey: getEnv('EXPO_PUBLIC_REVENUECAT_API_KEY'),
    entitlementId: getEnv('EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID', 'premium'),
  },
};
