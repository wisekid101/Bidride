import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../../src/constants/theme';
import { useDriverStore } from '../../src/store/driver.store';

export default function DriverProfileScreen() {
  const router = useRouter();
  const { clearTokens, isOnline } = useDriverStore();

  const handleSignOut = () => {
    if (isOnline) {
      Alert.alert('Go offline first', 'Please go offline before signing out.');
      return;
    }
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => clearTokens() },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>

      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => router.push('/onboarding/vehicle-info')}
        >
          <Text style={styles.rowText}>Vehicle & Documents</Text>
          <Text style={styles.rowChevron}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <TouchableOpacity style={[styles.row, styles.rowDanger]} onPress={handleSignOut}>
          <Text style={styles.rowTextDanger}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  title: {
    color: Colors.text,
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.bold,
    padding: Spacing.base,
    paddingTop: 60,
  },
  section: {
    marginHorizontal: Spacing.base,
    marginBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.base,
  },
  rowText: { color: Colors.text, fontSize: Typography.size.base },
  rowChevron: { color: Colors.textSecondary, fontSize: Typography.size.lg },
  rowDanger: {},
  rowTextDanger: { color: Colors.safety, fontSize: Typography.size.base },
});
