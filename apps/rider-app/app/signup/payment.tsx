import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography, Spacing } from '../../src/constants/theme';
import { ScreenHeader } from '../../src/components/ui/ScreenHeader';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';

// Signup step: payment setup. Reuses the real PaymentMethods screen (live
// Stripe PaymentSheet) — this screen only explains and routes.
export default function SignupPaymentScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScreenHeader showBack={false} />
      <View style={styles.content}>
        <Text style={styles.title}>Add a payment method</Text>
        <Text style={styles.subtitle}>
          Rides are charged automatically when your trip ends — no cash, no card
          fumbling at the curb.
        </Text>

        <Card style={styles.infoCard}>
          <Text style={styles.infoEmoji}>🔒</Text>
          <Text style={styles.infoText}>
            Cards are stored securely by Stripe. BidiRide never sees your card
            number.
          </Text>
        </Card>

        <Button title="Add a Card" onPress={() => router.push('/payment-methods')} />

        <View style={styles.footer}>
          <Text style={styles.skipHint}>
            You can add a card any time — you'll be asked before your first ride.
          </Text>
          <Button
            title="Continue"
            variant="secondary"
            onPress={() => router.replace('/signup/permissions')}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl },
  title: {
    color: Colors.text,
    fontSize: Typography.size['2xl'],
    fontWeight: Typography.weight.extrabold,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  infoEmoji: { fontSize: 24 },
  infoText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    lineHeight: 20,
  },
  footer: { marginTop: 'auto', marginBottom: Spacing.xl, gap: Spacing.md },
  skipHint: {
    color: Colors.textDisabled,
    fontSize: Typography.size.xs,
    textAlign: 'center',
  },
});
