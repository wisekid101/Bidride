import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { Colors, Typography, Spacing } from '../src/constants/theme';
import { Card } from '../src/components/ui/Card';

// Help & Support — real contact channels only. In-app ticketing arrives with
// the support-tickets backend milestone.
export default function HelpScreen() {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>✉️ General support</Text>
        <Text style={styles.cardBody}>
          Questions about a trip, a charge, or your account.
        </Text>
        <TouchableOpacity onPress={() => Linking.openURL('mailto:support@bidride.com')}>
          <Text style={styles.link}>support@bidride.com</Text>
        </TouchableOpacity>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>🛡️ Safety concerns</Text>
        <Text style={styles.cardBody}>
          Report a safety issue from a past trip. In an emergency, always call 911
          first — during a trip, use the SOS button.
        </Text>
        <TouchableOpacity onPress={() => Linking.openURL('mailto:safety@bidride.com')}>
          <Text style={styles.link}>safety@bidride.com</Text>
        </TouchableOpacity>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardTitle}>💳 Fares & refunds</Text>
        <Text style={styles.cardBody}>
          Every fare is set by our AI before you request — the price you accept is
          the price you pay. If a charge looks wrong, email support with the trip
          date and we'll review it.
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.base, paddingBottom: Spacing['3xl'] },
  card: { marginBottom: Spacing.base, gap: Spacing.sm },
  cardTitle: {
    color: Colors.text,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
  cardBody: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    lineHeight: 20,
  },
  link: {
    color: Colors.primary,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
  },
});
