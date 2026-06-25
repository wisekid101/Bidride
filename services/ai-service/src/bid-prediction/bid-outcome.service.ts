import { Injectable } from '@nestjs/common';
import { Prisma } from '@bidride/database/generated/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordOutcomeDto {
  tripId: string;
  bidId?: string;
  zoneKey?: string;
  wasAccepted: boolean;
  timeToAcceptanceMs?: number;
  driversViewed?: number;
  driversIgnored?: number;
  driversDeclined?: number;
  driversCountered?: number;
  finalAcceptedAmount?: number;
  finalFare?: number;
  driverEarnings?: number;
  platformFee?: number;
}

@Injectable()
export class BidOutcomeService {
  constructor(private readonly prisma: PrismaService) {}

  async recordOutcome(dto: RecordOutcomeDto): Promise<void> {
    // Find the most recent bid-win-probability inference for this trip to link prediction
    const log = await this.prisma.aiInferenceLog.findFirst({
      where: { tripId: dto.tripId, modelName: 'bid-win-probability' },
      orderBy: { createdAt: 'desc' },
    }).catch(() => null);

    const predictionProbability = log
      ? (log.output as { probability?: number })?.probability ?? null
      : null;
    const predictionConfidence = log
      ? Number(log.confidence)
      : null;
    const modelVersion = log?.modelVersion ?? null;

    const predictionCorrect =
      predictionProbability !== null
        ? (predictionProbability >= 0.5) === dto.wasAccepted
        : null;

    void this.prisma.bidOutcome.create({
      data: {
        tripId: dto.tripId,
        bidId: dto.bidId ?? null,
        zoneKey: dto.zoneKey ?? null,
        wasAccepted: dto.wasAccepted,
        timeToAcceptanceMs: dto.timeToAcceptanceMs ?? null,
        driversViewed: dto.driversViewed ?? 0,
        driversIgnored: dto.driversIgnored ?? 0,
        driversDeclined: dto.driversDeclined ?? 0,
        driversCountered: dto.driversCountered ?? 0,
        finalAcceptedAmount: dto.finalAcceptedAmount != null
          ? new Prisma.Decimal(dto.finalAcceptedAmount)
          : null,
        finalFare: dto.finalFare != null
          ? new Prisma.Decimal(dto.finalFare)
          : null,
        driverEarnings: dto.driverEarnings != null
          ? new Prisma.Decimal(dto.driverEarnings)
          : null,
        platformFee: dto.platformFee != null
          ? new Prisma.Decimal(dto.platformFee)
          : null,
        predictionProbability: predictionProbability != null
          ? new Prisma.Decimal(predictionProbability)
          : null,
        predictionConfidence: predictionConfidence != null
          ? new Prisma.Decimal(predictionConfidence)
          : null,
        predictionCorrect,
        modelVersion,
      },
    }).catch(() => {});
  }
}
