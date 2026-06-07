import {
  IsString,
  IsDateString,
  IsEnum,
  IsOptional,
  IsBoolean,
  Length,
  Matches,
} from 'class-validator';

export enum OnboardingStep {
  PERSONAL_INFO = 'personal_info',
  DOCUMENT_UPLOAD = 'document_upload',
  BACKGROUND_CHECK = 'background_check',
  VEHICLE_INFO = 'vehicle_info',
  VEHICLE_INSPECTION = 'vehicle_inspection',
  BANK_ACCOUNT = 'bank_account',
  REVIEW = 'review',
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
  @Matches(/^\d{9}$/, { message: 'SSN last 4 must be 9 digits' })
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
