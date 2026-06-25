import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { EWR_TERMINALS, AirportTerminal } from '../constants/airports';
import type { ResolvedAddress } from '../api/geocoding';

interface Props {
  visible: boolean;
  onSelect: (address: ResolvedAddress) => void;
  onDismiss: () => void;
}

export function EwrTerminalPicker({ visible, onSelect, onDismiss }: Props) {
  const handleTerminal = (terminal: AirportTerminal) => {
    onSelect({
      placeId: terminal.id,
      formattedAddress: `Newark Liberty Intl – ${terminal.name}`,
      lat: terminal.lat,
      lng: terminal.lng,
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.pill} />

          <Text style={styles.title}>Which EWR terminal?</Text>
          <Text style={styles.subtitle}>Newark Liberty International Airport</Text>

          {EWR_TERMINALS.map((terminal, i) => (
            <TouchableOpacity
              key={terminal.id}
              style={[styles.row, i > 0 && styles.rowBorder]}
              onPress={() => handleTerminal(terminal)}
              activeOpacity={0.75}
            >
              <View style={styles.badge}>
                <Text style={styles.badgeLetter}>
                  {terminal.name.replace('Terminal ', '')}
                </Text>
              </View>
              <View style={styles.rowInfo}>
                <Text style={styles.terminalName}>{terminal.name}</Text>
                <Text style={styles.terminalDesc}>{terminal.description}</Text>
              </View>
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={styles.skipRow} onPress={onDismiss} activeOpacity={0.7}>
            <Text style={styles.skipText}>Not sure — drop at main entrance</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: Spacing.base,
    paddingBottom: 40,
  },
  pill: {
    width: 40,
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginVertical: Spacing.md,
  },
  title: {
    color: Colors.text,
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.bold,
    marginBottom: 4,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    marginBottom: Spacing.base,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  badgeLetter: {
    color: Colors.primaryText,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
  rowInfo: {
    flex: 1,
  },
  terminalName: {
    color: Colors.text,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
  },
  terminalDesc: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    marginTop: 2,
  },
  skipRow: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
    marginTop: Spacing.sm,
  },
  skipText: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
  },
});
