import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Colors } from '../../constants/theme';
import { useDriverStore } from '../../store/driver.store';
import { router } from 'expo-router';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.bidride.com';

const FCRA_DISCLOSURE = `IMPORTANT DISCLOSURE REGARDING BACKGROUND INVESTIGATION

Pursuant to the Fair Credit Reporting Act (FCRA), 15 U.S.C. § 1681 et seq., we are informing you that a consumer report (background check) may be obtained for employment purposes. The report may contain information about your criminal history, driving record, and other public records.

You have the right to:
• Obtain a free copy of any consumer report provided to us
• Dispute any inaccurate or incomplete information
• Know if information in your report has been used against you

The background check will be conducted by an accredited Consumer Reporting Agency. For questions, contact us at safety@bidride.com.

By authorizing this check, you certify that all information you have provided is accurate and complete.`;

export default function BackgroundCheckScreen() {
  const { accessToken } = useDriverStore();
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!consent) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/drivers/me/background-check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ fcraConsentGiven: true }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message ?? 'Request failed');
      }

      router.push('/onboarding/vehicle-info');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.step}>Step 3 of 6</Text>
          <Text style={styles.title}>Background Check</Text>
          <Text style={styles.subtitle}>
            BidiRide is required by law to disclose the following before running a background check.
          </Text>
        </View>

        <View style={styles.disclosureBox}>
          <Text style={styles.disclosureText}>{FCRA_DISCLOSURE}</Text>
        </View>

        <TouchableOpacity
          style={styles.consentRow}
          onPress={() => setConsent((v) => !v)}
        >
          <View style={[styles.checkbox, consent && styles.checkboxChecked]}>
            {consent && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.consentText}>
            I have read the above disclosure and authorize BidiRide to obtain a consumer report for
            employment purposes.
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueBtn, !consent && styles.continueBtnDisabled]}
          onPress={submit}
          disabled={!consent || loading}
        >
          {loading ? (
            <ActivityIndicator color={Colors.background} />
          ) : (
            <Text style={styles.continueBtnText}>Authorize & Continue</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.footerNote}>
          Typical background checks are completed within 1–3 business days.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1, paddingHorizontal: 24 },
  header: { paddingTop: 24, marginBottom: 24 },
  step: { fontSize: 12, color: Colors.teal, fontWeight: '600', marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.textPrimary, marginBottom: 8 },
  subtitle: { fontSize: 15, color: Colors.textSecondary, lineHeight: 22 },
  disclosureBox: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 24,
  },
  disclosureText: { fontSize: 12, color: Colors.textSecondary, lineHeight: 20 },
  consentRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    paddingBottom: 32,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    flexShrink: 0,
  },
  checkboxChecked: { backgroundColor: Colors.teal, borderColor: Colors.teal },
  checkmark: { color: Colors.background, fontSize: 13, fontWeight: '700' },
  consentText: { fontSize: 14, color: Colors.textPrimary, lineHeight: 20, flex: 1 },
  footer: { padding: 24, paddingBottom: 32, gap: 12 },
  continueBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  continueBtnDisabled: { opacity: 0.5 },
  continueBtnText: { fontSize: 17, fontWeight: '700', color: Colors.background },
  footerNote: { fontSize: 12, color: Colors.textTertiary, textAlign: 'center' },
});
