import {
  constants as cryptoConstants,
  createPublicKey,
  generateKeyPairSync,
  privateEncrypt,
} from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AdminAuthService } from './admin-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { KmsJwtSigner } from './kms-jwt-signer';
import { resolveAdminJwtVerification } from '../admin-jwt-verification';

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
    it('delegates to JwtService.verify with the resolver-selected key and algorithm', () => {
      // SEC-RS256-B1: the key now comes from the admin resolver per token, so the
      // call carries an explicit secret and a single-element algorithm allowlist.
      process.env.ADMIN_JWT_SECRET = 'delegation-admin-secret';
      const hs256Token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.e30.sig`;
      const jwt = makeJwt();
      const service = new AdminAuthService(
        {} as any,
        jwt as any,
        makeConfig() as any,
        makeAudit() as any,
      );
      const result = service.verifyToken(hs256Token);
      expect(jwt.verify).toHaveBeenCalledWith(hs256Token, {
        secret: 'delegation-admin-secret',
        algorithms: ['HS256'],
        issuer: 'bidride-auth',
        audience: 'bidride-admin',
      });
      expect(result.role).toBe('founder');
      delete process.env.ADMIN_JWT_SECRET;
    });

    it('propagates JwtService errors (expired, tampered)', () => {
      process.env.ADMIN_JWT_SECRET = 'propagation-admin-secret';
      const hs256Token = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.e30.sig`;
      const jwt = makeJwt();
      jwt.verify.mockImplementation(() => { throw new Error('jwt expired'); });
      const service = new AdminAuthService(
        {} as any,
        jwt as any,
        makeConfig() as any,
        makeAudit() as any,
      );
      expect(() => service.verifyToken(hs256Token)).toThrow('jwt expired');
      delete process.env.ADMIN_JWT_SECRET;
    });

    it('propagates a resolver failure for an unsupported algorithm', () => {
      const jwt = makeJwt();
      const service = new AdminAuthService(
        {} as any,
        jwt as any,
        makeConfig() as any,
        makeAudit() as any,
      );
      // Resolver throws before jwt.verify is ever reached.
      expect(() => service.verifyToken('not-a-jwt')).toThrow(/unsupported/i);
      expect(jwt.verify).not.toHaveBeenCalled();
    });
  });

  /**
   * SEC-RS256-B2 — admin session ISSUANCE. The default must stay HS256; with a
   * signer injected the session token becomes RS256 while every claim, the admin
   * issuer/audience and the configured TTL are preserved, and the token must
   * verify through the SEC-RS256-B1 admin resolver.
   */
  describe('login — RS256 issuance', () => {
    const KID = 'admin-v1';
    const SHA256_DIGEST_INFO_PREFIX = Buffer.from(
      '3031300d060960864801650304020105000420',
      'hex',
    );

    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const kms = {
      signDigest: async (digest: Uint8Array) =>
        new Uint8Array(
          privateEncrypt(
            { key: pair.privateKey, padding: cryptoConstants.RSA_PKCS1_PADDING },
            Buffer.concat([SHA256_DIGEST_INFO_PREFIX, Buffer.from(digest)]),
          ),
        ),
      publicKeyDer: async () =>
        new Uint8Array(createPublicKey(pair.publicKey).export({ type: 'spki', format: 'der' })),
    };

    beforeEach(() => {
      process.env.JWT_ADMIN_PUBLIC_KEYS = JSON.stringify({ [KID]: pair.publicKey });
    });
    afterEach(() => {
      delete process.env.JWT_ADMIN_PUBLIC_KEYS;
      delete process.env.ADMIN_JWT_SECRET;
    });

    const buildWithSigner = (signer?: KmsJwtSigner) =>
      new AdminAuthService(
        makePrisma(makeAdmin()) as any,
        new JwtService({}) as any,
        makeConfig() as any,
        makeAudit() as any,
        signer,
      );

    it('issues an RS256 admin session token that the admin resolver accepts', async () => {
      const service = buildWithSigner(new KmsJwtSigner(kms, KID));

      const { token } = await service.login('markie@bidride.com', 'ValidPass123!');

      const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
      expect(header.alg).toBe('RS256');
      expect(header.kid).toBe(KID);

      // Verifies through the B1 admin resolver — issuance and verification agree.
      const { verifyKey, algorithm } = resolveAdminJwtVerification(token);
      expect(algorithm).toBe('RS256');
      const payload = new JwtService({}).verify(token, {
        secret: verifyKey,
        algorithms: [algorithm],
        issuer: 'bidride-auth',
        audience: 'bidride-admin',
      }) as Record<string, unknown>;
      expect(payload.sub).toBe('admin-uuid-1111');
      expect(payload.email).toBe('markie@bidride.com');
      expect(payload.role).toBe('founder');
      expect(payload.exp).toBe((payload.iat as number) + 28800);
    });

    it('keeps issuing HS256 when no signer is configured', async () => {
      process.env.ADMIN_JWT_SECRET = 'default-path-secret';
      // Mirrors production: AdminAuthModule supplies the HMAC secret to JwtModule.
      const service = new AdminAuthService(
        makePrisma(makeAdmin()) as any,
        new JwtService({ secret: 'default-path-secret' }) as any,
        makeConfig() as any,
        makeAudit() as any,
        undefined,
      );

      const { token } = await service.login('markie@bidride.com', 'ValidPass123!');

      const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString());
      expect(header.alg).toBe('HS256');
      expect(header.kid).toBeUndefined();
      // Still a real, verifiable admin session on the default path.
      expect(service.verifyToken(token).role).toBe('founder');
    });

    it('propagates a KMS failure instead of falling back to HS256', async () => {
      const broken = new KmsJwtSigner(
        {
          signDigest: async () => {
            throw new Error('KMSInternalFailure');
          },
          publicKeyDer: async () => new Uint8Array(),
        },
        KID,
      );

      await expect(
        buildWithSigner(broken).login('markie@bidride.com', 'ValidPass123!'),
      ).rejects.toThrow(/KMSInternalFailure/);
    });
  });

  /**
   * SEC-RS256-B1 — real end-to-end admin verification. These use a REAL
   * JwtService and REAL keys: no mock stands between the token and the resolver,
   * so they prove the admin session path actually accepts RS256 and actually
   * keeps the admin trust domain separate from the user domain.
   */
  describe('verifyToken — RS256 admin domain (real keys)', () => {
    const ADMIN_KID = 'admin-v1';
    const HS_SECRET = 'e2e-admin-secret';

    const adminPair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const userPair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const realJwt = new JwtService({});

    const build = () =>
      new AdminAuthService({} as any, realJwt as any, makeConfig() as any, makeAudit() as any);

    const signAdminRs = (opts: { kid?: string; privateKey?: string; audience?: string } = {}) =>
      realJwt.sign(
        { sub: 'admin-uuid-1111', email: 'markie@bidride.com', role: 'founder' },
        {
          privateKey: opts.privateKey ?? adminPair.privateKey,
          algorithm: 'RS256',
          keyid: opts.kid ?? ADMIN_KID,
          issuer: 'bidride-auth',
          audience: opts.audience ?? 'bidride-admin',
        },
      );

    beforeEach(() => {
      process.env.ADMIN_JWT_SECRET = HS_SECRET;
      process.env.JWT_ADMIN_PUBLIC_KEYS = JSON.stringify({ [ADMIN_KID]: adminPair.publicKey });
      delete process.env.JWT_PUBLIC_KEYS;
    });

    afterEach(() => {
      delete process.env.ADMIN_JWT_SECRET;
      delete process.env.JWT_ADMIN_PUBLIC_KEYS;
      delete process.env.JWT_PUBLIC_KEYS;
    });

    it('accepts an RS256 admin session token signed with a known kid', () => {
      const payload = build().verifyToken(signAdminRs());
      expect(payload.sub).toBe('admin-uuid-1111');
      expect(payload.role).toBe('founder');
    });

    it('still accepts a legacy HS256 admin session token', () => {
      const legacy = realJwt.sign(
        { sub: 'admin-uuid-1111', email: 'markie@bidride.com', role: 'founder' },
        { secret: HS_SECRET, issuer: 'bidride-auth', audience: 'bidride-admin' },
      );
      expect(build().verifyToken(legacy).role).toBe('founder');
    });

    it('rejects an RS256 token whose kid is not in the admin keyset', () => {
      expect(() => build().verifyToken(signAdminRs({ kid: 'rotated-out' }))).toThrow();
    });

    it('rejects an RS256 admin-audience token signed by a foreign key on a known kid', () => {
      expect(() => build().verifyToken(signAdminRs({ privateKey: userPair.privateKey }))).toThrow();
    });

    it('rejects a user-audience RS256 token, preserving domain separation', () => {
      expect(() => build().verifyToken(signAdminRs({ audience: 'bidride-user' }))).toThrow();
    });

    it('never trusts the user keyset for an admin session', () => {
      // kid lives ONLY in the user keyset; admitting it would allow cross-domain replay.
      delete process.env.JWT_ADMIN_PUBLIC_KEYS;
      process.env.JWT_PUBLIC_KEYS = JSON.stringify({ [ADMIN_KID]: adminPair.publicKey });
      expect(() => build().verifyToken(signAdminRs())).toThrow();
    });
  });
});
