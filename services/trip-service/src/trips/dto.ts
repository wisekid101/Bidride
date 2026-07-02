import { IsBoolean, IsEnum, IsNumber, IsString, IsOptional, Min, Max } from 'class-validator';
import { RideType } from '@bidride/database/generated/client';

export class CreateTripDto {
  @IsString()
  pickupAddress: string;

  @IsNumber() @Min(-90) @Max(90)
  pickupLat: number;

  @IsNumber() @Min(-180) @Max(180)
  pickupLng: number;

  @IsString()
  dropoffAddress: string;

  @IsNumber() @Min(-90) @Max(90)
  dropoffLat: number;

  @IsNumber() @Min(-180) @Max(180)
  dropoffLng: number;

  @IsEnum(RideType)
  @IsOptional()
  rideType?: RideType;

  @IsString()
  @IsOptional()
  paymentMethodId?: string;
}

export class EndTripDto {
  @IsNumber()
  currentLat: number;

  @IsNumber()
  currentLng: number;
}

export class RateTripDto {
  @IsNumber() @Min(1) @Max(5)
  rating: number;

  @IsString()
  @IsOptional()
  comment?: string;
}

export class RateRiderDto {
  @IsNumber() @Min(1) @Max(5)
  rating: number;

  @IsString()
  @IsOptional()
  comment?: string;

  @IsBoolean()
  @IsOptional()
  flagRider?: boolean;
}

export class CancelTripDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
