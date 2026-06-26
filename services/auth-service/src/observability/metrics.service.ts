import { Injectable } from '@nestjs/common';

type Labels = Record<string, string>;

class Counter {
  private readonly map = new Map<string, number>();
  constructor(public readonly name: string, public readonly help: string) {}
  inc(labels: Labels = {}, by = 1): void {
    const k = JSON.stringify(labels);
    this.map.set(k, (this.map.get(k) ?? 0) + by);
  }
  get(labels: Labels = {}): number { return this.map.get(JSON.stringify(labels)) ?? 0; }
  toText(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [k, v] of this.map) {
      const lbl = JSON.parse(k) as Labels;
      const pairs = Object.entries(lbl);
      const suffix = pairs.length ? '{' + pairs.map(([a,b]) => `${a}="${b}"`).join(',') + '}' : '';
      lines.push(`${this.name}${suffix} ${v}`);
    }
    return lines.join('\n');
  }
}

class Gauge {
  private value = 0;
  constructor(public readonly name: string, public readonly help: string) {}
  set(v: number): void { this.value = v; }
  inc(by = 1): void { this.value += by; }
  dec(by = 1): void { this.value -= by; }
  get(): number { return this.value; }
  toText(): string {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`, `${this.name} ${this.value}`].join('\n');
  }
}

@Injectable()
export class MetricsService {
  readonly httpRequests  = new Counter('bidride_auth_http_requests_total', 'Total HTTP requests to auth-service');
  readonly httpErrors    = new Counter('bidride_auth_http_errors_total', 'Total HTTP errors in auth-service');
  readonly otpAttempts   = new Counter('bidride_auth_otp_attempts_total', 'Total OTP attempts');
  readonly loginAttempts = new Counter('bidride_auth_login_attempts_total', 'Total login attempts');
  readonly activeUsers   = new Gauge('bidride_auth_active_sessions', 'Current active JWT sessions');

  getPrometheusText(): string {
    return [
      this.httpRequests.toText(),
      this.httpErrors.toText(),
      this.otpAttempts.toText(),
      this.loginAttempts.toText(),
      this.activeUsers.toText(),
    ].join('\n\n') + '\n';
  }
}
