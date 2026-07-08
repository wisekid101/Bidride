import { useLocalSearchParams } from 'expo-router';
import { InTripScreen } from '../src/screens/InTripScreen';

export default function InTripPage() {
  const { tripId, riderName, dropoffAddress, driverTakeHome, earningsFloorAmount, phase } =
    useLocalSearchParams<{
      tripId: string;
      riderName?: string;
      dropoffAddress?: string;
      driverTakeHome?: string;
      earningsFloorAmount?: string;
      phase?: string;
    }>();

  return (
    <InTripScreen
      tripId={tripId ?? ''}
      riderName={riderName ?? 'Rider'}
      dropoffAddress={dropoffAddress ?? ''}
      driverTakeHome={parseFloat(driverTakeHome ?? '0')}
      earningsFloorAmount={parseFloat(earningsFloorAmount ?? '0')}
      initialPhase={phase === 'in_progress' ? 'in_progress' : 'arrived'}
    />
  );
}
