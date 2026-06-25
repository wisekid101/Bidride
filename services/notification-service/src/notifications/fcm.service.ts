import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'crypto';

export interface FcmMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
// Cache token for 55 min — Google issues 60-min tokens, leave 5-min buffer
const TOKEN_CACHE_MS = 55 * 60 * 1000;

@Injectable()
export class FcmService {
  private readonly logger = new Logger(FcmService.name);
  private readonly projectId: string;
  private readonly serviceAccountEmail: string;
  private readonly privateKey: string;

  private cachedToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(config: ConfigService) {
    this.projectId = config.getOrThrow('FCM_PROJECT_ID');
    this.serviceAccountEmail = config.getOrThrow('FCM_SERVICE_ACCOUNT_EMAIL');
    // Env vars store literal \n — restore to real newlines for PEM parsing
    const raw = config.getOrThrow('FCM_SERVICE_ACCOUNT_PRIVATE_KEY');
    this.privateKey = raw.replace(/\\n/g, '\n');
  }

  // ─── OAuth 2.0 service-account token ─────────────────────────────────────

  async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: this.serviceAccountEmail,
        scope: FCM_SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      }),
    ).toString('base64url');

    const sign = createSign('RSA-SHA256');
    sign.update(`${header}.${payload}`);
    const sig = sign.sign(this.privateKey, 'base64url');
    const jwt = `${header}.${payload}.${sig}`;

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
    });

    if (!res.ok) {
      throw new Error(`FCM token request failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { access_token: string };
    this.cachedToken = data.access_token;
    this.tokenExpiresAt = Date.now() + TOKEN_CACHE_MS;
    return this.cachedToken;
  }

  // ─── Single device send ───────────────────────────────────────────────────

  async send(message: FcmMessage): Promise<void> {
    let accessToken: string;
    try {
      accessToken = await this.getAccessToken();
    } catch (err) {
      this.logger.error(`FCM token fetch failed — notification dropped: ${String(err)}`);
      return;
    }

    const body = JSON.stringify({
      message: {
        token: message.token,
        notification: { title: message.title, body: message.body },
        data: message.data ?? {},
        android: {
          priority: 'HIGH',
          notification: { sound: 'default', channelId: 'bidride-notifications' },
        },
        apns: {
          headers: { 'apns-priority': '10' },
          payload: { aps: { sound: 'default', badge: 1, 'content-available': 1 } },
        },
      },
    });

    try {
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body,
        },
      );

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(
          `FCM send failed (token …${message.token.slice(-6)}): HTTP ${res.status} — ${text}`,
        );
      }
    } catch (err) {
      this.logger.error(`FCM send threw: ${String(err)}`);
    }
  }

  // ─── Multi-device send (FCM v1 has no batch — send individually) ──────────

  async sendMultiple(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (tokens.length === 0) return;

    const results = await Promise.allSettled(
      tokens.map((token) => this.send({ token, title, body, data })),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      this.logger.warn(`FCM multi-send: ${failed}/${tokens.length} failed`);
    }
  }
}
