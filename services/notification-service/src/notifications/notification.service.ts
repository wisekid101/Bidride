import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as AWS from 'aws-sdk';
import { Twilio } from 'twilio';

interface PushPayload {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  priority?: 'default' | 'high';
}

interface SmsPayload {
  to: string;
  body: string;
}

interface EmailPayload {
  to: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
}

@Injectable()
export class NotificationService {
  private readonly ses: AWS.SES;
  private readonly twilio: Twilio;
  private readonly firebaseServerKey: string;
  private readonly fromEmail = 'hello@bidride.com';
  private readonly fromPhone: string;

  constructor(private readonly config: ConfigService) {
    this.ses = new AWS.SES({ region: config.get('AWS_REGION', 'us-east-1') });

    this.twilio = new Twilio(
      config.getOrThrow('TWILIO_ACCOUNT_SID'),
      config.getOrThrow('TWILIO_AUTH_TOKEN'),
    );

    this.firebaseServerKey = config.getOrThrow('FIREBASE_SERVER_KEY');
    this.fromPhone = config.getOrThrow('TWILIO_PHONE_NUMBER');
  }

  // ─── Push Notifications (FCM) ─────────────────────────────────────────────

  async sendPush(payload: PushPayload): Promise<void> {
    const message = {
      to: payload.token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data ?? {},
      priority: payload.priority ?? 'high',
      android: { priority: 'high' },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: { aps: { sound: 'default', badge: 1 } },
      },
    };

    const response = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        Authorization: `key=${this.firebaseServerKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('FCM push failed:', error);
    }
  }

  async sendPushToMultiple(tokens: string[], title: string, body: string, data?: Record<string, string>): Promise<void> {
    if (tokens.length === 0) return;
    const message = {
      registration_ids: tokens,
      notification: { title, body },
      data: data ?? {},
      priority: 'high',
    };

    await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        Authorization: `key=${this.firebaseServerKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
  }

  // ─── SMS (Twilio) ─────────────────────────────────────────────────────────

  async sendSms(payload: SmsPayload): Promise<void> {
    if (this.config.get('NODE_ENV') === 'development') {
      console.log(`[DEV SMS] To: ${payload.to} — ${payload.body}`);
      return;
    }

    await this.twilio.messages.create({
      to: payload.to,
      from: this.fromPhone,
      body: payload.body,
    });
  }

  async sendMaskedCall(riderPhone: string, driverPhone: string): Promise<{ proxyNumber: string }> {
    // Twilio Proxy — creates masked number for rider↔driver communication
    const proxyNumber = this.fromPhone; // Actual implementation uses Twilio Proxy API
    return { proxyNumber };
  }

  // ─── Email (AWS SES) ──────────────────────────────────────────────────────

  async sendEmail(payload: EmailPayload): Promise<void> {
    if (this.config.get('NODE_ENV') === 'development') {
      console.log(`[DEV EMAIL] To: ${payload.to} — ${payload.subject}`);
      return;
    }

    await this.ses.sendEmail({
      Source: `BidRide <${this.fromEmail}>`,
      Destination: { ToAddresses: [payload.to] },
      Message: {
        Subject: { Data: payload.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: payload.htmlBody, Charset: 'UTF-8' },
          Text: { Data: payload.textBody ?? '', Charset: 'UTF-8' },
        },
      },
    }).promise();
  }

  // ─── Templated Notifications ──────────────────────────────────────────────

  async notifyRiderDriverAssigned(
    pushToken: string,
    driverName: string,
    vehicleInfo: string,
    eta: string,
  ): Promise<void> {
    await this.sendPush({
      token: pushToken,
      title: 'Driver on the way!',
      body: `${driverName} · ${vehicleInfo} · ETA ${eta}`,
      data: { type: 'DRIVER_ASSIGNED' },
    });
  }

  async notifyDriverNewRequest(pushToken: string, pickupArea: string, takeHome: number): Promise<void> {
    await this.sendPush({
      token: pushToken,
      title: 'New ride request',
      body: `Pickup: ${pickupArea} · Take-home: $${takeHome.toFixed(2)}`,
      data: { type: 'NEW_REQUEST' },
      priority: 'high',
    });
  }

  async notifySosTrustedContact(phone: string, riderName: string, tripId: string): Promise<void> {
    await this.sendSms({
      to: phone,
      body: `BidRide Safety Alert: ${riderName} has activated an emergency SOS during a ride. They are being assisted. Trip ID: ${tripId.slice(0, 8)}`,
    });
  }

  async notifyDriverFloorSupplement(pushToken: string, supplement: number, totalEarnings: number): Promise<void> {
    await this.sendPush({
      token: pushToken,
      title: 'Earnings Floor Activated',
      body: `BidRide added $${supplement.toFixed(2)} — your guaranteed take-home: $${totalEarnings.toFixed(2)}`,
      data: { type: 'FLOOR_SUPPLEMENT' },
    });
  }

  async sendDriverWeeklyPayout(email: string, driverName: string, amount: number, periodEnd: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: `Your BidRide payout: $${amount.toFixed(2)}`,
      htmlBody: `
        <h2>Hi ${driverName},</h2>
        <p>Your weekly payout of <strong style="font-size:24px">$${amount.toFixed(2)}</strong> has been sent.</p>
        <p>Period ending: ${periodEnd}</p>
        <p>Funds typically arrive within 1–2 business days.</p>
        <p>Questions? Reply to this email or visit <a href="https://driver.bidride.com">driver.bidride.com</a></p>
      `,
      textBody: `Hi ${driverName}, your payout of $${amount.toFixed(2)} for period ending ${periodEnd} has been sent.`,
    });
  }

  async sendFcraAdverseActionLetter(email: string, driverName: string, checkrReportUrl: string): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: 'Important: BidRide Driver Application — Decision Notice',
      htmlBody: `
        <h2>Dear ${driverName},</h2>
        <p>We have reviewed your driver application and, based in whole or in part on information in a consumer report, we are unable to approve your application at this time.</p>
        <p><strong>Consumer Reporting Agency:</strong> Checkr, Inc. · <a href="https://checkr.com">checkr.com</a></p>
        <p>You have the right to a free copy of your consumer report within 60 days. You may dispute the accuracy of information in your report directly with Checkr.</p>
        <p><a href="${checkrReportUrl}">View your background check report</a></p>
        <p>This decision was made in compliance with the Fair Credit Reporting Act (FCRA).</p>
      `,
    });
  }
}
