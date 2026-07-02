import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { StripeProvider } from '@stripe/stripe-react-native';
import { useAuthStore } from '../src/store/auth.store';
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

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: 'bidride-rider' });
    await api.patch('/riders/me/push-token', { token });
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

export default function RootLayout() {
  const { loadTokens, isAuthenticated } = useAuthStore();

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
    // Hide splash after tokens are loaded — don't gate on fonts so a
    // slow/failed font load never permanently blocks the UI.
    loadTokens().then(() => SplashScreen.hideAsync()).catch(() => SplashScreen.hideAsync());
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void registerPushToken();
    }
  }, [isAuthenticated]);

  const stripeKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? 'pk_test_REPLACE_WITH_REAL_KEY';

  const navHeader = {
    headerShown: true,
    headerStyle: { backgroundColor: '#0A2342' },
    headerTintColor: '#00D4C6',
    headerTitleStyle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' as const },
    headerBackTitle: '',
    headerShadowVisible: false,
  } as const;

  return (
    <StripeProvider publishableKey={stripeKey} merchantIdentifier="merchant.com.bidride.rider">
      <StatusBar style="light" backgroundColor="#0A2342" />
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile-setup" options={{ animation: 'slide_from_right', gestureEnabled: false }} />
        <Stack.Screen name="tracking" options={{ ...navHeader, animation: 'slide_from_right', headerTitle: 'Your Ride' }} />
        <Stack.Screen name="sos" options={{ animation: 'fade', presentation: 'modal' }} />
        <Stack.Screen name="trip-complete" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="bid-request" options={{ ...navHeader, animation: 'slide_from_bottom', headerTitle: 'Make an Offer' }} />
        <Stack.Screen name="trusted-contacts" options={{ ...navHeader, animation: 'slide_from_right', headerTitle: 'Trusted Contacts' }} />
        <Stack.Screen name="payment-methods" options={{ ...navHeader, animation: 'slide_from_right', headerTitle: 'Payment Methods' }} />
        <Stack.Screen name="trip-detail" options={{ ...navHeader, animation: 'slide_from_right', headerTitle: 'Trip Details' }} />
      </Stack>
    </StripeProvider>
  );
}
