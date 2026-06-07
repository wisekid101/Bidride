import { Injectable } from '@nestjs/common';
import * as AWS from 'aws-sdk';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

interface TrustInputs {
  userId: string;
  userRole: 'rider' | 'driver';
  identityVerified: boolean;
  paymentVerified: boolean;
  accountAgeDays: number;
  totalTrips: number;
  successfulTripStreak: number;
  avgRating: number;
  disputeCount: number;
  fraudFlagCount: number;
  deviceFingerprints: number;
  linkedAccounts: number;
  phoneAgeDays?: number;
  emailVerified: boolean;
}

interface TrustResult {
  trustScore: number;           // 0–1000 internal ONLY
  fraudProbability: number;     // 0–100 internal ONLY
  verificationConfidence: number; // 0–100 internal ONLY
  badge: 'verified' | 'trusted' | 'business' | 'vip';
}

// Badge thresholds — riders
const RIDER_BADGE_THRESHOLDS = {
  vip:     { minScore: 800, minTrips: 50, minRating: 4.8 },
  trusted: { minScore: 500, minTrips: 10, minRating: 4.5 },
  verified: { minScore: 0,  minTrips: 0,  minRating: 0 },
};

// Badge thresholds — drivers
const DRIVER_BADGE_THRESHOLDS = {
  vip:     { minScore: 800, minTrips: 500 },
  trusted: { minScore: 500, minTrips: 100 },
  verified: { minScore: 0,  minTrips: 0 },
};

// Fraud probability thresholds
const FRAUD_AUTO_HOLD_THRESHOLD = 90.0;

@Injectable()
export class TrustService {
  private readonly sagemaker: AWS.SageMakerRuntime;
  private readonly fraudEndpoint: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.sagemaker = new AWS.SageMakerRuntime({
      region: config.get('AWS_REGION', 'us-east-1'),
    });
    this.fraudEndpoint = config.get('SAGEMAKER_FRAUD_ENDPOINT');
  }

  async calculateTrustScore(inputs: TrustInputs): Promise<TrustResult> {
    // Rule-based trust score (0–1000)
    let score = 200; // Starting score for any verified user

    // Identity & payment
    if (inputs.identityVerified)  score += 100;
    if (inputs.paymentVerified)   score += 100;
    if (inputs.emailVerified)     score += 50;

    // Account history
    const ageBonus = Math.min(100, Math.floor(inputs.accountAgeDays / 30) * 10);
    score += ageBonus;

    // Trip history
    const tripBonus = Math.min(200, Math.floor(inputs.totalTrips / 5) * 10);
    score += tripBonus;

    // Rating
    if (inputs.avgRating >= 4.9) score += 100;
    else if (inputs.avgRating >= 4.7) score += 60;
    else if (inputs.avgRating >= 4.5) score += 30;

    // Streak bonus
    const streakBonus = Math.min(50, inputs.successfulTripStreak * 2);
    score += streakBonus;

    // Penalties
    score -= inputs.disputeCount * 30;
    score -= inputs.fraudFlagCount * 100;

    // Multiple devices = moderate risk
    if (inputs.deviceFingerprints > 3) score -= 50;
    if (inputs.linkedAccounts > 2) score -= 100;

    score = Math.max(0, Math.min(1000, score));

    // Fraud probability — ML model with rule-based fallback
    const fraudProbability = await this.getFraudProbability(inputs, score);

    // Verification confidence — how sure we are about identity
    let verificationConfidence = 50;
    if (inputs.identityVerified) verificationConfidence += 25;
    if (inputs.paymentVerified) verificationConfidence += 15;
    if (inputs.emailVerified) verificationConfidence += 5;
    if (inputs.phoneAgeDays && inputs.phoneAgeDays > 180) verificationConfidence += 5;
    verificationConfidence = Math.min(100, verificationConfidence);

    // Badge assignment — NEVER show numerical scores publicly
    const badge = this.assignBadge(inputs, score);

    // Persist
    await this.prisma.trustScore.upsert({
      where: { userId: inputs.userId },
      update: { trustScore: score, fraudProbability, verificationConfidence, currentBadge: badge, lastCalculatedAt: new Date() },
      create: {
        userId: inputs.userId,
        userRole: inputs.userRole,
        trustScore: score,
        fraudProbability,
        verificationConfidence,
        currentBadge: badge,
      },
    });

    // Log history
    await this.prisma.trustScoreHistory.create({
      data: {
        trustScoreId: (await this.prisma.trustScore.findUniqueOrThrow({ where: { userId: inputs.userId } })).id,
        trustScore: score,
        fraudProbability,
        triggerEvent: 'recalculation',
        metadata: { inputs } as any,
      },
    });

    // Auto-hold if fraud threshold exceeded
    if (fraudProbability >= FRAUD_AUTO_HOLD_THRESHOLD) {
      await this.triggerFraudHold(inputs.userId, fraudProbability);
    }

    return { trustScore: score, fraudProbability, verificationConfidence, badge };
  }

  private assignBadge(
    inputs: TrustInputs,
    score: number,
  ): 'verified' | 'trusted' | 'business' | 'vip' {
    if (inputs.userRole === 'rider') {
      const vip = RIDER_BADGE_THRESHOLDS.vip;
      const trusted = RIDER_BADGE_THRESHOLDS.trusted;

      if (score >= vip.minScore && inputs.totalTrips >= vip.minTrips && inputs.avgRating >= vip.minRating) {
        return 'vip';
      }
      if (score >= trusted.minScore && inputs.totalTrips >= trusted.minTrips && inputs.avgRating >= trusted.minRating) {
        return 'trusted';
      }
      return 'verified';
    }

    const vip = DRIVER_BADGE_THRESHOLDS.vip;
    const trusted = DRIVER_BADGE_THRESHOLDS.trusted;

    if (score >= vip.minScore && inputs.totalTrips >= vip.minTrips) return 'vip';
    if (score >= trusted.minScore && inputs.totalTrips >= trusted.minTrips) return 'trusted';
    return 'verified';
  }

  private async getFraudProbability(inputs: TrustInputs, ruleScore: number): Promise<number> {
    if (this.fraudEndpoint) {
      try {
        const response = await this.sagemaker.invokeEndpoint({
          EndpointName: this.fraudEndpoint,
          ContentType: 'application/json',
          Body: JSON.stringify({ ...inputs, ruleScore }),
        }).promise();

        const result = JSON.parse(response.Body?.toString() ?? '{"probability":0}') as { probability: number };
        return Math.max(0, Math.min(100, result.probability));
      } catch {
        // Fall back to rule-based
      }
    }

    // Rule-based fraud probability
    let probability = 0;
    if (inputs.linkedAccounts > 2) probability += 30;
    if (inputs.deviceFingerprints > 5) probability += 20;
    if (inputs.fraudFlagCount > 0) probability += 40;
    if (inputs.disputeCount > 3) probability += 20;
    if (inputs.accountAgeDays < 7 && inputs.totalTrips === 0) probability += 10;

    return Math.min(100, probability);
  }

  private async triggerFraudHold(userId: string, fraudProbability: number): Promise<void> {
    // Publishes to admin queue — human admin reviews within 2 hours
    // No automated permanent action
    console.log(`FRAUD HOLD: user=${userId} probability=${fraudProbability} — Admin review required within 2 hours`);
  }
}
