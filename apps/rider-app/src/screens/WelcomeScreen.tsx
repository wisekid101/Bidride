import React from 'react';
import { View, Text, StyleSheet, SafeAreaView } from 'react-native';
import { router } from 'expo-router';
import { Colors, Typography, Spacing } from '../constants/theme';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';

export function WelcomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.logoSection}>
          <Text style={styles.logo}>BidiRide</Text>
          <Text style={styles.tagline}>AI-powered rides. Fair prices. Fast.</Text>
        </View>

        <View style={styles.cards}>
          <Card style={styles.card}>
            <Text style={styles.cardEmoji}>🤖</Text>
            <Text style={styles.cardTitle}>AI Fair Fares</Text>
            <Text style={styles.cardBody}>
              Our AI prices every ride fairly — no games, no surprises at the end.
            </Text>
          </Card>

          <Card style={styles.card}>
            <Text style={styles.cardEmoji}>💬</Text>
            <Text style={styles.cardTitle}>Name Your Price</Text>
            <Text style={styles.cardBody}>
              Don't like the fare? Make an offer and let drivers come to you.
            </Text>
          </Card>

          <Card style={styles.card}>
            <Text style={styles.cardEmoji}>🛡️</Text>
            <Text style={styles.cardTitle}>Safety First</Text>
            <Text style={styles.cardBody}>
              In-app SOS, trusted contacts, and 24/7 safety monitoring on every trip.
            </Text>
          </Card>
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          title="Sign Up"
          onPress={() => router.push({ pathname: '/(auth)/phone', params: { intent: 'signup' } })}
        />
        <Button
          title="Log In"
          variant="secondary"
          onPress={() => router.push({ pathname: '/(auth)/phone', params: { intent: 'login' } })}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, paddingHorizontal: Spacing.xl, justifyContent: 'center' },
  logoSection: { alignItems: 'center', marginBottom: Spacing['3xl'] },
  logo: {
    color: Colors.primary,
    fontSize: 40,
    fontWeight: Typography.weight.extrabold,
    letterSpacing: -1,
  },
  tagline: {
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
    marginTop: Spacing.xs,
  },
  cards: { gap: Spacing.md },
  card: { padding: Spacing.lg },
  cardEmoji: { fontSize: 28, marginBottom: Spacing.sm },
  cardTitle: {
    color: Colors.text,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.bold,
    marginBottom: Spacing.xs,
  },
  cardBody: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    lineHeight: 20,
  },
  actions: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl, gap: Spacing.md },
});
