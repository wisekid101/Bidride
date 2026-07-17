import React, { useRef } from 'react';
import { View, Vibration, StyleSheet, ViewStyle, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/theme';
import { api } from '../api/client';

/** Silent triple-tap panic. Not in the accessibility tree (spec). */
export function PanicShield({ tripId, style }: { tripId: string; style?: ViewStyle }) {
  const taps = useRef(0);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      taps.current += 1;
      if (t.current) clearTimeout(t.current);
      t.current = setTimeout(() => { taps.current = 0; }, 600);
      if (taps.current >= 3) {
        taps.current = 0;
        Vibration.vibrate(200);
        api.post('/safety/panic', { tripId }).catch(() => {});
      }
    },
  })).current;
  return (
    <View {...responder.panHandlers} style={[styles.s, style]}
      accessible={false} importantForAccessibility="no" accessibilityElementsHidden>
      <Ionicons name="shield-checkmark" size={24} color={Colors.primary} />
    </View>
  );
}
const styles = StyleSheet.create({ s: { padding: 8 } });
