export type Labels = Record<string, string>;

interface CounterEntry { value: number; labels: Labels }
interface GaugeEntry   { value: number; labels: Labels }
interface HistogramEntry {
  sum: number;
  count: number;
  buckets: Map<number, number>;
  labels: Labels;
}

export class Counter {
  private readonly entries = new Map<string, CounterEntry>();

  constructor(
    public readonly name: string,
    public readonly help: string,
  ) {}

  inc(labels: Labels = {}, by = 1): void {
    const key = JSON.stringify(labels);
    const e = this.entries.get(key) ?? { value: 0, labels };
    e.value += by;
    this.entries.set(key, e);
  }

  get(labels: Labels = {}): number {
    return this.entries.get(JSON.stringify(labels))?.value ?? 0;
  }

  toPrometheus(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const e of this.entries.values()) {
      lines.push(`${this.name}${formatLabels(e.labels)} ${e.value}`);
    }
    return lines.join('\n');
  }
}

export class Gauge {
  private readonly entries = new Map<string, GaugeEntry>();

  constructor(
    public readonly name: string,
    public readonly help: string,
  ) {}

  set(value: number, labels: Labels = {}): void {
    this.entries.set(JSON.stringify(labels), { value, labels });
  }

  inc(labels: Labels = {}, by = 1): void {
    const key = JSON.stringify(labels);
    const e = this.entries.get(key) ?? { value: 0, labels };
    e.value += by;
    this.entries.set(key, e);
  }

  dec(labels: Labels = {}, by = 1): void {
    this.inc(labels, -by);
  }

  get(labels: Labels = {}): number {
    return this.entries.get(JSON.stringify(labels))?.value ?? 0;
  }

  toPrometheus(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const e of this.entries.values()) {
      lines.push(`${this.name}${formatLabels(e.labels)} ${e.value}`);
    }
    return lines.join('\n');
  }
}

export class Histogram {
  private readonly entries = new Map<string, HistogramEntry>();
  private readonly bounds: number[];

  constructor(
    public readonly name: string,
    public readonly help: string,
    buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  ) {
    this.bounds = [...buckets].sort((a, b) => a - b);
  }

  observe(value: number, labels: Labels = {}): void {
    const key = JSON.stringify(labels);
    if (!this.entries.has(key)) {
      this.entries.set(key, {
        sum: 0,
        count: 0,
        buckets: new Map(this.bounds.map((b) => [b, 0])),
        labels,
      });
    }
    const e = this.entries.get(key)!;
    e.sum += value;
    e.count += 1;
    for (const bound of this.bounds) {
      if (value <= bound) e.buckets.set(bound, (e.buckets.get(bound) ?? 0) + 1);
    }
  }

  toPrometheus(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const e of this.entries.values()) {
      const lbl = e.labels;
      for (const [le, count] of e.buckets) {
        lines.push(`${this.name}_bucket${formatLabels({ ...lbl, le: String(le) })} ${count}`);
      }
      lines.push(`${this.name}_bucket${formatLabels({ ...lbl, le: '+Inf' })} ${e.count}`);
      lines.push(`${this.name}_sum${formatLabels(lbl)} ${e.sum}`);
      lines.push(`${this.name}_count${formatLabels(lbl)} ${e.count}`);
    }
    return lines.join('\n');
  }
}

function formatLabels(labels: Labels): string {
  const pairs = Object.entries(labels);
  if (pairs.length === 0) return '';
  return '{' + pairs.map(([k, v]) => `${k}="${v}"`).join(',') + '}';
}

export class MetricsRegistry {
  private readonly counters   = new Map<string, Counter>();
  private readonly gauges     = new Map<string, Gauge>();
  private readonly histograms = new Map<string, Histogram>();

  counter(name: string, help: string): Counter {
    if (!this.counters.has(name)) this.counters.set(name, new Counter(name, help));
    return this.counters.get(name)!;
  }

  gauge(name: string, help: string): Gauge {
    if (!this.gauges.has(name)) this.gauges.set(name, new Gauge(name, help));
    return this.gauges.get(name)!;
  }

  histogram(name: string, help: string, buckets?: number[]): Histogram {
    if (!this.histograms.has(name)) this.histograms.set(name, new Histogram(name, help, buckets));
    return this.histograms.get(name)!;
  }

  toPrometheusText(): string {
    const parts: string[] = [];
    for (const c of this.counters.values()) parts.push(c.toPrometheus());
    for (const g of this.gauges.values()) parts.push(g.toPrometheus());
    for (const h of this.histograms.values()) parts.push(h.toPrometheus());
    return parts.join('\n\n') + '\n';
  }
}

// Global BidiRide metrics registry
export const registry = new MetricsRegistry();

export const bidRideMetrics = {
  httpRequestsTotal:    registry.counter('bidride_http_requests_total',   'Total HTTP requests'),
  httpRequestDuration:  registry.histogram('bidride_http_request_duration_seconds', 'HTTP request latency in seconds', [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]),
  httpErrors:           registry.counter('bidride_http_errors_total',     'Total HTTP errors'),
  activeTrips:          registry.gauge('bidride_active_trips',            'Currently active trips'),
  activeDrivers:        registry.gauge('bidride_active_drivers',          'Currently online drivers'),
  queueDepth:           registry.gauge('bidride_queue_depth',             'Job queue depth'),
  paymentThroughput:    registry.counter('bidride_payments_total',        'Total payment events'),
  aiInferenceLatency:   registry.histogram('bidride_ai_inference_seconds','AI inference latency in seconds', [0.05, 0.1, 0.25, 0.5, 1, 2, 5]),
  fraudAlerts:          registry.counter('bidride_fraud_alerts_total',    'Total fraud alerts triggered'),
  safetyEvents:         registry.counter('bidride_safety_events_total',   'Total safety events'),
  circuitBreakerState:  registry.gauge('bidride_circuit_breaker_open',    'Circuit breaker open (1) or closed (0)'),
};
