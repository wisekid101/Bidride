import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsString, IsEnum, IsOptional } from 'class-validator';
import { DocumentsService, DocumentType } from './documents.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

class GetUploadUrlDto {
  @IsEnum(['drivers_license', 'insurance', 'registration', 'profile_photo', 'vehicle_photo'])
  documentType: DocumentType;

  @IsString()
  contentType: string;
}

class ReviewDocumentDto {
  @IsEnum(['approved', 'rejected'])
  decision: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  notes?: string;
}

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('upload-url')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  getUploadUrl(
    @Headers('x-user-id') userId: string,
    @Body() dto: GetUploadUrlDto,
  ) {
    return this.documentsService.getUploadUrl(userId, dto.documentType, dto.contentType);
  }

  @Post('confirm')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  confirmUpload(
    @Headers('x-user-id') userId: string,
    @Body('documentType') documentType: DocumentType,
  ) {
    return this.documentsService.confirmUpload(userId, documentType);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  listDocuments(@Headers('x-user-id') userId: string) {
    return this.documentsService.listDocuments(userId);
  }

  // Admin endpoints

  @Get('admin/:driverId/:documentType/view')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getDocumentViewUrl(
    @Param('driverId') driverId: string,
    @Param('documentType') documentType: string,
  ) {
    return this.documentsService.getDocumentViewUrl(driverId, documentType);
  }

  @Post('admin/:driverId/:documentType/review')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @HttpCode(HttpStatus.OK)
  reviewDocument(
    @Param('driverId') driverId: string,
    @Param('documentType') documentType: string,
    @Body() dto: ReviewDocumentDto,
    @Headers('x-user-id') adminId: string,
  ) {
    return this.documentsService.reviewDocument(driverId, documentType, dto.decision, adminId, dto.notes);
  }
}
