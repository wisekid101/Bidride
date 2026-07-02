import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useDriverStore } from '../src/store/driver.store';
import { api } from '../src/api/client';

SplashScreen.preventAutoHideAsync();

async function registerPushToken() {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: 'bidride-driver' });
    await api.patch('/drivers/me/push-token', { token });
  } catch {
    // Push token registration is best-effort — do not block app startup
  }
}

if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'default',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#00D4C6',
  });
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  const { loadTokens, isAuthenticated } = useDriverStore();

  const [fontsLoaded] = useFonts({
    'Inter-Regular': require('../assets/fonts/Inter-Regular.ttf'),
    'Inter-Medium': require('../assets/fonts/Inter-Medium.ttf'),
    'Inter-SemiBold': require('../assets/fonts/Inter-SemiBold.ttf'),
    'Inter-Bold': require('../assets/fonts/Inter-Bold.ttf'),
    'Inter-ExtraBold': require('../assets/fonts/Inter-ExtraBold.ttf'),
    'JetBrainsMono-Regular': require('../assets/fonts/JetBrainsMono-Regular.ttf'),
    'JetBrainsMono-Bold': require('../assets/fonts/JetBrainsMono-Bold.ttf'),
  });

  useEffect(() => {
    loadTokens().then(() => {
      if (fontsLoaded) SplashScreen.hideAsync();
    });
  }, [fontsLoaded]);

  useEffect(() => {
    if (isAuthenticated) {
      void registerPushToken();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const receivedSub = Notifications.addNotificationReceivedListener((_notification) => {
      // Notification arrived while app is foregrounded — OS shows it via setNotificationHandler
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as {
        type?: string;
        tripId?: string;
      };
      switch (data?.type) {
        case 'NEW_REQUEST':
          router.push('/incoming-request');
          break;
        case 'COUNTER_ACCEPTED':
        case 'TRIP_CANCELLED':
          router.replace('/(tabs)');
          break;
        case 'TRIP_COMPLETED':
        case 'RATING_RECEIVED':
          router.replace('/(tabs)/earnings');
          break;
      }
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, []);

  if (!fontsLoaded) return null;

  return (
    <>
      <StatusBar style="light" backgroundColor="#0A2342" />
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="incoming-request" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="navigating-to-pickup" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="in-trip" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="airport-mode" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="wallet" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen
          name="rate-rider"
          options={{
            animation: 'slide_from_right',
            headerShown: true,
            headerStyle: { backgroundColor: '#0A2342' },
            headerTintColor: '#00D4C6',
            headerTitleStyle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' as const },
            headerBackTitle: '',
            headerShadowVisible: false,
            headerTitle: 'Rate Your Rider',
          }}
        />
      </Stack>
    </>
  );
}
