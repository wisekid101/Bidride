import {
  IsString,
  IsDateString,
  IsEnum,
  IsOptional,
  IsBoolean,
  Length,
  Matches,
} from 'class-validator';

// Canonical onboarding cursor values (SB2A Batch 1). Order:
// personal_info -> vehicle_info -> document_upload -> bank_account ->
// background_check -> complete. `vehicle_inspection` and `review` are retired.
export enum OnboardingStep {
  PERSONAL_INFO = 'personal_info',
  VEHICLE_INFO = 'vehicle_info',
  DOCUMENT_UPLOAD = 'document_upload',
  BANK_ACCOUNT = 'bank_account',
  BACKGROUND_CHECK = 'background_check',
  COMPLETE = 'complete',
}

export class UpdateOnboardingStepDto {
  @IsEnum(OnboardingStep)
  step: OnboardingStep;
}

export class SubmitPersonalInfoDto {
  @IsString()
  @Length(1, 100)
  legalFirstName: string;

  @IsString()
  @Length(1, 100)
  legalLastName: string;

  @IsDateString()
  dateOfBirth: string;

  @IsString()
  @Matches(/^\d{9}$/, { message: 'SSN must be exactly 9 digits (no dashes)' })
  ssn: string;

  @IsString()
  @Length(1, 200)
  streetAddress: string;

  @IsString()
  city: string;

  @IsString()
  @Length(2, 2)
  state: string;

  @IsString()
  @Matches(/^\d{5}(-\d{4})?$/)
  zipCode: string;

  @IsString()
  @Matches(/^[A-Za-z0-9]{5,20}$/, { message: 'License number must be 5-20 letters/digits' })
  licenseNumber: string;

  @IsString()
  @Length(2, 2)
  licenseState: string;

  @IsDateString()
  licenseExpiry: string;

  @IsString()
  @Length(1, 100)
  insuranceProvider: string;

  @IsString()
  @Length(1, 100)
  insurancePolicyNumber: string;

  @IsDateString()
  insuranceExpiry: string;
}

export class RequestBackgroundCheckDto {
  @IsBoolean()
  fcraConsentGiven: boolean;
}

export class UpdateAvailabilityDto {
  @IsBoolean()
  isAvailable: boolean;

  @IsOptional()
  @IsString()
  currentLat?: string;

  @IsOptional()
  @IsString()
  currentLng?: string;
}

export class ApproveDriverDto {
  @IsString()
  @IsOptional()
  notes?: string;
}

export class DeclineDriverDto {
  @IsString()
  reason: string;

  @IsBoolean()
  sendAdverseActionLetter: boolean;
}

export class SuspendDriverDto {
  @IsString()
  reason: string;
}
