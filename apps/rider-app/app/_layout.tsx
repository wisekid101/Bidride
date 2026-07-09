import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { StripeProvider } from '@stripe/stripe-react-native';
import { useAuthStore } from '../src/store/auth.store';
import { useSocketStore } from '../src/store/socket.store';
import { useTripStore } from '../src/store/trip.store';
import type { TripStatus } from '../src/store/trip.store';
import { api } from '../src/api/client';

SplashScreen.preventAutoHideAsync();

interface ActiveTripResponse {
  id: string;
  status: TripStatus;
  role: 'rider' | 'driver';
  pickupAddress: string;
  dropoffAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  aiFare: number;
  driver: {
    name: string;
    badge?: string;
    vehicleMake?: string;
    vehicleModel?: string;
    vehicleColor?: string;
    licensePlate?: string;
    photoUrl?: string;
  } | null;
}

// Cold-start rehydration: if the server has an in-flight trip for this rider,
// hydrate the trip store before the splash hides. HomeScreen's existing
// activeTrip effect then navigates to /tracking, and TrackingScreen re-joins
// the trip room on mount — no new navigation or socket paths.
async function restoreActiveTrip() {
  try {
    const { trip } = await api.get<{ trip: ActiveTripResponse | null }>('/trips/active');
    if (!trip || trip.role !== 'rider') return;
    useTripStore.getState().setActiveTrip({
      id: trip.id,
      status: trip.status,
      pickupAddress: trip.pickupAddress,
      dropoffAddress: trip.dropoffAddress,
      pickupLat: trip.pickupLat,
      pickupLng: trip.pickupLng,
      dropoffLat: trip.dropoffLat,
      dropoffLng: trip.dropoffLng,
      aiFare: trip.aiFare,
      ...(trip.driver
        ? {
            driverName: trip.driver.name,
            driverBadge: trip.driver.badge,
            vehicleMake: trip.driver.vehicleMake,
            vehicleModel: trip.driver.vehicleModel,
            vehicleColor: trip.driver.vehicleColor,
            licensePlate: trip.driver.licensePlate,
            driverPhotoUrl: trip.driver.photoUrl,
          }
        : {}),
    });
    // Re-join the trip room on the raw socket: socket.io buffers this emit
    // until the handshake completes. subscribeToTrip() would silently drop it
    // here because the cold-start socket is still connecting (store guard).
    useSocketStore.getState().socket?.emit('subscribe:trip', { tripId: trip.id });
  } catch {
    // Rehydration is best-effort — a failed fetch must never block startup
  }
}

async function registerPushToken() {
  try {
    // Never PROMPT from here — the signup permission-education screen owns
    // the OS dialog so riders see the why first. This only refreshes the
    // token for riders who already granted.
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

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
    loadTokens().then(async () => {
      const { accessToken } = useAuthStore.getState();
      if (accessToken) {
        // Sockets first (emits are buffered until connected), then restore —
        // hydrating before the splash hides avoids flashing Home mid-trip.
        useSocketStore.getState().connect(accessToken);
        await restoreActiveTrip();
      }
      return SplashScreen.hideAsync();
    }).catch(() => SplashScreen.hideAsync());
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void registerPushToken();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const receivedSub = Notifications.addNotificationReceivedListener((_notification) => {
      // Foreground push — OS displays it via setNotificationHandler above
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as {
        type?: string;
        tripId?: string;
      };
      switch (data?.type) {
        case 'TRIP_ASSIGNED':
        case 'DRIVER_ARRIVED':
        case 'TRIP_STARTED':
          router.push('/tracking');
          break;
        case 'TRIP_COMPLETED':
          router.push('/trip-complete');
          break;
        case 'TRIP_CANCELLED':
          router.replace('/(tabs)');
          break;
      }
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, []);

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
    <StripeProvider publishableKey={stripeKey} merchantIdentifier="merchant.com.bidride.rider" urlScheme="bidride-rider">
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
        <Stack.Screen name="edit-profile" options={{ ...navHeader, animation: 'slide_from_right', headerTitle: 'Edit Profile' }} />
        <Stack.Screen name="saved-places" options={{ ...navHeader, animation: 'slide_from_right', headerTitle: 'Saved Places' }} />
        <Stack.Screen name="help" options={{ ...navHeader, animation: 'slide_from_right', headerTitle: 'Help & Support' }} />
        <Stack.Screen name="settings" options={{ ...navHeader, animation: 'slide_from_right', headerTitle: 'Settings' }} />
        <Stack.Screen name="signup/payment" options={{ animation: 'slide_from_right', gestureEnabled: false }} />
        <Stack.Screen name="signup/permissions" options={{ animation: 'slide_from_right', gestureEnabled: false }} />
      </Stack>
    </StripeProvider>
  );
}
