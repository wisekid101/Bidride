import { IsEnum, IsString, IsEmail, Length, Matches } from 'class-validator';
import { UserRole } from '@bidride/database/generated/client';

export class SendOtpDto {
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'phone must be in E.164 format' })
  phone: string;

  @IsEnum(UserRole)
  role: UserRole;
}

export class VerifyOtpDto {
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'phone must be in E.164 format' })
  phone: string;

  @IsString()
  @Length(6, 6)
  code: string;

  @IsEnum(UserRole)
  role: UserRole;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken: string;
}

export class SetupMfaDto {
  @IsEmail()
  email: string;
}

export class VerifyMfaDto {
  @IsString()
  @Length(6, 6)
  token: string;
}
