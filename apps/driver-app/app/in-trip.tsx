import { useLocalSearchParams } from 'expo-router';
import { InTripScreen } from '../src/screens/InTripScreen';

export default function InTripPage() {
  const { tripId, riderName, dropoffAddress, driverTakeHome, earningsFloorAmount } =
    useLocalSearchParams<{
      tripId: string;
      riderName?: string;
      dropoffAddress?: string;
      driverTakeHome?: string;
      earningsFloorAmount?: string;
    }>();

  return (
    <InTripScreen
      tripId={tripId ?? ''}
      riderName={riderName ?? 'Rider'}
      dropoffAddress={dropoffAddress ?? ''}
      driverTakeHome={parseFloat(driverTakeHome ?? '0')}
      earningsFloorAmount={parseFloat(earningsFloorAmount ?? '0')}
    />
  );
}
