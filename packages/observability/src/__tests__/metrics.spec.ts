import { MetricsRegistry } from '../metrics';

describe('MetricsRegistry', () => {
  let reg: MetricsRegistry;

  beforeEach(() => { reg = new MetricsRegistry(); });

  describe('Counter', () => {
    it('starts at 0', () => {
      const c = reg.counter('test_total', 'Test counter');
      expect(c.get()).toBe(0);
    });

    it('increments by 1 by default', () => {
      const c = reg.counter('test_total', 'Test counter');
      c.inc();
      c.inc();
      expect(c.get()).toBe(2);
    });

    it('increments by custom value', () => {
      const c = reg.counter('test_total', 'Test');
      c.inc({}, 5);
      expect(c.get()).toBe(5);
    });

    it('tracks separate label combinations', () => {
      const c = reg.counter('requests_total', 'Requests');
      c.inc({ method: 'GET', status: '200' });
      c.inc({ method: 'POST', status: '201' });
      c.inc({ method: 'GET', status: '200' });
      expect(c.get({ method: 'GET', status: '200' })).toBe(2);
      expect(c.get({ method: 'POST', status: '201' })).toBe(1);
    });

    it('returns same instance for same name', () => {
      const c1 = reg.counter('x', 'help');
      const c2 = reg.counter('x', 'help');
      expect(c1).toBe(c2);
    });
  });

  describe('Gauge', () => {
    it('sets to exact value', () => {
      const g = reg.gauge('active_trips', 'Active trips');
      g.set(42);
      expect(g.get()).toBe(42);
    });

    it('increments and decrements', () => {
      const g = reg.gauge('active_drivers', 'Active drivers');
      g.inc();
      g.inc();
      g.dec();
      expect(g.get()).toBe(1);
    });

    it('supports per-label tracking', () => {
      const g = reg.gauge('queue_depth', 'Queue');
      g.set(10, { queue: 'payout' });
      g.set(5, { queue: 'email' });
      expect(g.get({ queue: 'payout' })).toBe(10);
      expect(g.get({ queue: 'email' })).toBe(5);
    });
  });

  describe('Histogram', () => {
    it('counts observations', () => {
      const h = reg.histogram('req_duration', 'Duration');
      h.observe(0.1);
      h.observe(0.5);
      h.observe(2.0);
      const text = h.toPrometheus();
      expect(text).toContain('req_duration_count');
    });

    it('populates lower buckets for small values', () => {
      const h = reg.histogram('latency', 'Latency', [0.1, 0.5, 1.0]);
      h.observe(0.05);
      const text = h.toPrometheus();
      expect(text).toContain('le="0.1"');
    });

    it('accumulates sum correctly', () => {
      const h = reg.histogram('sizes', 'Sizes', [10, 100]);
      h.observe(3);
      h.observe(7);
      const text = h.toPrometheus();
      expect(text).toContain('sizes_sum');
    });
  });

  describe('toPrometheusText', () => {
    it('includes HELP and TYPE lines for each metric', () => {
      reg.counter('req_total', 'Total requests');
      reg.gauge('active', 'Active count');
      reg.histogram('duration', 'Duration');

      const text = reg.toPrometheusText();
      expect(text).toContain('# HELP req_total Total requests');
      expect(text).toContain('# TYPE req_total counter');
      expect(text).toContain('# HELP active Active count');
      expect(text).toContain('# TYPE active gauge');
      expect(text).toContain('# TYPE duration histogram');
    });

    it('ends with a newline', () => {
      reg.counter('x', 'y');
      expect(reg.toPrometheusText().endsWith('\n')).toBe(true);
    });
  });
});
