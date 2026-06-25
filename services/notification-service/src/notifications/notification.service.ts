import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as AWS from 'aws-sdk';
import { Twilio } from 'twilio';
import { FcmService } from './fcm.service';

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
  private readonly fromEmail = 'hello@bidride.com';
  private readonly fromPhone: string;

  constructor(
    private readonly config: ConfigService,
    private readonly fcm: FcmService,
  ) {
    this.ses = new AWS.SES({ region: config.get('AWS_REGION', 'us-east-1') });

    this.twilio = new Twilio(
      config.getOrThrow('TWILIO_ACCOUNT_SID'),
      config.getOrThrow('TWILIO_AUTH_TOKEN'),
    );

    this.fromPhone = config.getOrThrow('TWILIO_PHONE_NUMBER');
  }

  // ─── Push Notifications (FCM HTTP v1) ─────────────────────────────────────

  async sendPush(
    token: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    await this.fcm.send({ token, title, body, data });
  }

  async sendPushToMultiple(
    tokens: string[],
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    await this.fcm.sendMultiple(tokens, title, body, data);
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

  // Masked calling/SMS handled by ProxyService (Twilio Proxy API).
  async sendMaskedCall(_riderPhone: string, _driverPhone: string): Promise<{ proxyNumber: string }> {
    throw new Error('Use ProxyService.initiateCall() instead of sendMaskedCall()');
  }

  // ─── Email (AWS SES) ──────────────────────────────────────────────────────

  async sendEmail(payload: EmailPayload): Promise<void> {
    if (this.config.get('NODE_ENV') === 'development') {
      console.log(`[DEV EMAIL] To: ${payload.to} — ${payload.subject}`);
      return;
    }

    await this.ses
      .sendEmail({
        Source: `BidRide <${this.fromEmail}>`,
        Destination: { ToAddresses: [payload.to] },
        Message: {
          Subject: { Data: payload.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: payload.htmlBody, Charset: 'UTF-8' },
            Text: { Data: payload.textBody ?? '', Charset: 'UTF-8' },
          },
        },
      })
      .promise();
  }

  // ─── Templated Notifications ──────────────────────────────────────────────

  async notifyRiderDriverAssigned(
    pushToken: string,
    driverName: string,
    vehicleInfo: string,
    eta: string,
  ): Promise<void> {
    await this.fcm.send({
      token: pushToken,
      title: 'Driver on the way!',
      body: `${driverName} · ${vehicleInfo} · ETA ${eta}`,
      data: { type: 'DRIVER_ASSIGNED' },
    });
  }

  async notifyDriverNewRequest(
    pushToken: string,
    pickupArea: string,
    takeHome: number,
  ): Promise<void> {
    await this.fcm.send({
      token: pushToken,
      title: 'New ride request',
      body: `Pickup: ${pickupArea} · Take-home: $${takeHome.toFixed(2)}`,
      data: { type: 'NEW_REQUEST' },
    });
  }

  async notifySosTrustedContact(phone: string, riderName: string, tripId: string): Promise<void> {
    await this.sendSms({
      to: phone,
      body: `BidRide Safety Alert: ${riderName} has activated an emergency SOS during a ride. They are being assisted. Trip ID: ${tripId.slice(0, 8)}`,
    });
  }

  async notifySosTrustedContactPush(
    pushToken: string,
    riderName: string,
    tripId: string,
  ): Promise<void> {
    await this.fcm.send({
      token: pushToken,
      title: '🚨 Safety Alert',
      body: `${riderName} activated an SOS during their ride. Trip: ${tripId.slice(0, 8)}`,
      data: { type: 'SOS_ALERT', tripId },
    });
  }

  async notifyDriverFloorSupplement(
    pushToken: string,
    supplement: number,
    totalEarnings: number,
  ): Promise<void> {
    await this.fcm.send({
      token: pushToken,
      title: 'Earnings Floor Activated',
      body: `BidRide added $${supplement.toFixed(2)} — your guaranteed take-home: $${totalEarnings.toFixed(2)}`,
      data: { type: 'FLOOR_SUPPLEMENT' },
    });
  }

  async sendDriverWeeklyPayout(
    email: string,
    driverName: string,
    amount: number,
    periodEnd: string,
  ): Promise<void> {
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

  async sendFcraAdverseActionLetter(
    email: string,
    driverName: string,
    checkrReportUrl: string,
  ): Promise<void> {
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
