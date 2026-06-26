import {
  getCorrelationId,
  getTraceId,
  withCorrelation,
  extractFromHeaders,
  generateCorrelationId,
} from '../correlation';

describe('correlation', () => {
  describe('generateCorrelationId', () => {
    it('generates a UUID v4 string', () => {
      const id = generateCorrelationId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateCorrelationId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('withCorrelation / getCorrelationId', () => {
    it('returns undefined outside any context', () => {
      expect(getCorrelationId()).toBeUndefined();
    });

    it('provides correlationId inside withCorrelation', () => {
      withCorrelation('test-id-1', () => {
        expect(getCorrelationId()).toBe('test-id-1');
      });
    });

    it('isolates contexts between concurrent calls', async () => {
      const results: string[] = [];
      await Promise.all([
        new Promise<void>((resolve) =>
          withCorrelation('id-A', () => {
            setTimeout(() => {
              results.push(getCorrelationId() ?? 'none');
              resolve();
            }, 0);
          }),
        ),
        new Promise<void>((resolve) =>
          withCorrelation('id-B', () => {
            setTimeout(() => {
              results.push(getCorrelationId() ?? 'none');
              resolve();
            }, 0);
          }),
        ),
      ]);
      expect(results).toContain('id-A');
      expect(results).toContain('id-B');
    });

    it('restores undefined after context exits', () => {
      withCorrelation('temp-id', () => {});
      expect(getCorrelationId()).toBeUndefined();
    });

    it('uses correlationId as traceId by default', () => {
      withCorrelation('trace-xyz', () => {
        expect(getTraceId()).toBe('trace-xyz');
      });
    });

    it('uses custom traceId when provided', () => {
      withCorrelation('corr-123', () => {
        expect(getTraceId()).toBe('trace-456');
      }, 'trace-456');
    });
  });

  describe('extractFromHeaders', () => {
    it('extracts x-correlation-id header', () => {
      const id = extractFromHeaders({ 'x-correlation-id': 'my-corr-id' });
      expect(id).toBe('my-corr-id');
    });

    it('falls back to x-request-id', () => {
      const id = extractFromHeaders({ 'x-request-id': 'req-123' });
      expect(id).toBe('req-123');
    });

    it('falls back to x-trace-id', () => {
      const id = extractFromHeaders({ 'x-trace-id': 'trace-abc' });
      expect(id).toBe('trace-abc');
    });

    it('generates a new ID when no header present', () => {
      const id = extractFromHeaders({});
      expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('handles array header values', () => {
      const id = extractFromHeaders({ 'x-correlation-id': ['first', 'second'] });
      expect(id).toBe('first');
    });

    it('prefers x-correlation-id over x-request-id', () => {
      const id = extractFromHeaders({
        'x-correlation-id': 'preferred',
        'x-request-id': 'fallback',
      });
      expect(id).toBe('preferred');
    });
  });
});
