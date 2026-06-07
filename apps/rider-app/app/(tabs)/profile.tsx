import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Typography, Spacing, Radius } from '../../src/constants/theme';
import { useAuthStore } from '../../src/store/auth.store';
import { useSocketStore } from '../../src/store/socket.store';

export default function ProfileScreen() {
  const router = useRouter();
  const { clearTokens } = useAuthStore();
  const { disconnect } = useSocketStore();

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          disconnect();
          await clearTokens();
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>

      <View style={styles.section}>
        <TouchableOpacity
          style={styles.row}
          onPress={() => router.push('/trusted-contacts')}
        >
          <Text style={styles.rowText}>Trusted Contacts</Text>
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
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowText: { color: Colors.text, fontSize: Typography.size.base },
  rowChevron: { color: Colors.textSecondary, fontSize: Typography.size.lg },
  rowDanger: { borderBottomWidth: 0 },
  rowTextDanger: { color: Colors.safety, fontSize: Typography.size.base },
});
