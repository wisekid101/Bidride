import {
  IsNumber,
  IsString,
  IsOptional,
  Min,
  IsLatitude,
  IsLongitude,
} from 'class-validator';

export class SubmitBidDto {
  @IsString()
  pickupAddress: string;

  @IsLatitude()
  pickupLat: number;

  @IsLongitude()
  pickupLng: number;

  @IsString()
  dropoffAddress: string;

  @IsLatitude()
  dropoffLat: number;

  @IsLongitude()
  dropoffLng: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1.00)
  bidAmount: number;

  @IsString()
  paymentMethodId: string;
}

export class CounterBidDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1.00)
  counterAmount: number;
}

export class BidResponseDto {
  @IsString()
  @IsOptional()
  reason?: string;
}

export class BidSummaryDto {
  id: string;
  tripId: string;
  status: string;
  riderOffer: number;
  counterOffer: number | null;
  finalFare: number | null;
  counterRound: number;
  expiresAt: Date;
  createdAt: Date;
}
