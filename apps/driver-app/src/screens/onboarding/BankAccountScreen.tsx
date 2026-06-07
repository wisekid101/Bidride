import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Shield, ExternalLink, CheckCircle } from 'lucide-react-native';
import { Colors } from '../../constants/theme';
import { useDriverStore } from '../../store/driver.store';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.bidride.com';

export default function BankAccountScreen({ navigation }: Props) {
  const { accessToken } = useDriverStore();
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);

  const startStripeConnect = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/payments/payout/connect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) throw new Error('Failed to start bank account setup');
      const { onboardingUrl } = await res.json();

      await Linking.openURL(onboardingUrl);
      // After returning from Stripe, poll for completion
      setConnected(true);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.step}>Step 5 of 6</Text>
          <Text style={styles.title}>Bank Account</Text>
          <Text style={styles.subtitle}>
            Connect your bank account to receive earnings. Powered by Stripe — the same platform
            used by Amazon, Shopify, and Lyft.
          </Text>
        </View>

        <View style={styles.featureList}>
          <FeatureRow
            icon="⚡"
            title="Instant Payouts"
            desc="Transfer your earnings instantly for $0.99 (min. $10)"
          />
          <FeatureRow
            icon="📅"
            title="Weekly Deposits"
            desc="Automatic weekly ACH deposit at no extra cost"
          />
          <FeatureRow
            icon="🔒"
            title="Bank-Level Security"
            desc="256-bit encryption. We never see your account number."
          />
        </View>

        {connected && (
          <View style={styles.successBanner}>
            <CheckCircle size={20} color={Colors.teal} />
            <Text style={styles.successText}>Bank account connected successfully!</Text>
          </View>
        )}

        <View style={styles.securityNote}>
          <Shield size={16} color={Colors.textTertiary} />
          <Text style={styles.securityText}>
            Your banking information is processed directly by Stripe and is never stored on BidRide
            servers.
          </Text>
        </View>
      </View>

      <View style={styles.footer}>
        {!connected ? (
          <TouchableOpacity
            style={styles.stripeBtn}
            onPress={startStripeConnect}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={Colors.background} />
            ) : (
              <>
                <ExternalLink size={18} color={Colors.background} />
                <Text style={styles.stripeBtnText}>Connect with Stripe</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.continueBtn}
            onPress={() => navigation.navigate('OnboardingComplete')}
          >
            <Text style={styles.continueBtnText}>Finish Setup</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

function FeatureRow({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <View style={styles.featureRow}>
      <Text style={styles.featureIcon}>{icon}</Text>
      <View style={styles.featureText}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDesc}>{desc}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { flex: 1, paddingHorizontal: 24 },
  header: { paddingTop: 24, marginBottom: 32 },
  step: { fontSize: 12, color: Colors.teal, fontWeight: '600', marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.textPrimary, marginBottom: 8 },
  subtitle: { fontSize: 15, color: Colors.textSecondary, lineHeight: 22 },
  featureList: { gap: 16, marginBottom: 32 },
  featureRow: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  featureIcon: { fontSize: 24, width: 32 },
  featureText: { flex: 1 },
  featureTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary, marginBottom: 2 },
  featureDesc: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.teal + '20',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  successText: { fontSize: 14, color: Colors.teal, fontWeight: '600' },
  securityNote: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  securityText: { fontSize: 12, color: Colors.textTertiary, lineHeight: 18, flex: 1 },
  footer: { padding: 24, paddingBottom: 32 },
  stripeBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  stripeBtnText: { fontSize: 17, fontWeight: '700', color: Colors.background },
  continueBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  continueBtnText: { fontSize: 17, fontWeight: '700', color: Colors.background },
});
