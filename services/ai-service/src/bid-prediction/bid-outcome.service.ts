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

    // Score the REAL model prediction, not the served value: while shadowed
    // the served probability is the constant 0.5 and the model's actual
    // prediction rides in shadowRecommendation — evaluating the constant
    // would make every shadow outcome meaningless.
    const output = log?.output as { probability?: number; shadowRecommendation?: number } | undefined;
    const predictionProbability = output?.shadowRecommendation ?? output?.probability ?? null;
    const predictionConfidence = log
      ? Number(log.confidence)
      : null;
    const modelVersion = log?.modelVersion ?? null;

    const predictionCorrect =
      predictionProbability !== null
        ? (predictionProbability >= 0.5) === dto.wasAccepted
        : null;

    const driversViewed = dto.bidId
      ? await this.prisma.driverBidExposure.count({ where: { bidId: dto.bidId } }).catch(() => 0)
      : (dto.driversViewed ?? 0);
    const driversDeclined = dto.driversDeclined ?? 0;
    const driversCountered = dto.driversCountered ?? 0;
    const driversIgnored = Math.max(0, driversViewed - driversDeclined - driversCountered - (dto.wasAccepted ? 1 : 0));

    // UPSERT keyed by tripId: bids.service posts a submit-time row and
    // trips.service posts the completion outcome for the SAME trip — a
    // completed bid ride must end as ONE outcome row (its full chain), not
    // two partial ones. Completion/rejection fields overwrite; fields the
    // later call omits keep their submit-time values (undefined = no-op in
    // Prisma update).
    const money = {
      finalAcceptedAmount: dto.finalAcceptedAmount != null ? new Prisma.Decimal(dto.finalAcceptedAmount) : undefined,
      finalFare: dto.finalFare != null ? new Prisma.Decimal(dto.finalFare) : undefined,
      driverEarnings: dto.driverEarnings != null ? new Prisma.Decimal(dto.driverEarnings) : undefined,
      platformFee: dto.platformFee != null ? new Prisma.Decimal(dto.platformFee) : undefined,
    };

    // The read-then-write pair runs inside a SERIALIZABLE transaction so two
    // concurrent posts for the same trip cannot both see "no row" and insert
    // duplicates — Postgres aborts one with a serialization failure (Prisma
    // P2034) and the bounded retry then takes the update path. tripId has no
    // unique constraint, so this is the atomic option that needs no schema
    // change. Still fire-and-forget: outcome auditing never blocks callers.
    void this.upsertOutcomeAtomically(dto, {
      driversViewed,
      driversIgnored,
      driversDeclined,
      driversCountered,
      money,
      predictionProbability,
      predictionConfidence,
      predictionCorrect,
      modelVersion,
    }).catch(() => {});
  }

  private async upsertOutcomeAtomically(
    dto: RecordOutcomeDto,
    computed: {
      driversViewed: number;
      driversIgnored: number;
      driversDeclined: number;
      driversCountered: number;
      money: Record<'finalAcceptedAmount' | 'finalFare' | 'driverEarnings' | 'platformFee', Prisma.Decimal | undefined>;
      predictionProbability: number | null;
      predictionConfidence: number | null;
      predictionCorrect: boolean | null;
      modelVersion: string | null;
    },
  ): Promise<void> {
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await this.prisma.$transaction(
          async (tx) => {
            const existing = await tx.bidOutcome.findFirst({
              where: { tripId: dto.tripId },
              orderBy: { createdAt: 'desc' },
              select: { id: true, wasAccepted: true },
            });

            if (existing) {
              // Acceptance is STICKY: per-driver rejection events fire for
              // every declining driver, and one may land after the completion
              // outcome — a trip that was accepted stays accepted, and its
              // prediction is scored against that final truth.
              const effectiveAccepted = existing.wasAccepted || dto.wasAccepted;
              const effectiveCorrect =
                computed.predictionProbability != null
                  ? computed.predictionProbability >= 0.5 === effectiveAccepted
                  : computed.predictionCorrect;
              await tx.bidOutcome.update({
                where: { id: existing.id },
                data: {
                  bidId: dto.bidId ?? undefined,
                  zoneKey: dto.zoneKey ?? undefined,
                  wasAccepted: effectiveAccepted,
                  timeToAcceptanceMs: dto.timeToAcceptanceMs ?? undefined,
                  driversViewed: computed.driversViewed,
                  driversIgnored: computed.driversIgnored,
                  driversDeclined: computed.driversDeclined,
                  driversCountered: computed.driversCountered,
                  ...computed.money,
                  predictionProbability: computed.predictionProbability != null ? new Prisma.Decimal(computed.predictionProbability) : undefined,
                  predictionConfidence: computed.predictionConfidence != null ? new Prisma.Decimal(computed.predictionConfidence) : undefined,
                  predictionCorrect: effectiveCorrect,
                  modelVersion: computed.modelVersion ?? undefined,
                },
              });
              return;
            }

            await tx.bidOutcome.create({
              data: {
                tripId: dto.tripId,
                bidId: dto.bidId ?? null,
                zoneKey: dto.zoneKey ?? null,
                wasAccepted: dto.wasAccepted,
                timeToAcceptanceMs: dto.timeToAcceptanceMs ?? null,
                driversViewed: computed.driversViewed,
                driversIgnored: computed.driversIgnored,
                driversDeclined: computed.driversDeclined,
                driversCountered: computed.driversCountered,
                finalAcceptedAmount: computed.money.finalAcceptedAmount ?? null,
                finalFare: computed.money.finalFare ?? null,
                driverEarnings: computed.money.driverEarnings ?? null,
                platformFee: computed.money.platformFee ?? null,
                predictionProbability: computed.predictionProbability != null ? new Prisma.Decimal(computed.predictionProbability) : null,
                predictionConfidence: computed.predictionConfidence != null ? new Prisma.Decimal(computed.predictionConfidence) : null,
                predictionCorrect: computed.predictionCorrect,
                modelVersion: computed.modelVersion,
              },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
        return;
      } catch (e: unknown) {
        const serializationConflict =
          e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';
        if (!serializationConflict || attempt === MAX_ATTEMPTS) throw e;
      }
    }
  }
}
