import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Modal,
  SafeAreaView,
  Platform,
} from 'react-native';
import { Colors, Typography, Spacing, Radius } from '../constants/theme';
import { geocodingApi, PlaceSuggestion, ResolvedAddress } from '../api/geocoding';

interface RecentItem {
  placeId: string;
  formattedAddress: string;
  lat: number;
  lng: number;
}

interface Props {
  placeholder: string;
  dotColor?: string;
  onAddressResolved: (address: ResolvedAddress) => void;
  initialValue?: string;
  sessionToken?: string;
  recentAddresses?: RecentItem[];
  showRecents?: boolean;
  triggerTestID?: string;
}

type SuggestionItem =
  | { kind: 'recent'; address: RecentItem }
  | { kind: 'api'; suggestion: PlaceSuggestion };

export function AddressAutocomplete({
  placeholder,
  dotColor = Colors.primary,
  onAddressResolved,
  initialValue = '',
  sessionToken,
  recentAddresses = [],
  showRecents = true,
  triggerTestID,
}: Props) {
  const [displayValue, setDisplayValue] = useState(initialValue);
  const [resolved, setResolved] = useState(!!initialValue);
  const [modalVisible, setModalVisible] = useState(false);
  const [modalInput, setModalInput] = useState('');
  const [apiSuggestions, setApiSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync display value when parent resolves pickup from GPS
  useEffect(() => {
    if (initialValue) {
      setDisplayValue(initialValue);
      setResolved(true);
    }
  }, [initialValue]);

  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (query.trim().length < 2) { setApiSuggestions([]); return; }
      setLoading(true);
      try {
        const results = await geocodingApi.autocomplete(query, sessionToken);
        setApiSuggestions(results);
      } catch {
        setApiSuggestions([]);
      } finally {
        setLoading(false);
      }
    },
    [sessionToken],
  );

  const handleModalTextChange = (text: string) => {
    setModalInput(text);
    setApiSuggestions([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length >= 2) {
      debounceRef.current = setTimeout(() => fetchSuggestions(text), 350);
    }
  };

  const handleSelectApi = async (suggestion: PlaceSuggestion) => {
    setLoading(true);
    try {
      const coords = await geocodingApi.getPlaceCoordinates(suggestion.placeId);
      const addr: ResolvedAddress = {
        placeId: suggestion.placeId,
        formattedAddress: coords.formattedAddress,
        lat: coords.lat,
        lng: coords.lng,
      };
      setDisplayValue(coords.formattedAddress);
      setResolved(true);
      onAddressResolved(addr);
      closeModal();
    } catch {
      // keep modal open so user can retry
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRecent = (item: RecentItem) => {
    setDisplayValue(item.formattedAddress);
    setResolved(true);
    onAddressResolved(item);
    closeModal();
  };

  const openModal = () => {
    setModalInput('');
    setApiSuggestions([]);
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setApiSuggestions([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };

  const showRecentList =
    showRecents && modalInput.trim().length === 0 && recentAddresses.length > 0;
  const showApiList = apiSuggestions.length > 0;

  const listItems: SuggestionItem[] = showRecentList
    ? recentAddresses.map((a) => ({ kind: 'recent' as const, address: a }))
    : showApiList
    ? apiSuggestions.map((s) => ({ kind: 'api' as const, suggestion: s }))
    : [];

  const renderItem = ({ item, index }: { item: SuggestionItem; index: number }) => {
    if (item.kind === 'recent') {
      return (
        <TouchableOpacity
          style={styles.suggestion}
          onPress={() => handleSelectRecent(item.address)}
          activeOpacity={0.75}
          testID={`dest-recent-${index}`}
          accessibilityLabel={item.address.formattedAddress}
        >
          <Text style={styles.recentIcon}>🕐</Text>
          <Text style={styles.suggestionMain} numberOfLines={1}>
            {item.address.formattedAddress}
          </Text>
        </TouchableOpacity>
      );
    }
    return (
      <TouchableOpacity
        style={styles.suggestion}
        onPress={() => handleSelectApi(item.suggestion)}
        activeOpacity={0.75}
        testID={`dest-suggestion-${index}`}
        accessibilityLabel={`${item.suggestion.mainText} ${item.suggestion.secondaryText}`}
      >
        <View style={styles.apiSuggestionText}>
          <Text style={styles.suggestionMain} numberOfLines={1}>
            {item.suggestion.mainText}
          </Text>
          <Text style={styles.suggestionSecondary} numberOfLines={1}>
            {item.suggestion.secondaryText}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.wrapper}>
      {/* Trigger row — shows current address, opens search modal on tap */}
      <TouchableOpacity
        style={[styles.inputRow, resolved && styles.inputRowResolved]}
        onPress={openModal}
        activeOpacity={0.7}
        testID={triggerTestID}
      >
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text
          style={[styles.inputText, !displayValue && styles.placeholderText]}
          numberOfLines={1}
        >
          {displayValue || placeholder}
        </Text>
        {resolved && <View style={styles.resolvedDot} />}
      </TouchableOpacity>

      {/* Full-screen address search modal — keyboard never covers input here */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        onRequestClose={closeModal}
      >
        <SafeAreaView style={styles.modal}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={[styles.modalDot, { backgroundColor: dotColor }]} />
            <TextInput
              style={styles.modalInput}
              placeholder={placeholder}
              placeholderTextColor={Colors.textSecondary}
              value={modalInput}
              onChangeText={handleModalTextChange}
              autoFocus
              autoCorrect={false}
              autoComplete="off"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {loading
              ? <ActivityIndicator size="small" color={Colors.primary} style={styles.spinner} />
              : null}
            <TouchableOpacity onPress={closeModal} style={styles.cancelBtn} activeOpacity={0.7}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          {/* Section label */}
          {showRecentList && listItems.length > 0 && (
            <Text style={styles.sectionLabel}>RECENT</Text>
          )}
          {showApiList && listItems.length > 0 && (
            <Text style={styles.sectionLabel}>SUGGESTIONS</Text>
          )}

          <FlatList
            data={listItems}
            keyExtractor={(item, i) =>
              item.kind === 'recent'
                ? `r-${item.address.placeId}-${i}`
                : `a-${item.suggestion.placeId}`
            }
            keyboardShouldPersistTaps="handled"
            renderItem={renderItem}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: Spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    height: 48,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputRowResolved: {
    borderColor: Colors.primary + '40',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: Spacing.sm,
    flexShrink: 0,
  },
  inputText: {
    flex: 1,
    color: Colors.text,
    fontSize: Typography.size.base,
  },
  placeholderText: {
    color: Colors.textSecondary,
  },
  resolvedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
    marginLeft: Spacing.sm,
  },

  // Modal styles
  modal: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Platform.OS === 'ios' ? Spacing.sm : Spacing.md,
    gap: Spacing.sm,
  },
  modalDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  modalInput: {
    flex: 1,
    color: Colors.text,
    fontSize: Typography.size.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    height: 44,
  },
  spinner: {
    marginHorizontal: Spacing.xs,
  },
  cancelBtn: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  cancelText: {
    color: Colors.primary,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
  },
  sectionLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    letterSpacing: 0.8,
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: 14,
  },
  separator: {
    height: 1,
    backgroundColor: Colors.border,
    marginHorizontal: Spacing.base,
  },
  recentIcon: {
    fontSize: 14,
    marginRight: Spacing.sm,
    width: 20,
    textAlign: 'center',
  },
  apiSuggestionText: {
    flex: 1,
  },
  suggestionMain: {
    color: Colors.text,
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
  },
  suggestionSecondary: {
    color: Colors.textSecondary,
    fontSize: Typography.size.sm,
    marginTop: 2,
  },
});
