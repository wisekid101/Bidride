// SB2A Batch 2 (Zero Tolerance) — minimum-app-version force-update gate.
//
// Pure semver helpers with NO react-native / expo imports at module load, so
// this file can be unit-tested in a plain Node/jsdom context. Reading the
// running app's version (which DOES touch expo) is isolated behind a lazy
// require in `getCurrentAppVersion()`.

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

// Parses an `x`, `x.y`, or `x.y.z` string into numeric segments. Missing
// trailing segments default to 0 (so "1.2" == "1.2.0"). A leading "v" and any
// pre-release / build metadata (after "-" or "+") are ignored. Returns null for
// anything that isn't a run of 1–3 dot-separated non-negative integers.
export function parseVersion(input: unknown): ParsedVersion | null {
  if (typeof input !== 'string') return null;

  const cleaned = input.trim().replace(/^v/i, '');
  if (cleaned === '') return null;

  // Drop pre-release / build metadata: "1.2.3-beta.1", "1.2.3+build" -> "1.2.3".
  const core = cleaned.split(/[-+]/)[0];
  const parts = core.split('.');
  if (parts.length < 1 || parts.length > 3) return null;

  const nums: number[] = [];
  for (const part of parts) {
    // Reject empty ("1..0"), non-digit ("1.x.0"), signs, decimals, whitespace.
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }

  return { major: nums[0] ?? 0, minor: nums[1] ?? 0, patch: nums[2] ?? 0 };
}

// Numeric comparison: -1 if a < b, 0 if equal, 1 if a > b.
function compareParsed(a: ParsedVersion, b: ParsedVersion): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

// Compares two version strings. Returns -1/0/1, or null if EITHER is
// unparseable (so callers can decide how to treat malformed input).
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  return compareParsed(pa, pb);
}

// True when the running app is genuinely OLDER than the required minimum and
// must be updated before proceeding. Fails OPEN: if either version is missing
// or malformed we return false (never block a user on a parse error). Only a
// confidently-lower current version blocks.
export function isUpdateRequired(currentVersion: unknown, minVersion: unknown): boolean {
  const cmp = compareVersions(currentVersion, minVersion);
  if (cmp === null) return false;
  return cmp < 0;
}

// Reads the running app's version from expo-constants. Lazy-required and fully
// guarded so (a) this module imports cleanly in unit tests and (b) a missing /
// malformed value degrades to null rather than throwing. A null here means the
// gate can't evaluate and — per fail-open — will not block.
export function getCurrentAppVersion(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require('expo-constants').default;
    const version: unknown =
      Constants?.expoConfig?.version ?? Constants?.manifest?.version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}
