import { useLocalSearchParams } from 'expo-router';
import { NavigatingToPickupScreen } from '../src/screens/NavigatingToPickup';

export default function NavigatingToPickupPage() {
  const { tripId, pickupAddress, dropoffAddress, driverTakeHome } = useLocalSearchParams<{
    tripId: string;
    pickupAddress: string;
    dropoffAddress: string;
    driverTakeHome: string;
  }>();

  return (
    <NavigatingToPickupScreen
      tripId={tripId ?? ''}
      pickupAddress={pickupAddress ?? ''}
      dropoffAddress={dropoffAddress ?? ''}
      driverTakeHome={parseFloat(driverTakeHome ?? '0')}
    />
  );
}
