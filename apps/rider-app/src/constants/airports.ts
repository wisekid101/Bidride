export interface AirportTerminal {
  id: string;
  name: string;
  description: string;
  lat: number;
  lng: number;
}

export const EWR_TERMINALS: AirportTerminal[] = [
  {
    id: 'EWR-A',
    name: 'Terminal A',
    description: 'Delta · American · Other carriers',
    lat: 40.6897,
    lng: -74.1756,
  },
  {
    id: 'EWR-B',
    name: 'Terminal B',
    description: 'United · International arrivals',
    lat: 40.6913,
    lng: -74.1746,
  },
  {
    id: 'EWR-C',
    name: 'Terminal C',
    description: 'United Express · Regional jets',
    lat: 40.6929,
    lng: -74.1764,
  },
];

const EWR_ADDRESS_PATTERNS = [
  /newark liberty international/i,
  /\bewr\b/i,
  /newark airport/i,
  /newark int['']?l/i,
];

export function detectEwrAddress(address: string): boolean {
  return EWR_ADDRESS_PATTERNS.some((p) => p.test(address));
}
