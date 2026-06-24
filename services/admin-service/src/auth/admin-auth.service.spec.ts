import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AdminAuthService } from './admin-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const HASHED_PASSWORD = bcrypt.hashSync('ValidPass123!', 4);

const makeAdmin = (overrides: Record<string, unknown> = {}) => ({
  id: 'admin-uuid-1111',
  email: 'markie@bidride.com',
  firstName: 'Markie',
  lastName: 'Brown',
  passwordHash: HASHED_PASSWORD,
  adminRole: 'founder',
  isActive: true,
  lastLoginAt: null,
  ...overrides,
});

const makePrisma = (admin: ReturnType<typeof makeAdmin> | null) => ({
  adminUser: {
    findUnique: jest.fn().mockResolvedValue(admin),
    update: jest.fn().mockResolvedValue({}),
  },
});

const makeJwt = () => ({
  sign: jest.fn().mockReturnValue('signed.jwt.token'),
  verify: jest.fn().mockReturnValue({ sub: 'admin-uuid-1111', email: 'markie@bidride.com', role: 'founder' }),
});

const makeAudit = () => ({
  createLog: jest.fn().mockResolvedValue(undefined),
});

const makeConfig = () => ({
  get: jest.fn().mockImplementation((key: string, fallback?: string) => {
    if (key === 'ADMIN_SESSION_TTL_SECONDS') return '28800';
    return fallback;
  }),
});

async function buildService(prismaAdmin: ReturnType<typeof makeAdmin> | null) {
  const prisma = makePrisma(prismaAdmin);
  const jwt = makeJwt();
  const audit = makeAudit();
  const config = makeConfig();

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AdminAuthService,
      { provide: PrismaService, useValue: prisma },
      { provide: JwtService, useValue: jwt },
      { provide: ConfigService, useValue: config },
      { provide: AuditService, useValue: audit },
    ],
  }).compile();

  return {
    service: module.get<AdminAuthService>(AdminAuthService),
    prisma,
    jwt,
    audit,
  };
}

describe('AdminAuthService', () => {
  describe('login', () => {
    it('returns token and admin info on valid credentials', async () => {
      const { service, jwt, audit } = await buildService(makeAdmin());

      const result = await service.login('markie@bidride.com', 'ValidPass123!', '127.0.0.1');

      expect(result.token).toBe('signed.jwt.token');
      expect(result.admin.email).toBe('markie@bidride.com');
      expect(result.admin.role).toBe('founder');
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'admin-uuid-1111', email: 'markie@bidride.com', role: 'founder' }),
        expect.objectContaining({ expiresIn: 28800 }),
      );
      expect(audit.createLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'admin.login', targetType: 'admin_session' }),
      );
    });

    it('throws UnauthorizedException when admin not found', async () => {
      const { service } = await buildService(null);
      await expect(service.login('nope@bidride.com', 'ValidPass123!')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException on wrong password', async () => {
      const { service } = await buildService(makeAdmin());
      await expect(service.login('markie@bidride.com', 'WrongPassword!')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when admin is inactive', async () => {
      const { service } = await buildService(makeAdmin({ isActive: false }));
      await expect(service.login('markie@bidride.com', 'ValidPass123!')).rejects.toThrow(UnauthorizedException);
    });

    it('updates lastLoginAt on successful login', async () => {
      const { service, prisma } = await buildService(makeAdmin());
      await service.login('markie@bidride.com', 'ValidPass123!');
      expect(prisma.adminUser.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'admin-uuid-1111' },
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        }),
      );
    });

    it('does not leak whether email exists via identical error message', async () => {
      const { service: s1 } = await buildService(null);
      const { service: s2 } = await buildService(makeAdmin());

      let err1: Error | undefined;
      let err2: Error | undefined;
      try { await s1.login('ghost@bidride.com', 'WrongPass!'); } catch (e) { err1 = e as Error; }
      try { await s2.login('markie@bidride.com', 'WrongPass!'); } catch (e) { err2 = e as Error; }

      expect(err1?.message).toBe(err2?.message);
    });
  });

  describe('logout', () => {
    it('creates an audit log for logout', async () => {
      const { service, audit } = await buildService(makeAdmin());
      await service.logout('admin-uuid-1111', 'markie@bidride.com', '127.0.0.1');
      expect(audit.createLog).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'admin-uuid-1111',
          action: 'admin.logout',
          targetType: 'admin_session',
          targetId: 'admin-uuid-1111',
        }),
      );
    });
  });

  describe('verifyToken', () => {
    it('delegates to JwtService.verify', () => {
      const jwt = makeJwt();
      const service = new AdminAuthService(
        {} as any,
        jwt as any,
        makeConfig() as any,
        makeAudit() as any,
      );
      const result = service.verifyToken('some.token');
      expect(jwt.verify).toHaveBeenCalledWith('some.token');
      expect(result.role).toBe('founder');
    });

    it('propagates JwtService errors (expired, tampered)', () => {
      const jwt = makeJwt();
      jwt.verify.mockImplementation(() => { throw new Error('jwt expired'); });
      const service = new AdminAuthService(
        {} as any,
        jwt as any,
        makeConfig() as any,
        makeAudit() as any,
      );
      expect(() => service.verifyToken('expired.token')).toThrow('jwt expired');
    });
  });
});
