import { Injectable } from '@nestjs/common';
import { InferenceLogService } from '../services/inference-log.service';
import { RANKING_VERSION } from './driver-ranking.engine';

export interface DispatchCandidate {
  driverUserId: string;
  score: number;             // 0–100 ranking score
  acceptanceRate?: number;   // 0–1
  avgResponseTimeMs?: number;
}

export type DispatchStrategy = 'top-k' | 'broadcast-all' | 'phased';

export interface DispatchPhase {
  phase: number;
  driverUserIds: string[];
  delayMs: number;
  reason: string;
}

export interface DispatchSimulation {
  strategy: DispatchStrategy;
  selectedDriverUserIds: string[];
  phases: DispatchPhase[];
  simulatedAcceptanceProbability: number;
  simulatedEtaMinutes: number;
  reasoning: string;
  modelVersion: string;
}

const DEFAULT_RESPONSE_MS = 25000;
const DEFAULT_ACCEPTANCE = 0.65;

@Injectable()
export class DispatchSimulatorService {
  constructor(private readonly inferenceLog: InferenceLogService) {}

  simulate(
    tripId: string,
    candidates: DispatchCandidate[],
  ): DispatchSimulation {
    if (candidates.length === 0) {
      return this.broadcastAll(tripId, candidates);
    }

    const topK = Math.min(3, candidates.length);
    const all = candidates.length;

    const topKSim = this.evalStrategy(candidates.slice(0, topK));
    const allSim = this.evalStrategy(candidates);

    // Phased: top-3 immediately, rest after 15s if no acceptance
    const phasedP = 1 - (1 - topKSim.pAccept) * (1 - this.evalStrategy(candidates.slice(topK)).pAccept);
    const phasedEtaMs = topKSim.etaMs + (phasedP > topKSim.pAccept ? 0 : 15000);

    // Choose best strategy
    let chosen: DispatchStrategy;
    let sim: { pAccept: number; etaMs: number };

    if (all <= 3) {
      // Broadcast all when few candidates
      chosen = 'broadcast-all';
      sim = allSim;
    } else if (topKSim.pAccept >= 0.85) {
      // High confidence top-k is sufficient
      chosen = 'top-k';
      sim = topKSim;
    } else if (phasedEtaMs < allSim.etaMs * 0.9) {
      // Phased is significantly faster
      chosen = 'phased';
      sim = { pAccept: phasedP, etaMs: phasedEtaMs };
    } else {
      chosen = 'broadcast-all';
      sim = allSim;
    }

    const result = this.buildSimulation(tripId, chosen, candidates, sim.pAccept, sim.etaMs);

    // Fire-and-forget log
    this.inferenceLog.log({
      modelName: 'dispatch-simulator',
      modelVersion: RANKING_VERSION,
      inputFeatures: { tripId, candidateCount: candidates.length, topKSim, allSim },
      output: { strategy: result.strategy, pAccept: result.simulatedAcceptanceProbability } as Record<string, unknown>,
      confidence: 0.75,
      fallbackUsed: false,
      latencyMs: 0,
      tripId,
    });

    return result;
  }

  private evalStrategy(candidates: DispatchCandidate[]): { pAccept: number; etaMs: number } {
    if (candidates.length === 0) return { pAccept: 0, etaMs: Infinity };

    // P(at least one accepts) = 1 - prod(1 - p_i)
    const pNone = candidates.reduce(
      (acc, c) => acc * (1 - (c.acceptanceRate ?? DEFAULT_ACCEPTANCE)),
      1,
    );
    const pAccept = 1 - pNone;

    // Expected ETA ≈ avg response time / P(accept) — faster acceptance with more drivers
    const avgResp = candidates.reduce(
      (s, c) => s + (c.avgResponseTimeMs ?? DEFAULT_RESPONSE_MS),
      0,
    ) / candidates.length;
    const etaMs = avgResp / Math.max(pAccept, 0.1);

    return { pAccept, etaMs };
  }

  private buildSimulation(
    tripId: string,
    strategy: DispatchStrategy,
    candidates: DispatchCandidate[],
    pAccept: number,
    etaMs: number,
  ): DispatchSimulation {
    const all = candidates.map((c) => c.driverUserId);
    const topK = all.slice(0, 3);

    let phases: DispatchPhase[];
    let selected: string[];
    let reasoning: string;

    switch (strategy) {
      case 'top-k':
        phases = [{ phase: 1, driverUserIds: topK, delayMs: 0, reason: 'Top-ranked drivers only — high acceptance probability' }];
        selected = topK;
        reasoning = `Top ${topK.length} drivers have ${(pAccept * 100).toFixed(0)}% combined acceptance probability`;
        break;
      case 'phased':
        phases = [
          { phase: 1, driverUserIds: topK, delayMs: 0, reason: 'Top-ranked drivers first' },
          { phase: 2, driverUserIds: all.slice(3), delayMs: 15000, reason: 'Expand if no acceptance in 15s' },
        ];
        selected = all;
        reasoning = `Phased dispatch: top ${topK.length} first, expand after 15s`;
        break;
      default:
        phases = [{ phase: 1, driverUserIds: all, delayMs: 0, reason: 'Broadcast to all matched drivers' }];
        selected = all;
        reasoning = `Broadcast to all ${all.length} drivers for fastest acceptance`;
    }

    return {
      strategy,
      selectedDriverUserIds: selected,
      phases,
      simulatedAcceptanceProbability: Math.round(pAccept * 1000) / 1000,
      simulatedEtaMinutes: Math.round(etaMs / 60000 * 10) / 10,
      reasoning,
      modelVersion: RANKING_VERSION,
    };
  }

  private broadcastAll(tripId: string, candidates: DispatchCandidate[]): DispatchSimulation {
    return this.buildSimulation(tripId, 'broadcast-all', candidates, 0, 0);
  }
}
