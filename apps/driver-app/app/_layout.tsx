import { useEffect, useRef, useState } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { AppState, Platform, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrandSplash } from '../src/components/ui/BrandSplash';
import { useDriverStore } from '../src/store/driver.store';
import { useDriverSocketStore } from '../src/store/socket.store';
import { api } from '../src/api/client';
import { resolveResumeRoute } from '../src/utils/onboardingPlan';

SplashScreen.preventAutoHideAsync();

// Single client for the whole app — EarningsDashboardScreen (and any other
// useQuery consumer) requires a QueryClientProvider above it.
const queryClient = new QueryClient();

const PLATFORM_FEE_RATE = 0.20;

// Cold-start onboarding resume: a driver who isn't approved must never land
// on Home — route them to their current onboarding step instead.
// Returns true when it navigated (caller then skips trip restore). Retries
// /drivers/me internally so a transient failure never drops an onboarding
// driver onto the Dashboard; approved/unreachable/expired are left to the
// default route + the centralised auth redirect.
async function resumeOnboardingIfNeeded(): Promise<boolean> {
  const route = await resolveResumeRoute(api.get);
  if (!route || route === '/(tabs)') return false;
  router.replace(route as never);
  return true;
}

// Cold-start rehydration: if the server has an in-flight trip this driver
// already accepted, route straight to the matching screen with the same
// params the normal accept/arrived flow passes. Searching trips are skipped
// (request cards are ephemeral; redispatch re-broadcasts them).
async function restoreActiveTrip() {
  try {
    const { trip } = await api.get<{
      trip: {
        id: string;
        status: string;
        role: 'rider' | 'driver';
        pickupAddress: string;
        dropoffAddress: string;
        aiFare: number;
        riderName: string;
      } | null;
    }>('/trips/active');
    if (!trip || trip.role !== 'driver') return;

    const driverTakeHome = (trip.aiFare * (1 - PLATFORM_FEE_RATE)).toFixed(2);
    if (trip.status === 'accepted' || trip.status === 'driver_en_route') {
      router.replace({
        pathname: '/navigating-to-pickup',
        params: {
          tripId: trip.id,
          pickupAddress: trip.pickupAddress,
          dropoffAddress: trip.dropoffAddress,
          driverTakeHome,
        },
      });
    } else if (trip.status === 'driver_arrived' || trip.status === 'in_progress') {
      router.replace({
        pathname: '/in-trip',
        params: {
          tripId: trip.id,
          riderName: trip.riderName,
          dropoffAddress: trip.dropoffAddress,
          driverTakeHome,
          earningsFloorAmount: '0',
          phase: trip.status === 'in_progress' ? 'in_progress' : 'arrived',
        },
      });
    }
  } catch {
    // Rehydration is best-effort — a failed fetch must never block startup
  }
}

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
  // Branded animated splash: covers the app until session hydration + onboarding
  // resume settle, then fades — so a returning driver never flashes the wrong screen.
  const [hydrated, setHydrated] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

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
    loadTokens().then(async () => {
      // Reconnect the socket on cold start so dispatch events arrive without
      // re-login. Guard on socket presence — this effect re-runs when fonts
      // load, and connect() alone doesn't dedupe a still-handshaking socket.
      const { accessToken } = useDriverStore.getState();
      if (accessToken && !useDriverSocketStore.getState().socket) {
        useDriverSocketStore.getState().connect(accessToken);
        // Sockets first. Then: unfinished onboarding resumes exactly where the
        // driver left off (never Home); approved drivers restore in-flight trips.
        const resumed = await resumeOnboardingIfNeeded();
        if (!resumed) await restoreActiveTrip();
      }
      if (fontsLoaded) SplashScreen.hideAsync();
    }).catch(() => {
      // Cold-start restore is best-effort — never let a rejection go unhandled
      // or block the UI; hide the native splash so the app is reachable.
      SplashScreen.hideAsync();
    }).finally(() => setHydrated(true));
  }, [fontsLoaded]);

  useEffect(() => {
    if (isAuthenticated) {
      void registerPushToken();
    }
  }, [isAuthenticated]);

  // Centralised session-expiry redirect: when a token refresh fails the api
  // client clears tokens (isAuthenticated → false). Redirect to auth exactly
  // once on that transition — never on the initial unauthenticated render — so
  // concurrent 401s can't produce a redirect storm. The auth screen shows the
  // friendly message; onboarding progress is preserved server-side and resumes
  // after signing in again.
  const wasAuthenticated = useRef(false);
  useEffect(() => {
    if (wasAuthenticated.current && !isAuthenticated) {
      router.replace('/(auth)');
    }
    wasAuthenticated.current = isAuthenticated;
  }, [isAuthenticated]);

  useEffect(() => {
    // iOS suspension kills the WebSocket and exhausts socket.io's retry budget,
    // leaving a driver who looks Online but receives no requests. Reconnect on
    // foreground; connect() is idempotent so this never duplicates sockets.
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const { accessToken } = useDriverStore.getState();
      const { socket, connect } = useDriverSocketStore.getState();
      if (accessToken && !socket?.connected) {
        connect(accessToken);
      }
    });
    return () => sub.remove();
  }, []);

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
    <View style={{ flex: 1 }}>
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
      {showSplash && (
        <BrandSplash ready={hydrated} onFinish={() => setShowSplash(false)} />
      )}
    </View>
  );
}
