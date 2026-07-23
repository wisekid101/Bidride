import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@bidride/database';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

export type DocumentType = 'drivers_license' | 'insurance' | 'registration' | 'profile_photo' | 'vehicle_photo';

@Injectable()
export class DocumentsService {
  private prisma = new PrismaClient();
  private s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
  private bucket = process.env.DOCUMENTS_BUCKET ?? 'bidride-driver-documents';

  async getUploadUrl(userId: string, documentType: DocumentType, contentType: string) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException('Driver not found');

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(contentType)) {
      throw new BadRequestException('Only JPEG, PNG, WEBP, or PDF files are accepted');
    }

    const key = `drivers/${driver.id}/${documentType}/${randomUUID()}`;

    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ServerSideEncryption: 'aws:kms',
    });

    const uploadUrl = await getSignedUrl(this.s3, cmd, { expiresIn: 300 });

    // Create or update document record
    await this.prisma.document.upsert({
      where: { driverId_documentType: { driverId: driver.id, documentType } },
      create: { driverId: driver.id, documentType, s3Key: key, status: 'pending' },
      update: { s3Key: key, status: 'pending', reviewedAt: null, reviewedByAdminId: null },
    });

    return { uploadUrl, key, expiresIn: 300 };
  }

  async confirmUpload(userId: string, documentType: DocumentType) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException('Driver not found');

    const doc = await this.prisma.document.findUnique({
      where: { driverId_documentType: { driverId: driver.id, documentType } },
    });
    if (!doc) throw new NotFoundException('Document record not found');

    // Check all required docs for this step
    const requiredDocs: DocumentType[] = ['drivers_license', 'insurance', 'registration'];
    const submitted = await this.prisma.document.findMany({
      where: { driverId: driver.id, documentType: { in: requiredDocs }, status: { not: 'rejected' } },
    });

    const allSubmitted = requiredDocs.every((t) => submitted.some((d) => d.documentType === t));
    if (allSubmitted && driver.onboardingStep === 'document_upload') {
      await this.prisma.driver.update({
        where: { id: driver.id },
        data: { onboardingStep: 'bank_account', status: 'under_review' },
      });
    }

    return { success: true, allRequiredSubmitted: allSubmitted };
  }

  async listDocuments(userId: string) {
    const driver = await this.prisma.driver.findUnique({ where: { userId } });
    if (!driver) throw new NotFoundException('Driver not found');

    const docs = await this.prisma.document.findMany({ where: { driverId: driver.id } });
    return docs.map((d) => ({
      documentType: d.documentType,
      status: d.status,
      uploadedAt: d.createdAt,
      reviewedAt: d.reviewedAt,
    }));
  }

  async getDocumentViewUrl(driverId: string, documentType: string) {
    const doc = await this.prisma.document.findUnique({
      where: { driverId_documentType: { driverId, documentType } },
    });
    if (!doc) throw new NotFoundException('Document not found');

    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: doc.s3Key });
    const url = await getSignedUrl(this.s3, cmd, { expiresIn: 600 });
    return { url, expiresIn: 600 };
  }

  async reviewDocument(
    driverId: string,
    documentType: string,
    decision: 'approved' | 'rejected',
    adminId: string,
    notes?: string,
  ) {
    await this.prisma.document.update({
      where: { driverId_documentType: { driverId, documentType } },
      data: {
        status: decision,
        reviewedAt: new Date(),
        reviewedByAdminId: adminId,
        reviewNotes: notes,
      },
    });

    // If any doc is rejected, flag driver as action_required
    if (decision === 'rejected') {
      await this.prisma.driver.update({
        where: { id: driverId },
        data: { status: 'action_required' },
      });
    }

    return { success: true };
  }
}
