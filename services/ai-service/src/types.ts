export interface AiResponseEnvelope<T> {
  data: T;
  modelVersion: string;
  latencyMs: number;
  fallbackUsed: boolean;
  confidence: number;
  inferenceId: string;
}

export interface ModelHealthMetrics {
  modelName: string;
  activeVersion: string;
  lastInferenceAt: Date | null;
  lastDeployedAt: Date | null;
  p50LatencyMs: number;
  p95LatencyMs: number;
  errorRatePercent: number;
  fallbackRatePercent: number;
  totalInferences: number;
}

// Model names — single source of truth
export const MODEL_NAMES = {
  FARE_ADJUSTMENT: 'fare-adjustment',
  FRAUD_SCORE: 'fraud-score',
  BID_WIN_PROBABILITY: 'bid-win-probability',
  SURGE_FORECAST: 'surge-forecast',
  DRIVER_EARNINGS: 'driver-earnings',
} as const;

export type ModelName = typeof MODEL_NAMES[keyof typeof MODEL_NAMES];
