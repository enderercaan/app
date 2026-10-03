import * as SecureStore from 'expo-secure-store';

export const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  }),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key)
};
