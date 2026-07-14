import { Platform, UIManager } from 'react-native';
import { PROVIDER_GOOGLE, PROVIDER_DEFAULT } from 'react-native-maps';

// Expo Go's iOS client ships react-native-maps without the Google Maps
// native module (AIRGoogleMap), so forcing PROVIDER_GOOGLE there redboxes
// and renders a blank map. Use Google only where the native view exists
// (Android always; iOS dev-client/production builds).
export const MAP_PROVIDER =
  Platform.OS === 'android' || UIManager.hasViewManagerConfig?.('AIRGoogleMap')
    ? PROVIDER_GOOGLE
    : PROVIDER_DEFAULT;

// Heatmap needs its own native view (also absent from Expo Go's iOS client).
export const MAP_SUPPORTS_HEATMAP =
  Platform.OS === 'android' || UIManager.hasViewManagerConfig?.('AIRMapHeatmap') === true;
