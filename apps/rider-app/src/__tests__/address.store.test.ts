import { useAddressStore } from '../store/address.store';
import type { ResolvedAddress } from '../api/geocoding';

const addr = (n: number): ResolvedAddress => ({
  placeId: `place-${n}`,
  formattedAddress: `${n} Market St, Newark, NJ`,
  lat: 40.7 + n * 0.001,
  lng: -74.1 - n * 0.001,
});

beforeEach(() => {
  useAddressStore.setState({
    recentAddresses: [],
    homeAddress: null,
    workAddress: null,
  });
});

describe('useAddressStore — recent addresses', () => {
  it('adds an address to recents', () => {
    useAddressStore.getState().addRecent(addr(1));
    expect(useAddressStore.getState().recentAddresses).toHaveLength(1);
    expect(useAddressStore.getState().recentAddresses[0].placeId).toBe('place-1');
  });

  it('prepends newest address to front of list', () => {
    useAddressStore.getState().addRecent(addr(1));
    useAddressStore.getState().addRecent(addr(2));
    expect(useAddressStore.getState().recentAddresses[0].placeId).toBe('place-2');
    expect(useAddressStore.getState().recentAddresses[1].placeId).toBe('place-1');
  });

  it('deduplicates by placeId — moves existing address to front', () => {
    useAddressStore.getState().addRecent(addr(1));
    useAddressStore.getState().addRecent(addr(2));
    useAddressStore.getState().addRecent(addr(1));
    const recents = useAddressStore.getState().recentAddresses;
    expect(recents).toHaveLength(2);
    expect(recents[0].placeId).toBe('place-1');
  });

  it('caps recents at 5 entries', () => {
    for (let i = 1; i <= 7; i++) useAddressStore.getState().addRecent(addr(i));
    expect(useAddressStore.getState().recentAddresses).toHaveLength(5);
  });

  it('most recent is always first after cap', () => {
    for (let i = 1; i <= 7; i++) useAddressStore.getState().addRecent(addr(i));
    expect(useAddressStore.getState().recentAddresses[0].placeId).toBe('place-7');
  });

  it('clearRecent empties the list', () => {
    useAddressStore.getState().addRecent(addr(1));
    useAddressStore.getState().clearRecent();
    expect(useAddressStore.getState().recentAddresses).toHaveLength(0);
  });
});

describe('useAddressStore — home address', () => {
  it('sets home address with label', () => {
    useAddressStore.getState().setHome(addr(1));
    const home = useAddressStore.getState().homeAddress;
    expect(home?.placeId).toBe('place-1');
    expect(home?.label).toBe('Home');
  });

  it('replaces previous home address', () => {
    useAddressStore.getState().setHome(addr(1));
    useAddressStore.getState().setHome(addr(2));
    expect(useAddressStore.getState().homeAddress?.placeId).toBe('place-2');
  });

  it('clearHome removes home address', () => {
    useAddressStore.getState().setHome(addr(1));
    useAddressStore.getState().clearHome();
    expect(useAddressStore.getState().homeAddress).toBeNull();
  });
});

describe('useAddressStore — work address', () => {
  it('sets work address with label', () => {
    useAddressStore.getState().setWork(addr(1));
    const work = useAddressStore.getState().workAddress;
    expect(work?.placeId).toBe('place-1');
    expect(work?.label).toBe('Work');
  });

  it('clearWork removes work address', () => {
    useAddressStore.getState().setWork(addr(1));
    useAddressStore.getState().clearWork();
    expect(useAddressStore.getState().workAddress).toBeNull();
  });
});
