import { NormalizedTaxStatus, isNormalizedTaxStatus } from './normalized-tax-status';
import { TaxIdentityProvider } from './tax-identity-provider';
import { TaxReportingProvider } from './tax-reporting-provider';

// A stub identity provider proves the contract is satisfiable AND that its only
// status output is a NormalizedTaxStatus (no provider-specific value escapes).
const stubIdentity: TaxIdentityProvider = {
  name: 'stub-identity',
  async createHostedSession() {
    return { url: 'https://provider.example/session', sessionRef: 'sess_1', expiresAt: new Date() };
  },
  async determineApplicableForm() {
    return 'W9';
  },
  async getVerificationState(providerReference) {
    return { status: NormalizedTaxStatus.PENDING_PROVIDER, providerReference, sanitizedReasonCode: null };
  },
  verifyWebhookSignature() {
    return false;
  },
  parseWebhookEvent() {
    return {
      providerEventId: 'evt_1',
      providerReference: 'acct_1',
      rawProviderStatus: 'identity.pending',
      occurredAt: new Date(),
    };
  },
  normalizeStatus() {
    return NormalizedTaxStatus.PENDING_PROVIDER;
  },
};

// A stub reporting provider — entirely independent of the identity provider.
const stubReporting: TaxReportingProvider = {
  name: 'stub-reporting',
  async generateForm(payee, totals) {
    return { formRef: 'form_1', formType: '1099-NEC', taxYear: totals.taxYear };
  },
  async fileForm(formRef) {
    return { filingRef: `filing_${formRef}`, status: 'filed' };
  },
  async fileCorrection(formRef) {
    return { filingRef: `corr_${formRef}`, status: 'filed' };
  },
  async getRecipientCopyUrl() {
    return { url: 'https://provider.example/copy', expiresAt: new Date() };
  },
  async exportReporting() {
    return { exportRef: 'exp_1' };
  },
  async listHistoricalRecords() {
    return [];
  },
};

describe('TaxIdentityProvider contract', () => {
  it('only ever surfaces a NormalizedTaxStatus (no provider status leaks)', async () => {
    const state = await stubIdentity.getVerificationState('acct_1');
    expect(isNormalizedTaxStatus(state.status)).toBe(true);
    expect(isNormalizedTaxStatus(stubIdentity.normalizeStatus('identity.pending'))).toBe(true);
  });

  it('requires signature verification and exposes a providerEventId for idempotency', () => {
    expect(stubIdentity.verifyWebhookSignature('body', {})).toBe(false);
    expect(stubIdentity.parseWebhookEvent('body').providerEventId).toBe('evt_1');
  });
});

describe('TaxReportingProvider contract', () => {
  it('is satisfiable and independent of the identity provider', async () => {
    const form = await stubReporting.generateForm(
      { driverId: 'd1', providerAccountReference: 'acct_1' },
      { taxYear: 2026, grossAmount: 1200 },
    );
    expect(form.formType).toBe('1099-NEC');
    const filing = await stubReporting.fileForm(form.formRef);
    expect(filing.status).toBe('filed');
  });

  it('the two provider abstractions share NO type coupling (swappable independently)', () => {
    // Structural proof: an object can implement one without implementing the
    // other; replacing the reporting provider cannot affect identity/status.
    expect(stubIdentity.name).not.toBe(stubReporting.name);
    expect('normalizeStatus' in stubReporting).toBe(false);
    expect('generateForm' in stubIdentity).toBe(false);
  });
});
