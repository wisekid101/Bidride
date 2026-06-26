import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { api } from '../api/client';

const BRAND_ICONS: Record<string, string> = {
  visa: '💳',
  mastercard: '💳',
  amex: '💳',
  discover: '💳',
};

interface PaymentMethod {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
}

interface ListResponse {
  paymentMethods: PaymentMethod[];
  defaultPaymentMethodId: string | null;
}

export function PaymentMethodsScreen() {
  const navigation = useNavigation<any>();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [addingCard, setAddingCard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ListResponse>('/riders/me/payment-methods');
      setMethods(res.paymentMethods ?? []);
    } catch {
      setError('Could not load payment methods. Try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleSetDefault = async (method: PaymentMethod) => {
    if (method.isDefault) return;
    setActionLoading(method.id);
    try {
      await api.post('/riders/me/payment-methods/default', {
        paymentMethodId: method.id,
      });
      setMethods((prev) =>
        prev.map((m) => ({ ...m, isDefault: m.id === method.id })),
      );
    } catch {
      Alert.alert('Error', 'Could not set default card. Try again.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemove = (method: PaymentMethod) => {
    Alert.alert(
      'Remove Card',
      `Remove the ${method.brand.toUpperCase()} ending in ${method.last4}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(method.id);
            try {
              await api.delete(`/riders/me/payment-methods/${method.id}`);
              setMethods((prev) => prev.filter((m) => m.id !== method.id));
            } catch {
              Alert.alert('Error', 'Could not remove card. Try again.');
            } finally {
              setActionLoading(null);
            }
          },
        },
      ],
    );
  };

  const handleAddCard = async () => {
    setAddingCard(true);
    setError(null);
    try {
      await api.post<{ clientSecret: string; customerId: string }>(
        '/riders/me/payment-methods/setup-intent',
        {},
      );
      Alert.alert(
        'Add Card',
        'Stripe Payment Sheet integration requires @stripe/stripe-react-native. ' +
          'In production, this launches the Stripe PaymentSheet with the setup intent. ' +
          'For beta, please use the Stripe test card 4242 4242 4242 4242.',
        [{ text: 'OK', onPress: () => void load() }],
      );
    } catch {
      setError('Could not initialize card setup. Try again.');
    } finally {
      setAddingCard(false);
    }
  };

  const renderItem = ({ item }: { item: PaymentMethod }) => {
    const isLoading = actionLoading === item.id;
    const brandIcon = BRAND_ICONS[item.brand.toLowerCase()] ?? '💳';
    const expStr = `${String(item.expMonth).padStart(2, '0')}/${String(item.expYear).slice(-2)}`;

    return (
      <View style={[styles.card, item.isDefault && styles.cardDefault]}>
        <View style={styles.cardLeft}>
          <Text style={styles.brandIcon}>{brandIcon}</Text>
          <View>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardBrand}>{item.brand.toUpperCase()}</Text>
              <Text style={styles.cardLast4}> ···· {item.last4}</Text>
              {item.isDefault && (
                <View style={styles.defaultBadge}>
                  <Text style={styles.defaultBadgeText}>Default</Text>
                </View>
              )}
            </View>
            <Text style={styles.cardExp}>Expires {expStr}</Text>
          </View>
        </View>

        <View style={styles.cardActions}>
          {isLoading ? (
            <ActivityIndicator color={Colors.primary} size="small" />
          ) : (
            <>
              {!item.isDefault && (
                <TouchableOpacity
                  onPress={() => handleSetDefault(item)}
                  style={styles.actionBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="checkmark-circle-outline" size={20} color={Colors.primary} />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => handleRemove(item)}
                style={styles.actionBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="trash-outline" size={20} color={Colors.error} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payment Methods</Text>
        <View style={{ width: 24 }} />
      </View>

      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={styles.spinner} />
      ) : (
        <FlatList
          data={methods}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="card-outline" size={48} color={Colors.textSecondary} />
              <Text style={styles.emptyTitle}>No cards saved</Text>
              <Text style={styles.emptySubtitle}>
                Add a card to request rides.
              </Text>
            </View>
          }
        />
      )}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.addButton, addingCard && styles.addButtonDisabled]}
          onPress={handleAddCard}
          disabled={addingCard}
          activeOpacity={0.85}
        >
          {addingCard ? (
            <ActivityIndicator color={Colors.primaryText} />
          ) : (
            <>
              <Ionicons name="add" size={20} color={Colors.primaryText} />
              <Text style={styles.addButtonText}>Add Card</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    paddingTop: Platform.OS === 'ios' ? Spacing.sm : Spacing['2xl'],
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
  errorBar: {
    backgroundColor: Colors.error + '22',
    borderWidth: 1,
    borderColor: Colors.error + '44',
    borderRadius: Radius.md,
    margin: Spacing.base,
    padding: Spacing.sm,
  },
  errorText: { color: Colors.error, fontSize: Typography.size.sm, textAlign: 'center' },
  spinner: { marginTop: 60 },
  list: { padding: Spacing.base, paddingBottom: 120 },
  separator: { height: Spacing.sm },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.base,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardDefault: { borderColor: Colors.primary + '60' },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  brandIcon: { fontSize: 28, marginRight: Spacing.sm },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.xs },
  cardBrand: {
    color: Colors.text,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.bold,
    textTransform: 'capitalize',
  },
  cardLast4: { color: Colors.text, fontSize: Typography.size.base },
  defaultBadge: {
    backgroundColor: Colors.primary + '22',
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.primary + '44',
  },
  defaultBadgeText: { color: Colors.primary, fontSize: Typography.size.xs, fontWeight: Typography.weight.semibold },
  cardExp: { color: Colors.textSecondary, fontSize: Typography.size.sm, marginTop: 2 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  actionBtn: { padding: 4 },
  emptyState: { alignItems: 'center', paddingTop: 80, gap: Spacing.sm },
  emptyTitle: { color: Colors.text, fontSize: Typography.size.lg, fontWeight: Typography.weight.bold },
  emptySubtitle: { color: Colors.textSecondary, fontSize: Typography.size.base, textAlign: 'center' },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: Spacing.base,
    paddingBottom: Platform.OS === 'ios' ? 36 : Spacing.base,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  addButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  addButtonDisabled: { opacity: 0.5 },
  addButtonText: {
    color: Colors.primaryText,
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.bold,
  },
});
