import { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'BidRide',
  slug: 'bidride-rider',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'bidride-rider',
  userInterfaceStyle: 'dark',
  splash: {
    backgroundColor: '#0A2342',
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.bidride.rider',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'BidRide needs your location to show nearby drivers and calculate pickup.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'BidRide uses your location during active trips.',
      NSMicrophoneUsageDescription:
        'BidRide records audio only during confirmed SOS events for your safety.',
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#0A2342',
    },
    package: 'com.bidride.rider',
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'RECORD_AUDIO',
      'VIBRATE',
    ],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'BidRide uses your location during active trips.',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: '#00D4C6',
      },
    ],
    [
      './plugins/withGoogleMapsIOS',
      {
        // Build-time only — set in .env (see .env.example); never commit the key
        apiKey: process.env.GOOGLE_MAPS_IOS_API_KEY ?? '',
      },
    ],
    [
      '@stripe/stripe-react-native',
      {
        merchantIdentifier: 'merchant.com.bidride.rider',
        enableGooglePay: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
  extra: {
    router: {
      origin: false,
    },
    eas: {
      projectId: 'bidride-rider',
    },
  },
};

export default config;
