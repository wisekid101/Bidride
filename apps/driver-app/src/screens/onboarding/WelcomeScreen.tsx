import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Image,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Typography } from '../../constants/theme';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

export default function WelcomeScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.logoSection}>
          <Text style={styles.logoText}>BidiRide</Text>
          <Text style={styles.tagline}>Drive. Earn. Thrive.</Text>
        </View>

        <View style={styles.infoCards}>
          <View style={styles.card}>
            <Text style={styles.cardEmoji}>💰</Text>
            <Text style={styles.cardTitle}>Guaranteed Floor</Text>
            <Text style={styles.cardBody}>
              Your earnings are protected. We cover the difference if a fare doesn't meet our minimum.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardEmoji}>⚡</Text>
            <Text style={styles.cardTitle}>Instant Payouts</Text>
            <Text style={styles.cardBody}>
              Get your money when you need it. Instant transfers available 24/7.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardEmoji}>🛡️</Text>
            <Text style={styles.cardTitle}>Safety First</Text>
            <Text style={styles.cardBody}>
              In-app SOS, panic mode, and 24/7 safety monitoring keep you protected.
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => navigation.navigate('PhoneAuth')}
        >
          <Text style={styles.primaryBtnText}>Get Started</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={() => navigation.navigate('PhoneAuth')}
        >
          <Text style={styles.secondaryBtnText}>I Already Have an Account</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  logoSection: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoText: {
    fontSize: 40,
    fontWeight: '800',
    color: Colors.teal,
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 16,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  infoCards: {
    gap: 12,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardEmoji: {
    fontSize: 28,
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  cardBody: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  actions: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.background,
  },
  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: 15,
    color: Colors.teal,
    fontWeight: '600',
  },
});
