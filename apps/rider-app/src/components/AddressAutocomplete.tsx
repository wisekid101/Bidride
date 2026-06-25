import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
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
}: Props) {
  const [inputValue, setInputValue] = useState(initialValue);
  const [apiSuggestions, setApiSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState(!!initialValue);
  const [isFocused, setIsFocused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchApiSuggestions = useCallback(
    async (query: string) => {
      if (query.trim().length < 2) {
        setApiSuggestions([]);
        return;
      }
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

  const handleTextChange = (text: string) => {
    setInputValue(text);
    setResolved(false);
    setApiSuggestions([]);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length >= 2) {
      debounceRef.current = setTimeout(() => fetchApiSuggestions(text), 350);
    }
  };

  const handleSelectApi = async (suggestion: PlaceSuggestion) => {
    setInputValue(suggestion.description);
    setApiSuggestions([]);
    setLoading(true);

    try {
      const coords = await geocodingApi.getPlaceCoordinates(suggestion.placeId);
      setResolved(true);
      onAddressResolved({
        placeId: suggestion.placeId,
        formattedAddress: coords.formattedAddress,
        lat: coords.lat,
        lng: coords.lng,
      });
    } catch {
      // Keep the text but don't mark resolved
    } finally {
      setLoading(false);
    }
  };

  const handleSelectRecent = (item: RecentItem) => {
    setInputValue(item.formattedAddress);
    setApiSuggestions([]);
    setResolved(true);
    onAddressResolved(item);
  };

  const handleFocus = () => {
    if (blurDelayRef.current) clearTimeout(blurDelayRef.current);
    setIsFocused(true);
  };

  const handleBlur = () => {
    blurDelayRef.current = setTimeout(() => {
      setIsFocused(false);
      setApiSuggestions([]);
    }, 200);
  };

  const showRecentList =
    showRecents &&
    isFocused &&
    inputValue.trim().length === 0 &&
    !resolved &&
    recentAddresses.length > 0;

  const showApiList = apiSuggestions.length > 0 && !resolved;

  const listItems: SuggestionItem[] = showRecentList
    ? recentAddresses.map((a) => ({ kind: 'recent' as const, address: a }))
    : showApiList
    ? apiSuggestions.map((s) => ({ kind: 'api' as const, suggestion: s }))
    : [];

  const renderItem = ({ item, index }: { item: SuggestionItem; index: number }) => {
    const isFirst = index === 0;

    if (item.kind === 'recent') {
      return (
        <TouchableOpacity
          style={[styles.suggestion, !isFirst && styles.suggestionBorder]}
          onPress={() => handleSelectRecent(item.address)}
          activeOpacity={0.75}
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
        style={[styles.suggestion, !isFirst && styles.suggestionBorder]}
        onPress={() => handleSelectApi(item.suggestion)}
        activeOpacity={0.75}
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
      <View style={[styles.inputRow, isFocused && styles.inputRowFocused]}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={Colors.textSecondary}
          value={inputValue}
          onChangeText={handleTextChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="search"
        />
        {loading && (
          <ActivityIndicator size="small" color={Colors.primary} style={styles.spinner} />
        )}
        {resolved && !loading && <View style={styles.resolvedDot} />}
      </View>

      {listItems.length > 0 && (
        <View style={styles.dropdown}>
          {showRecentList && (
            <Text style={styles.dropdownLabel}>Recent</Text>
          )}
          <FlatList
            data={listItems}
            keyExtractor={(item, i) =>
              item.kind === 'recent'
                ? `r-${item.address.placeId}-${i}`
                : `a-${item.suggestion.placeId}`
            }
            keyboardShouldPersistTaps="handled"
            scrollEnabled={false}
            renderItem={renderItem}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    zIndex: 10,
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
  inputRowFocused: {
    borderColor: Colors.border,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: Spacing.sm,
  },
  input: {
    flex: 1,
    color: Colors.text,
    fontSize: Typography.size.base,
  },
  spinner: {
    marginLeft: Spacing.sm,
  },
  resolvedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.success,
    marginLeft: Spacing.sm,
  },
  dropdown: {
    position: 'absolute',
    top: 52,
    left: 0,
    right: 0,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    zIndex: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  dropdownLabel: {
    color: Colors.textSecondary,
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.semibold,
    letterSpacing: 0.8,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: 4,
    textTransform: 'uppercase',
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 11,
  },
  suggestionBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  recentIcon: {
    fontSize: 14,
    marginRight: Spacing.sm,
    width: 18,
    textAlign: 'center',
  },
  apiSuggestionText: {
    flex: 1,
  },
  suggestionMain: {
    color: Colors.text,
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.medium,
    flex: 1,
  },
  suggestionSecondary: {
    color: Colors.textSecondary,
    fontSize: Typography.size.xs,
    marginTop: 2,
  },
});
