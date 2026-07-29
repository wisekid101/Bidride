import { HttpException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getCorrelationId } from '@bidride/observability';

const DRIVER_SERVICE_URL = process.env.DRIVER_SERVICE_URL ?? 'http://localhost:3003';

// driver-service's AdminGuard accepts these roles; admin-portal roles that
// aren't in its list are forwarded as 'operations'.
const DRIVER_SERVICE_ROLES = new Set(['founder', 'super_admin', 'operations']);

@Injectable()
export class DriversAdminService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // Short-lived service JWT signed with the secret driver-service verifies.
  // The admin's identity/role comes from the validated portal session, so the
  // downstream role can never be spoofed via headers.
  private serviceToken(adminId: string, role: string): string {
    const forwardedRole = DRIVER_SERVICE_ROLES.has(role) ? role : 'operations';
    // B8A: getOrThrow fails startup if JWT_SECRET is absent; iss/aud match what
    // driver-service now validates ('bidride-user'), preserving this call path.
    return this.jwt.sign(
      { sub: adminId, role: forwardedRole },
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: '2m',
        issuer: 'bidride-auth',
        audience: 'bidride-user',
      },
    );
  }

  private async forward(
    adminId: string,
    role: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ) {
    const res = await fetch(`${DRIVER_SERVICE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        // The service token is untouched — correlation is additive.
        Authorization: `Bearer ${this.serviceToken(adminId, role)}`,
        ...(getCorrelationId() ? { 'x-correlation-id': getCorrelationId()! } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Pass the upstream body through verbatim — the portal renders the
      // APPROVAL_REQUIREMENTS_NOT_MET missing[] list from it.
      throw new HttpException(data, res.status);
    }
    return data;
  }

  listDrivers(adminId: string, role: string, query: string) {
    return this.forward(adminId, role, 'GET', `/drivers/admin${query ? `?${query}` : ''}`);
  }

  getDriverDetail(adminId: string, role: string, driverId: string) {
    return this.forward(adminId, role, 'GET', `/drivers/admin/${driverId}`);
  }

  approveDriver(adminId: string, role: string, driverId: string, body: unknown) {
    return this.forward(adminId, role, 'POST', `/drivers/admin/${driverId}/approve`, body ?? {});
  }

  declineDriver(adminId: string, role: string, driverId: string, body: unknown) {
    return this.forward(adminId, role, 'POST', `/drivers/admin/${driverId}/decline`, body ?? {});
  }

  reviewDocument(
    adminId: string,
    role: string,
    driverId: string,
    documentType: string,
    body: unknown,
  ) {
    return this.forward(
      adminId,
      role,
      'POST',
      `/documents/admin/${driverId}/${documentType}/review`,
      body ?? {},
    );
  }
}
