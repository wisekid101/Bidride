const store: Record<string, string> = {};

export const setItemAsync = jest.fn(async (key: string, value: string) => {
  store[key] = value;
});

export const getItemAsync = jest.fn(async (key: string) => {
  return store[key] ?? null;
});

export const deleteItemAsync = jest.fn(async (key: string) => {
  delete store[key];
});

export const __resetStore = () => {
  Object.keys(store).forEach((k) => delete store[k]);
};
