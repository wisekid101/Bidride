import { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Bidiride Driver',
  slug: 'bidride-driver',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'bidride-driver',
  userInterfaceStyle: 'dark',
  splash: {
    backgroundColor: '#0A2342',
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.bidride.driver',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Bidiride Driver needs your location to receive trip requests.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Bidiride Driver tracks your location during active shifts for dispatch.',
      NSMicrophoneUsageDescription:
        'Bidiride records audio only during confirmed SOS events for your safety.',
      NSPhotoLibraryUsageDescription:
        'Upload vehicle and document photos for driver verification.',
      NSCameraUsageDescription:
        'Take photos of your documents for driver verification.',
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: '#0A2342',
    },
    package: 'com.bidride.driver',
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'RECORD_AUDIO',
      'VIBRATE',
      'CAMERA',
      'READ_EXTERNAL_STORAGE',
    ],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'Bidiride Driver tracks location during active shifts.',
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
      'expo-image-picker',
      {
        photosPermission: 'Upload document photos for driver verification.',
      },
    ],
    [
      './plugins/withGoogleMapsIOS',
      {
        // Build-time only — set in .env (see .env.example); never commit the key
        apiKey: process.env.GOOGLE_MAPS_IOS_API_KEY ?? '',
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
      projectId: 'bidride-driver',
    },
  },
};

export default config;
