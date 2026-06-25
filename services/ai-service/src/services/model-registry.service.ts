import { Injectable } from '@nestjs/common';
import * as AWS from 'aws-sdk';

interface ModelEntry {
  version: string;
  endpointName?: string;
  deployedAt?: Date;
}

interface ModelRecord {
  champion: ModelEntry;
  challenger?: ModelEntry;
  shadow?: ModelEntry;
  experimental?: ModelEntry;
}

// Registry — versions and endpoint env var mappings per model type.
// No endpoint deployed yet (Sprint 3 is platform only); SageMaker calls are gated
// by endpointEnv being present in process.env.
const REGISTRY_CONFIG: Record<string, { championVersion: string; endpointEnv?: string }> = {
  'fare-adjustment':    { championVersion: 'v1', endpointEnv: 'SAGEMAKER_FARE_ENDPOINT' },
  'fraud-score':        { championVersion: 'v1', endpointEnv: 'SAGEMAKER_FRAUD_ENDPOINT' },
  'bid-win-probability':{ championVersion: 'v1' },
  'surge-forecast':     { championVersion: 'v1' },
  'driver-earnings':    { championVersion: 'v1' },
};

@Injectable()
export class ModelRegistryService {
  private readonly sagemaker: AWS.SageMakerRuntime;
  private readonly registry = new Map<string, ModelRecord>();

  constructor() {
    this.sagemaker = new AWS.SageMakerRuntime({
      region: process.env.AWS_REGION ?? 'us-east-1',
    });

    for (const [name, cfg] of Object.entries(REGISTRY_CONFIG)) {
      this.registry.set(name, {
        champion: {
          version: cfg.championVersion,
          endpointName: cfg.endpointEnv ? process.env[cfg.endpointEnv] : undefined,
        },
      });
    }
  }

  getChampion(modelName: string): ModelEntry {
    const record = this.registry.get(modelName);
    if (!record) throw new Error(`Unknown model: ${modelName}`);
    return record.champion;
  }

  listModels(): Record<string, { champion: ModelEntry; challenger?: ModelEntry; shadow?: ModelEntry; experimental?: ModelEntry }> {
    const result: Record<string, ModelRecord> = {};
    for (const [name, record] of this.registry.entries()) {
      result[name] = record;
    }
    return result;
  }

  // Promote a version to challenger (for future use when models are trained)
  promoteChallenger(modelName: string, version: string, endpointName?: string): void {
    const record = this.registry.get(modelName);
    if (!record) throw new Error(`Unknown model: ${modelName}`);
    record.challenger = { version, endpointName, deployedAt: new Date() };
  }

  async invoke(modelName: string, features: object): Promise<{
    output: Record<string, unknown>;
    modelVersion: string;
    confidence: number;
  }> {
    const champion = this.getChampion(modelName);
    if (!champion.endpointName) {
      throw new Error(`No endpoint configured for ${modelName} — fallback required`);
    }

    const response = await this.sagemaker.invokeEndpoint({
      EndpointName: champion.endpointName,
      ContentType: 'application/json',
      Body: JSON.stringify(features),
    }).promise();

    const parsed = JSON.parse(response.Body?.toString() ?? '{}') as Record<string, unknown>;
    return {
      output: parsed,
      modelVersion: champion.version,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85,
    };
  }
}
