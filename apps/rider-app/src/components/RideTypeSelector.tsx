import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Car, Plane, Users } from 'lucide-react-native';
import { Colors, Fonts, Radius, Spacing, Typography } from '../constants/theme';

// Phase 1 services. XL / Premium arrive with eligibility + pricing support —
// never render a card that pricing and dispatch can't actually honor.
export type RideTypeId = 'standard' | 'airport';

export interface RideTypeOption {
  id: RideTypeId;
  name: string;
  fare: number;
  capacityLabel: string;
  sublabel?: string;
}

interface RideTypeSelectorProps {
  options: RideTypeOption[];
  selectedId: RideTypeId;
  onSelect: (id: RideTypeId) => void;
}

export function RideTypeSelector({ options, selectedId, onSelect }: RideTypeSelectorProps) {
  if (options.length === 0) return null;

  // With a single service there is no choice to make: render an
  // informational card, not a one-option radio group wearing selector
  // chrome (screen readers would announce a selection that can't change).
  const isChoice = options.length > 1;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      {...(isChoice ? { accessibilityRole: 'radiogroup' as const } : {})}
    >
      {options.map((option) => {
        const selected = option.id === selectedId;
        const Icon = option.id === 'airport' ? Plane : Car;
        const inner = (
          <>
            <View style={styles.cardHeader}>
              <Icon size={20} color={selected ? Colors.teal : Colors.textSecondary} />
              <Text style={[styles.name, selected && styles.nameSelected]}>{option.name}</Text>
            </View>
            <Text style={styles.fare}>${option.fare.toFixed(2)}</Text>
            <View style={styles.capacityRow}>
              <Users size={12} color={Colors.textSecondary} />
              <Text style={styles.capacity}>{option.capacityLabel}</Text>
            </View>
            {option.sublabel ? <Text style={styles.sublabel}>{option.sublabel}</Text> : null}
          </>
        );

        if (!isChoice) {
          return (
            <View
              key={option.id}
              style={[styles.card, styles.cardSelected]}
              accessible
              accessibilityLabel={`Ride type ${option.name}, $${option.fare.toFixed(2)}, ${option.capacityLabel}`}
            >
              {inner}
            </View>
          );
        }

        return (
          <TouchableOpacity
            key={option.id}
            style={[styles.card, selected && styles.cardSelected]}
            onPress={() => onSelect(option.id)}
            activeOpacity={0.8}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${option.name}, $${option.fare.toFixed(2)}, ${option.capacityLabel}`}
          >
            {inner}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: Spacing.sm,
    paddingVertical: 2,
  },
  card: {
    minWidth: 148,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: 4,
  },
  cardSelected: {
    borderColor: Colors.teal,
    backgroundColor: Colors.teal + '14',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  name: {
    color: Colors.text,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.semibold,
  },
  nameSelected: { color: Colors.teal },
  fare: {
    color: Colors.text,
    fontSize: Typography.size.lg,
    fontFamily: Fonts.mono,
    fontWeight: Typography.weight.bold,
  },
  capacityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  capacity: {
    color: Colors.textSecondary,
    fontSize: Typography.size.xs,
  },
  sublabel: {
    color: Colors.textSecondary,
    fontSize: Typography.size.xs,
  },
});
