import { Redirect, Stack } from 'expo-router';
import { useDriverStore } from '../../src/store/driver.store';

export default function AuthLayout() {
  const { isAuthenticated } = useDriverStore();

  if (isAuthenticated) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
