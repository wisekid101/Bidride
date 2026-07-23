jest.mock('@bidride/database', () => ({ PrismaClient: jest.fn().mockImplementation(() => mockPrisma) }));
// documents.service instantiates an S3Client at construction — stub the SDK.
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({})),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

const mockPrisma = {
  driver: { findUnique: jest.fn(), update: jest.fn() },
  document: { findUnique: jest.fn(), findMany: jest.fn() },
} as any;

import { DocumentsService } from './documents.service';

describe('DocumentsService.confirmUpload — Batch 1 cursor transition', () => {
  let service: DocumentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.driver.update.mockResolvedValue({});
    mockPrisma.document.findUnique.mockResolvedValue({ id: 'doc-1' });
    service = new DocumentsService();
  });

  it('advances document_upload → bank_account when all required docs are submitted', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({ id: 'd1', onboardingStep: 'document_upload' });
    mockPrisma.document.findMany.mockResolvedValue([
      { documentType: 'drivers_license' },
      { documentType: 'insurance' },
      { documentType: 'registration' },
    ]);

    await service.confirmUpload('u1', 'drivers_license');

    expect(mockPrisma.driver.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { onboardingStep: 'bank_account', status: 'under_review' },
    });
  });

  it('does NOT advance the cursor when a required doc is still missing', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({ id: 'd1', onboardingStep: 'document_upload' });
    mockPrisma.document.findMany.mockResolvedValue([{ documentType: 'drivers_license' }]);

    const res = await service.confirmUpload('u1', 'drivers_license');

    expect(res.allRequiredSubmitted).toBe(false);
    expect(mockPrisma.driver.update).not.toHaveBeenCalled();
  });

  it('never advances to the obsolete background_check cursor', async () => {
    mockPrisma.driver.findUnique.mockResolvedValue({ id: 'd1', onboardingStep: 'document_upload' });
    mockPrisma.document.findMany.mockResolvedValue([
      { documentType: 'drivers_license' },
      { documentType: 'insurance' },
      { documentType: 'registration' },
    ]);

    await service.confirmUpload('u1', 'drivers_license');

    const wroteBackground = mockPrisma.driver.update.mock.calls.find(
      ([arg]: [any]) => arg?.data?.onboardingStep === 'background_check',
    );
    expect(wroteBackground).toBeUndefined();
  });
});
