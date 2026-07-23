import React, { useEffect, useState } from 'react';
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
import { router } from 'expo-router';
import { Colors } from '../../constants/theme';
import { api, ApiError } from '../../api/client';
import { OnboardingHeader } from './OnboardingHeader';
import { getCurrentAppVersion, isUpdateRequired } from '../../utils/appVersionGate';

// FROZEN API CONTRACT (backend already built):
//   GET  /drivers/me/zero-tolerance/policy  -> ZeroTolerancePolicy
//   POST /drivers/me/zero-tolerance/accept  -> AcceptResponse
// The api client attaches x-app-version if present; the server validates
// policyVersion == current (409 on stale).
interface ZeroTolerancePolicy {
  version: string;
  contentHash: string;
  body: string;
  minAppVersion: string;
  effectiveAt: string;
}

interface AcceptResponse {
  success: true;
  nextStep: 'complete';
  alreadyAccepted: boolean;
}

export default function ZeroToleranceScreen() {
  const [policy, setPolicy] = useState<ZeroTolerancePolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Captured once — the version the binary reports about itself. Null means we
  // couldn't read it; the gate fails open in that case (see isUpdateRequired).
  const currentAppVersion = getCurrentAppVersion();

  const loadPolicy = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<ZeroTolerancePolicy>('/drivers/me/zero-tolerance/policy');
      setPolicy(data);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Could not load the policy. Please try again.';
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPolicy();
  }, []);

  const updateRequired = policy
    ? isUpdateRequired(currentAppVersion, policy.minAppVersion)
    : false;

  const accept = async () => {
    if (!policy || !acknowledged || updateRequired) return;

    setSubmitting(true);
    try {
      const res = await api.post<AcceptResponse>('/drivers/me/zero-tolerance/accept', {
        policyVersion: policy.version,
        acknowledged: true,
      });
      if (res.success) {
        router.push('/onboarding/complete');
      }
    } catch (err) {
      // 409 = the policy version rotated under us. Re-fetch so the driver
      // acknowledges the current text rather than re-submitting a stale hash.
      if (err instanceof ApiError && err.status === 409) {
        Alert.alert(
          'Policy Updated',
          'The Zero Tolerance policy changed since you opened this screen. Please review the current version and acknowledge again.',
        );
        setAcknowledged(false);
        await loadPolicy();
      } else {
        const message =
          err instanceof ApiError ? err.message : 'Could not submit. Please try again.';
        Alert.alert('Error', message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Loading ----
  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <OnboardingHeader route="/onboarding/zero-tolerance" />
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.teal} size="large" />
          <Text style={styles.centeredText}>Loading policy…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ---- Load error ----
  if (loadError || !policy) {
    return (
      <SafeAreaView style={styles.container}>
        <OnboardingHeader route="/onboarding/zero-tolerance" />
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.centeredText}>
            {loadError ?? 'Could not load the policy. Please try again.'}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadPolicy}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ---- Force update: block acceptance entirely ----
  if (updateRequired) {
    return (
      <SafeAreaView style={styles.container}>
        <OnboardingHeader route="/onboarding/zero-tolerance" />
        <View style={styles.centered}>
          <Text style={styles.updateIcon}>⬆️</Text>
          <Text style={styles.errorTitle}>Update Required</Text>
          <Text style={styles.centeredText}>
            A newer version of Bidiride Driver is required to review and accept the current Zero
            Tolerance policy. Please update the app to continue.
          </Text>
          <View style={styles.versionBox}>
            <Text style={styles.versionLine}>
              Your version: {currentAppVersion ?? 'unknown'}
            </Text>
            <Text style={styles.versionLine}>Required: {policy.minAppVersion}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ---- Normal acceptance flow ----
  return (
    <SafeAreaView style={styles.container}>
      <OnboardingHeader route="/onboarding/zero-tolerance" />
      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.step}>Zero Tolerance Policy</Text>
          <Text style={styles.title}>Safety Commitment</Text>
          <Text style={styles.subtitle}>
            Please read Bidiride's Zero Tolerance policy in full. You must acknowledge it before you
            can be activated.
          </Text>
        </View>

        <View style={styles.policyBox}>
          <Text style={styles.policyText}>{policy.body}</Text>
        </View>

        <TouchableOpacity
          style={styles.consentRow}
          onPress={() => setAcknowledged((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: acknowledged }}
        >
          <View style={[styles.checkbox, acknowledged && styles.checkboxChecked]}>
            {acknowledged && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.consentText}>
            I have read and agree to abide by the Bidiride Zero Tolerance policy.
          </Text>
        </TouchableOpacity>

        <Text style={styles.versionNote}>Policy version {policy.version}</Text>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.continueBtn, !acknowledged && styles.continueBtnDisabled]}
          onPress={accept}
          disabled={!acknowledged || submitting}
        >
          {submitting ? (
            <ActivityIndicator color={Colors.background} />
          ) : (
            <Text style={styles.continueBtnText}>Accept & Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1, paddingHorizontal: 24 },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  centeredText: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  errorTitle: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  retryBtn: {
    marginTop: 12,
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  retryBtnText: { fontSize: 16, fontWeight: '700', color: Colors.background },

  updateIcon: { fontSize: 48 },
  versionBox: {
    marginTop: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    alignSelf: 'stretch',
    gap: 4,
  },
  versionLine: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },

  header: { paddingTop: 24, marginBottom: 24 },
  step: { fontSize: 12, color: Colors.teal, fontWeight: '600', marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.textPrimary, marginBottom: 8 },
  subtitle: { fontSize: 15, color: Colors.textSecondary, lineHeight: 22 },

  policyBox: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 24,
  },
  policyText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },

  consentRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
    paddingBottom: 16,
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

  versionNote: { fontSize: 12, color: Colors.textTertiary, paddingBottom: 32 },

  footer: { padding: 24, paddingBottom: 32, gap: 12 },
  continueBtn: {
    backgroundColor: Colors.teal,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  continueBtnDisabled: { opacity: 0.5 },
  continueBtnText: { fontSize: 17, fontWeight: '700', color: Colors.background },
});
