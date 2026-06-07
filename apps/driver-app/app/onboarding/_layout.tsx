import { Stack } from 'expo-router';

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="personal-info" />
      <Stack.Screen name="vehicle-info" />
      <Stack.Screen name="document-upload" />
      <Stack.Screen name="bank-account" />
      <Stack.Screen name="background-check" />
      <Stack.Screen name="complete" />
    </Stack>
  );
}
