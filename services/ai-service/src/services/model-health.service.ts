import { Injectable } from '@nestjs/common';
import { ModelHealthMetrics } from '../types';

interface InternalMetrics {
  totalInferences: number;
  errors: number;
  fallbacks: number;
  latencySamples: number[];
  lastInferenceAt: Date | null;
  lastDeployedAt: Date | null;
  activeVersion: string;
}

const MAX_LATENCY_SAMPLES = 100;

@Injectable()
export class ModelHealthService {
  private readonly metrics = new Map<string, InternalMetrics>();

  record(modelName: string, latencyMs: number, fallbackUsed: boolean, hasError = false): void {
    const m = this.getOrInit(modelName);
    m.totalInferences++;
    if (hasError) m.errors++;
    if (fallbackUsed) m.fallbacks++;

    m.latencySamples.push(latencyMs);
    if (m.latencySamples.length > MAX_LATENCY_SAMPLES) {
      m.latencySamples.shift();
    }
    m.lastInferenceAt = new Date();
  }

  setVersion(modelName: string, version: string): void {
    const m = this.getOrInit(modelName);
    m.activeVersion = version;
    m.lastDeployedAt = new Date();
  }

  getHealth(): Record<string, ModelHealthMetrics> {
    const result: Record<string, ModelHealthMetrics> = {};
    for (const [modelName, m] of this.metrics.entries()) {
      const sorted = [...m.latencySamples].sort((a, b) => a - b);
      result[modelName] = {
        modelName,
        activeVersion: m.activeVersion,
        lastInferenceAt: m.lastInferenceAt,
        lastDeployedAt: m.lastDeployedAt,
        p50LatencyMs: this.percentile(sorted, 50),
        p95LatencyMs: this.percentile(sorted, 95),
        errorRatePercent: m.totalInferences > 0
          ? Math.round((m.errors / m.totalInferences) * 10000) / 100
          : 0,
        fallbackRatePercent: m.totalInferences > 0
          ? Math.round((m.fallbacks / m.totalInferences) * 10000) / 100
          : 0,
        totalInferences: m.totalInferences,
      };
    }
    return result;
  }

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  private getOrInit(modelName: string): InternalMetrics {
    if (!this.metrics.has(modelName)) {
      this.metrics.set(modelName, {
        totalInferences: 0,
        errors: 0,
        fallbacks: 0,
        latencySamples: [],
        lastInferenceAt: null,
        lastDeployedAt: null,
        activeVersion: 'v1',
      });
    }
    return this.metrics.get(modelName)!;
  }
}
