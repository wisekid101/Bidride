import {
  CANONICAL_FINANCIAL_SOURCES,
  CONSTITUTION_TAGS,
  INSUFFICIENT_EVIDENCE,
  MIN_SAMPLE_SIZE,
  UniversalRecommendation,
  isFinancialRecommendation,
} from './recommendation.types';

// ─── Black-box rejection (Intelligence Layer, governance-mandated) ───────────
// A recommendation that cannot show its work does not enter the ledger.
// Returns [] when valid; otherwise every violated rule, so a producer can fix
// all problems at once rather than round-tripping.

const REQUIRED_TEXT_FIELDS: Array<keyof UniversalRecommendation> = [
  'domain', 'family', 'recommendationType', 'title', 'summary',
  'expectedOutcome', 'why', 'whyNot', 'rollback',
  'businessImpact', 'userImpact', 'safetyImpact', 'revenueImpact', 'trustImpact',
  'sourceVersion',
];

export function validateRecommendation(rec: UniversalRecommendation): string[] {
  const errors: string[] = [];

  for (const field of REQUIRED_TEXT_FIELDS) {
    const v = rec[field];
    if (typeof v !== 'string' || v.trim().length === 0) {
      errors.push(`${String(field)} is required and must be a non-empty string`);
    }
  }

  if (!rec.recommendation || typeof rec.recommendation.action !== 'string' || !rec.recommendation.action.trim()) {
    errors.push('recommendation.action is required');
  }

  // Confidence must be bounded.
  if (typeof rec.confidence !== 'number' || !Number.isFinite(rec.confidence) || rec.confidence < 0 || rec.confidence > 1) {
    errors.push('confidence must be a finite number in [0, 1]');
  }

  // Sample size must be present.
  if (!Number.isInteger(rec.sampleSize) || rec.sampleSize < 0) {
    errors.push('sampleSize must be a non-negative integer');
  }

  // At least one evidence item, each naming its source.
  if (!Array.isArray(rec.evidence) || rec.evidence.length === 0) {
    errors.push('at least one evidence item is required — black-box recommendations are rejected');
  } else {
    rec.evidence.forEach((e, i) => {
      if (!e?.source?.trim()) errors.push(`evidence[${i}].source is required`);
      if (!e?.metric?.trim()) errors.push(`evidence[${i}].metric is required`);
      if (!e?.asOf?.trim()) errors.push(`evidence[${i}].asOf is required`);
    });
  }

  if (!Array.isArray(rec.reasoning) || rec.reasoning.filter((r) => r?.trim()).length === 0) {
    errors.push('reasoning must contain at least one non-empty step');
  }

  if (!Array.isArray(rec.alternatives)) {
    errors.push('alternatives[] is required (may be empty only with insufficientEvidence)');
  }

  // At least one constitution tag, all from the fixed vocabulary.
  if (!Array.isArray(rec.constitutionTags) || rec.constitutionTags.length === 0) {
    errors.push('at least one constitution tag is required');
  } else {
    for (const tag of rec.constitutionTags) {
      if (!(CONSTITUTION_TAGS as readonly string[]).includes(tag)) {
        errors.push(`unknown constitution tag: ${tag}`);
      }
    }
  }

  // Safety is not an AI surface: the impact must be declared, and must be none.
  if (typeof rec.safetyImpact === 'string' && rec.safetyImpact.trim().length > 0) {
    if (!/^none\b/i.test(rec.safetyImpact.trim())) {
      errors.push('safetyImpact must be "none…" — recommendations with safety impact are rejected; safety is deterministic platform code');
    }
  }

  // Financial recommendations must name their canonical money source —
  // exactly, or followed by a qualifier ("payments (canonical)"), so
  // near-miss names like "payments_ai_projection" cannot satisfy the check.
  if (isFinancialRecommendation(rec)) {
    const src = rec.canonicalFinancialSource ?? '';
    const valid = (CANONICAL_FINANCIAL_SOURCES as readonly string[]).some(
      (s) => src === s || src.startsWith(`${s} `) || src.startsWith(`${s}(`) || src.startsWith(`${s} +`),
    );
    if (!valid) {
      errors.push(
        `financial recommendations must set canonicalFinancialSource to one of: ${CANONICAL_FINANCIAL_SOURCES.join(', ')}`,
      );
    }
  }

  // Reasoning must reference the evidence it claims to rest on: at least one
  // reasoning step must mention an evidence metric, an evidence value, or the
  // stated sample size.
  if (Array.isArray(rec.reasoning) && rec.reasoning.length > 0 && Array.isArray(rec.evidence) && rec.evidence.length > 0) {
    const reasoningText = rec.reasoning.join(' ').toLowerCase();
    const referenced =
      reasoningText.includes(`n=${rec.sampleSize}`) ||
      rec.evidence.some((e) => {
        const metricWords = (e?.metric ?? '').replace(/_/g, ' ').toLowerCase();
        return (
          (metricWords && reasoningText.includes(metricWords)) ||
          (e?.value !== null && e?.value !== undefined && reasoningText.includes(String(e.value).toLowerCase()))
        );
      });
    if (!referenced) {
      errors.push('reasoning must reference at least one evidence item (metric, value, or n=sampleSize)');
    }
  }

  // Insufficient evidence must be declared honestly, and claims must match.
  if (Number.isInteger(rec.sampleSize) && rec.sampleSize < MIN_SAMPLE_SIZE) {
    if (rec.insufficientEvidence !== true || rec.expectedValue !== INSUFFICIENT_EVIDENCE) {
      errors.push(
        `sampleSize ${rec.sampleSize} < ${MIN_SAMPLE_SIZE}: insufficientEvidence must be true and expectedValue must be "${INSUFFICIENT_EVIDENCE}"`,
      );
    }
  }
  if (rec.expectedValue !== INSUFFICIENT_EVIDENCE) {
    const ev = rec.expectedValue;
    if (!ev || typeof ev !== 'object' || !ev.metric?.trim() || !ev.delta?.trim() || !ev.horizon?.trim()) {
      errors.push(`expectedValue must be {metric, delta, horizon} or "${INSUFFICIENT_EVIDENCE}"`);
    }
  }

  // No secrets, raw coordinates, or obvious PII anywhere in the document —
  // scanned over the FLATTENED payload so nothing hides in summary, reasoning,
  // canonicalRefs, or detail fields.
  const flat = JSON.stringify(rec);
  if (/sk_live|sk_test_[A-Za-z0-9]{10,}|BEGIN [A-Z]+ PRIVATE KEY|AKIA[0-9A-Z]{16}/.test(flat)) {
    errors.push('recommendation payload contains what looks like a secret — rejected');
  }
  if (/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/.test(flat)) {
    errors.push('recommendation payload contains what looks like raw coordinates — zone keys are the finest allowed location granularity');
  }
  if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(flat) || /\+1\d{10}|\(\d{3}\)\s?\d{3}-\d{4}/.test(flat)) {
    errors.push('recommendation payload contains what looks like an email or phone number — aggregates only, no PII');
  }
  // Evidence values must be primitives — objects break rendering and can
  // smuggle structure past text screens.
  for (const [i, e] of (rec.evidence ?? []).entries()) {
    if (e?.value !== null && e?.value !== undefined && !['string', 'number', 'boolean'].includes(typeof e.value)) {
      errors.push(`evidence[${i}].value must be a string, number, boolean, or null`);
    }
  }

  return errors;
}
