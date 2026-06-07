export const requestForegroundPermissionsAsync = jest.fn(async () => ({ status: 'granted' }));
export const requestBackgroundPermissionsAsync = jest.fn(async () => ({ status: 'granted' }));
export const getCurrentPositionAsync = jest.fn(async () => ({
  coords: { latitude: 40.6895, longitude: -74.1745, accuracy: 5 },
}));
export const watchPositionAsync = jest.fn(() => ({ remove: jest.fn() }));
export const Accuracy = { Balanced: 3, High: 4 };
