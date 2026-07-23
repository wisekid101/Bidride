// Self-contained unit tests for the force-update gate. NO react-native / expo
// imports — the module under test keeps its expo dependency behind a lazy
// require, so this suite runs in a plain context.
import {
  parseVersion,
  compareVersions,
  isUpdateRequired,
} from '../appVersionGate';

describe('parseVersion', () => {
  it('parses full x.y.z', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('fills missing segments with 0', () => {
    expect(parseVersion('1')).toEqual({ major: 1, minor: 0, patch: 0 });
    expect(parseVersion('1.2')).toEqual({ major: 1, minor: 2, patch: 0 });
  });

  it('parses multi-digit segments', () => {
    expect(parseVersion('1.10.0')).toEqual({ major: 1, minor: 10, patch: 0 });
    expect(parseVersion('12.34.567')).toEqual({ major: 12, minor: 34, patch: 567 });
  });

  it('tolerates a leading v and surrounding whitespace', () => {
    expect(parseVersion('v2.0.1')).toEqual({ major: 2, minor: 0, patch: 1 });
    expect(parseVersion('  1.4.0  ')).toEqual({ major: 1, minor: 4, patch: 0 });
  });

  it('strips pre-release / build metadata', () => {
    expect(parseVersion('1.2.3-beta.1')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseVersion('1.2.3+build.99')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('returns null for malformed input', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('abc')).toBeNull();
    expect(parseVersion('1.x.0')).toBeNull();
    expect(parseVersion('1..0')).toBeNull();
    expect(parseVersion('1.2.3.4')).toBeNull();
    expect(parseVersion('-1.0.0')).toBeNull();
    expect(parseVersion('1.2.-3')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parseVersion(undefined)).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion(123 as unknown)).toBeNull();
    expect(parseVersion({} as unknown)).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders lower / equal / higher', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1);
  });

  it('compares segments numerically, not lexically', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
  });

  it('treats missing segments as 0', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1', '1.0.1')).toBe(-1);
  });

  it('returns null when either side is unparseable', () => {
    expect(compareVersions('bad', '1.0.0')).toBeNull();
    expect(compareVersions('1.0.0', 'bad')).toBeNull();
    expect(compareVersions(undefined, '1.0.0')).toBeNull();
  });
});

describe('isUpdateRequired', () => {
  it('blocks when current is genuinely lower', () => {
    expect(isUpdateRequired('1.0.0', '1.0.1')).toBe(true);
    expect(isUpdateRequired('1.9.0', '1.10.0')).toBe(true);
    expect(isUpdateRequired('1.2', '1.2.1')).toBe(true);
  });

  it('does not block when equal or higher', () => {
    expect(isUpdateRequired('1.0.0', '1.0.0')).toBe(false);
    expect(isUpdateRequired('2.0.0', '1.9.9')).toBe(false);
    expect(isUpdateRequired('1.10.0', '1.9.0')).toBe(false);
  });

  it('fails open (does not block) on malformed or missing input', () => {
    expect(isUpdateRequired('bad', '1.0.0')).toBe(false);
    expect(isUpdateRequired('1.0.0', 'bad')).toBe(false);
    expect(isUpdateRequired('', '1.0.0')).toBe(false);
    expect(isUpdateRequired(undefined, '1.0.0')).toBe(false);
    expect(isUpdateRequired('1.0.0', undefined)).toBe(false);
    expect(isUpdateRequired(null, null)).toBe(false);
  });
});
