import React, { useRef } from 'react';
import { View, Vibration, StyleSheet, ViewStyle } from 'react-native';
import { PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/theme';
import { api } from '../api/client';

/**
 * Silent panic gesture. Triple-tap the shield -> single vibration -> POST
 * /safety/panic with NO visual change. Deliberately excluded from the
 * accessibility tree (accessible=false + importantForAccessibility=no +
 * accessibilityElementsHidden for iOS) per the non-negotiable safety spec.
 */
export function PanicShield({ tripId, style }: { tripId: string; style?: ViewStyle }) {
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        tapCountRef.current += 1;
        if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
        tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 600);
        if (tapCountRef.current >= 3) {
          tapCountRef.current = 0;
          Vibration.vibrate(200); // single short vibration, discreet
          api.post('/safety/panic', { tripId }).catch(() => {});
        }
      },
    }),
  ).current;

  return (
    <View
      {...responder.panHandlers}
      style={[styles.shield, style]}
      accessible={false}
      importantForAccessibility="no"
      accessibilityElementsHidden
    >
      <Ionicons name="shield-checkmark" size={24} color={Colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  shield: { padding: 8 },
});
