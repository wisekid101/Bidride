import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, SafeAreaView, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Colors, Fonts, Spacing, Typography } from '../constants/theme';
import { Button } from '../components/ui/Button';
import { BrandMark } from '../components/ui/BrandMark';

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { icon: 'sparkles', title: 'AI Fair Fares', body: 'Our AI prices every ride fairly — no games, no surprises at the end.' },
  { icon: 'pricetag', title: 'Name Your Price', body: "Don't like the fare? Make an offer and let drivers come to you." },
  { icon: 'shield-checkmark', title: 'Safety First', body: 'In-app SOS, trusted contacts, and 24/7 safety monitoring on every trip.' },
];

export function WelcomeScreen() {
  // Staggered entrance so the screen feels alive on first launch.
  const fade = useRef(FEATURES.map(() => new Animated.Value(0))).current;
  const heroFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(heroFade, { toValue: 1, duration: 420, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
    Animated.stagger(
      90,
      fade.map((v) =>
        Animated.timing(v, { toValue: 1, duration: 360, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ),
    ).start();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Animated.View
          style={[
            styles.logoSection,
            { opacity: heroFade, transform: [{ translateY: heroFade.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
          ]}
        >
          <BrandMark layout="stacked" size="lg" />
          <Text style={styles.tagline}>AI-powered rides. Fair prices. Fast.</Text>
        </Animated.View>

        <View style={styles.cards}>
          {FEATURES.map((f, i) => (
            <Animated.View
              key={f.title}
              style={[
                styles.card,
                { opacity: fade[i], transform: [{ translateY: fade[i].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] },
              ]}
            >
              <View style={styles.iconBadge}>
                <Ionicons name={f.icon} size={22} color={Colors.primary} />
              </View>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{f.title}</Text>
                <Text style={styles.cardBody}>{f.body}</Text>
              </View>
            </Animated.View>
          ))}
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          title="Create account"
          icon="arrow-forward"
          iconPosition="right"
          onPress={() => router.push({ pathname: '/(auth)/phone', params: { intent: 'signup' } })}
        />
        <Button
          title="I already have an account"
          variant="ghost"
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
  tagline: {
    color: Colors.textSecondary,
    fontSize: Typography.size.base,
    fontFamily: Fonts.sansMedium,
    marginTop: Spacing.base,
  },
  cards: { gap: Spacing.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: { flex: 1 },
  cardTitle: {
    color: Colors.text,
    fontSize: Typography.size.md,
    fontFamily: Fonts.sansBold,
    marginBottom: 2,
  },
  cardBody: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    fontFamily: Fonts.sans,
    lineHeight: 19,
  },
  actions: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl, gap: Spacing.sm },
});
