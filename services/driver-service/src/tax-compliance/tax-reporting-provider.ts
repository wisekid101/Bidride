// SB2A Phase 4A — TaxReportingProvider contract (interface only; no adapter).
//
// A downstream, year-end concern (1099 generation/filing/corrections/copies/
// exports/history). It reads BidiRide's persisted tax records + payment totals
// and NEVER writes compliance status or feeds the Compliance Engine. Kept in a
// separate file/contract from TaxIdentityProvider so the reporting vendor can be
// replaced (e.g. Stripe -> Track1099 / Tax1099) without touching identity,
// normalization, the engine, or activation.
//
// Contract only. No Stripe, no external calls, no secrets.

export type ReportingFormType = '1099-NEC' | '1099-K' | 'OTHER';

export interface ReportingPayee {
  driverId: string;
  providerAccountReference: string; // opaque
}

export interface ReportingTotals {
  taxYear: number;
  grossAmount: number;
}

export interface GeneratedTaxForm {
  formRef: string;
  formType: ReportingFormType;
  taxYear: number;
}

export interface FilingResult {
  filingRef: string;
  status: string;
}

export interface TaxReportingProvider {
  readonly name: string; // 'stripe' | 'track1099' | 'tax1099' | ...
  generateForm(payee: ReportingPayee, totals: ReportingTotals): Promise<GeneratedTaxForm>;
  fileForm(formRef: string): Promise<FilingResult>;
  fileCorrection(formRef: string, correction: Record<string, unknown>): Promise<FilingResult>;
  getRecipientCopyUrl(formRef: string): Promise<{ url: string; expiresAt: Date }>;
  exportReporting(taxYear: number, filter?: Record<string, unknown>): Promise<{ exportRef: string }>;
  listHistoricalRecords(payee: ReportingPayee): Promise<GeneratedTaxForm[]>;
}
