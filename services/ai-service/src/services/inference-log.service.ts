import { Injectable } from '@nestjs/common';
import { Prisma } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';

interface InferenceLogEntry {
  modelName: string;
  modelVersion: string;
  inputFeatures: Record<string, unknown>;
  output: Record<string, unknown>;
  confidence: number;
  fallbackUsed: boolean;
  latencyMs: number;
  tripId?: string | null;
  userId?: string | null;
}

@Injectable()
export class InferenceLogService {
  constructor(private readonly prisma: PrismaService) {}

  // Fire-and-forget — never blocks inference response, never throws
  log(entry: InferenceLogEntry): void {
    void this.prisma.aiInferenceLog.create({
      data: {
        modelName: entry.modelName,
        modelVersion: entry.modelVersion,
        inputFeatures: entry.inputFeatures as Prisma.InputJsonValue,
        output: entry.output as Prisma.InputJsonValue,
        confidence: entry.confidence,
        fallbackUsed: entry.fallbackUsed,
        latencyMs: entry.latencyMs,
        tripId: entry.tripId ?? null,
        userId: entry.userId ?? null,
      },
    }).catch(() => {});
  }
}
