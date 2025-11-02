import winston from 'winston';
import SlackHook from 'winston-slack-webhook-transport';
import { Logger } from 'pino';
import { EmailService } from '../modules/notifications/email.service';

/**
 * Alert severity levels
 */
export enum AlertLevel {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

/**
 * Alert category for deduplication
 */
export enum AlertCategory {
  QUEUE_HEALTH = 'queue_health',
  EMAIL_DELIVERY = 'email_delivery',
  SYSTEM_HEALTH = 'system_health',
  SECURITY = 'security',
  PERFORMANCE = 'performance',
}

/**
 * Alert payload
 */
export interface Alert {
  level: AlertLevel;
  category: AlertCategory;
  title: string;
  message: string;
  metadata?: Record<string, any>;
  timestamp?: Date;
}

/**
 * Alert configuration
 */
export interface AlertConfig {
  slack?: {
    webhookUrl: string;
    channel?: string;
    username?: string;
    iconEmoji?: string;
  };
  email?: {
    enabled: boolean;
    recipients: string[];
  };
  deduplication?: {
    enabled: boolean;
    windowMs: number; // Deduplication window in milliseconds
  };
}

/**
 * Alert deduplication key
 */
interface DeduplicationKey {
  category: AlertCategory;
  title: string;
  level: AlertLevel;
}

/**
 * Alert service for sending notifications via Slack, Email, etc.
 */
export class AlertService {
  private logger: winston.Logger;
  private emailService?: EmailService;
  private config: AlertConfig;
  private alertCache: Map<string, number> = new Map(); // key -> timestamp
  private pinoLogger?: Logger;

  constructor(config: AlertConfig, emailService?: EmailService, pinoLogger?: Logger) {
    this.config = config;
    this.emailService = emailService;
    this.pinoLogger = pinoLogger;

    // Create Winston logger with transports
    const transports: winston.transport[] = [];

    // Console transport (always enabled)
    transports.push(
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp(),
          winston.format.printf((info: any) => {
            const { timestamp, level, message, ...meta } = info;
            const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
            return `${timestamp} [${level}]: ${message} ${metaStr}`;
          })
        ),
      })
    );

    // Slack transport (if configured)
    if (config.slack?.webhookUrl) {
      transports.push(
        new SlackHook({
          webhookUrl: config.slack.webhookUrl,
          channel: config.slack.channel || '#alerts',
          username: config.slack.username || 'Metrika Alert Bot',
          iconEmoji: config.slack.iconEmoji || ':rotating_light:',
          formatter: (info) => this.formatSlackMessage(info),
        })
      );
    }

    this.logger = winston.createLogger({
      level: 'info',
      transports,
    });

    // Clean up old cache entries every 5 minutes
    if (config.deduplication?.enabled) {
      setInterval(() => this.cleanupCache(), 5 * 60 * 1000);
    }
  }

  /**
   * Send an alert
   */
  async sendAlert(alert: Alert): Promise<void> {
    // Add timestamp if not provided
    alert.timestamp = alert.timestamp || new Date();

    // Check deduplication
    if (this.config.deduplication?.enabled && this.isDuplicate(alert)) {
      this.pinoLogger?.debug(
        { alert },
        `Alert deduplicated: ${alert.category}:${alert.title}`
      );
      return;
    }

    // Log to Winston (console + Slack)
    this.logToWinston(alert);

    // Send email alert (for critical alerts or if configured)
    if (this.shouldSendEmail(alert)) {
      await this.sendEmailAlert(alert);
    }

    // Update deduplication cache
    if (this.config.deduplication?.enabled) {
      this.updateCache(alert);
    }

    // Log to Pino (for audit trail)
    if (this.pinoLogger) {
      const logData = {
        alertCategory: alert.category,
        alertTitle: alert.title,
        alertMetadata: alert.metadata,
      };

      // Map alert levels to Pino log methods
      switch (alert.level) {
        case AlertLevel.INFO:
          this.pinoLogger.info(logData, alert.message);
          break;
        case AlertLevel.WARNING:
          this.pinoLogger.warn(logData, alert.message);
          break;
        case AlertLevel.CRITICAL:
          this.pinoLogger.error(logData, alert.message);
          break;
      }
    }
  }

  /**
   * Convenience methods for different alert levels
   */
  async info(category: AlertCategory, title: string, message: string, metadata?: Record<string, any>) {
    await this.sendAlert({
      level: AlertLevel.INFO,
      category,
      title,
      message,
      metadata,
    });
  }

  async warning(category: AlertCategory, title: string, message: string, metadata?: Record<string, any>) {
    await this.sendAlert({
      level: AlertLevel.WARNING,
      category,
      title,
      message,
      metadata,
    });
  }

  async critical(category: AlertCategory, title: string, message: string, metadata?: Record<string, any>) {
    await this.sendAlert({
      level: AlertLevel.CRITICAL,
      category,
      title,
      message,
      metadata,
    });
  }

  /**
   * Check if alert is duplicate (within deduplication window)
   */
  private isDuplicate(alert: Alert): boolean {
    const key = this.getDeduplicationKey(alert);
    const lastAlertTime = this.alertCache.get(key);

    if (!lastAlertTime) {
      return false;
    }

    const now = Date.now();
    const windowMs = this.config.deduplication?.windowMs || 5 * 60 * 1000; // Default 5 minutes

    return now - lastAlertTime < windowMs;
  }

  /**
   * Update deduplication cache
   */
  private updateCache(alert: Alert): void {
    const key = this.getDeduplicationKey(alert);
    this.alertCache.set(key, Date.now());
  }

  /**
   * Get deduplication key from alert
   */
  private getDeduplicationKey(alert: Alert): string {
    return `${alert.category}:${alert.level}:${alert.title}`;
  }

  /**
   * Clean up old cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    const windowMs = this.config.deduplication?.windowMs || 5 * 60 * 1000;

    for (const [key, timestamp] of this.alertCache.entries()) {
      if (now - timestamp > windowMs) {
        this.alertCache.delete(key);
      }
    }
  }

  /**
   * Check if email should be sent for this alert
   */
  private shouldSendEmail(alert: Alert): boolean {
    if (!this.config.email?.enabled || !this.emailService) {
      return false;
    }

    // Always send email for critical alerts
    if (alert.level === AlertLevel.CRITICAL) {
      return true;
    }

    // Send email for specific categories (optional customization)
    const emailCategories = [
      AlertCategory.SECURITY,
      AlertCategory.SYSTEM_HEALTH,
    ];

    return emailCategories.includes(alert.category);
  }

  /**
   * Send email alert
   */
  private async sendEmailAlert(alert: Alert): Promise<void> {
    if (!this.emailService || !this.config.email?.recipients) {
      return;
    }

    try {
      const subject = `[${alert.level.toUpperCase()}] ${alert.title}`;
      const html = this.formatEmailHtml(alert);

      await this.emailService.send({
        to: this.config.email.recipients,
        subject,
        html,
        text: alert.message,
      });

      this.pinoLogger?.info(
        { alertTitle: alert.title, recipients: this.config.email.recipients },
        'Email alert sent'
      );
    } catch (error) {
      this.pinoLogger?.error(
        { error, alertTitle: alert.title },
        'Failed to send email alert'
      );
    }
  }

  /**
   * Log alert to Winston (console + Slack)
   */
  private logToWinston(alert: Alert): void {
    const logData = {
      category: alert.category,
      title: alert.title,
      message: alert.message,
      metadata: alert.metadata,
      timestamp: alert.timestamp,
    };

    switch (alert.level) {
      case AlertLevel.INFO:
        this.logger.info(logData);
        break;
      case AlertLevel.WARNING:
        this.logger.warn(logData);
        break;
      case AlertLevel.CRITICAL:
        this.logger.error(logData);
        break;
    }
  }

  /**
   * Format Slack message
   */
  private formatSlackMessage(info: any): any {
    const emoji = this.getEmojiForLevel(info.level);
    const color = this.getColorForLevel(info.level);

    return {
      text: `${emoji} *${info.title || 'Alert'}*`,
      attachments: [
        {
          color,
          fields: [
            {
              title: 'Level',
              value: info.level.toUpperCase(),
              short: true,
            },
            {
              title: 'Category',
              value: info.category || 'N/A',
              short: true,
            },
            {
              title: 'Message',
              value: info.message || 'N/A',
              short: false,
            },
            ...(info.metadata
              ? Object.entries(info.metadata).map(([key, value]) => ({
                  title: key,
                  value: typeof value === 'object' ? JSON.stringify(value) : String(value),
                  short: true,
                }))
              : []),
          ],
          footer: 'Metrika Backend',
          ts: Math.floor((info.timestamp?.getTime() || Date.now()) / 1000),
        },
      ],
    };
  }

  /**
   * Format email HTML
   */
  private formatEmailHtml(alert: Alert): string {
    const emoji = this.getEmojiForLevel(alert.level);
    const color = this.getColorForLevel(alert.level);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: ${color}; color: white; padding: 20px; border-radius: 5px 5px 0 0; }
    .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none; border-radius: 0 0 5px 5px; }
    .field { margin-bottom: 15px; }
    .label { font-weight: bold; color: #555; }
    .value { margin-top: 5px; padding: 10px; background-color: white; border-left: 3px solid ${color}; }
    .metadata { background-color: #f0f0f0; padding: 10px; border-radius: 3px; font-family: monospace; font-size: 12px; }
    .footer { margin-top: 20px; text-align: center; color: #999; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>${emoji} ${alert.title}</h2>
    </div>
    <div class="content">
      <div class="field">
        <div class="label">Level:</div>
        <div class="value">${alert.level.toUpperCase()}</div>
      </div>
      <div class="field">
        <div class="label">Category:</div>
        <div class="value">${alert.category}</div>
      </div>
      <div class="field">
        <div class="label">Message:</div>
        <div class="value">${alert.message}</div>
      </div>
      ${
        alert.metadata
          ? `
      <div class="field">
        <div class="label">Additional Information:</div>
        <div class="metadata">${JSON.stringify(alert.metadata, null, 2)}</div>
      </div>
      `
          : ''
      }
      <div class="field">
        <div class="label">Time:</div>
        <div class="value">${alert.timestamp?.toISOString() || new Date().toISOString()}</div>
      </div>
    </div>
    <div class="footer">
      Metrika Backend Alert System
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Get emoji for alert level
   */
  private getEmojiForLevel(level: string): string {
    switch (level) {
      case AlertLevel.INFO:
        return 'ℹ️';
      case AlertLevel.WARNING:
        return '⚠️';
      case AlertLevel.CRITICAL:
        return '🚨';
      default:
        return '📢';
    }
  }

  /**
   * Get color for alert level
   */
  private getColorForLevel(level: string): string {
    switch (level) {
      case AlertLevel.INFO:
        return '#36a64f'; // Green
      case AlertLevel.WARNING:
        return '#ff9800'; // Orange
      case AlertLevel.CRITICAL:
        return '#f44336'; // Red
      default:
        return '#2196f3'; // Blue
    }
  }

  /**
   * Get alert statistics
   */
  getStats(): {
    cacheSize: number;
    deduplicationEnabled: boolean;
    emailEnabled: boolean;
    slackEnabled: boolean;
  } {
    return {
      cacheSize: this.alertCache.size,
      deduplicationEnabled: this.config.deduplication?.enabled || false,
      emailEnabled: this.config.email?.enabled || false,
      slackEnabled: !!this.config.slack?.webhookUrl,
    };
  }

  /**
   * Clear deduplication cache (for testing)
   */
  clearCache(): void {
    this.alertCache.clear();
  }
}

/**
 * Create AlertService from environment variables
 */
export function createAlertService(
  emailService?: EmailService,
  pinoLogger?: Logger
): AlertService {
  const config: AlertConfig = {
    slack: process.env.ALERT_SLACK_WEBHOOK_URL
      ? {
          webhookUrl: process.env.ALERT_SLACK_WEBHOOK_URL,
          channel: process.env.ALERT_SLACK_CHANNEL || '#alerts',
          username: process.env.ALERT_SLACK_USERNAME || 'Metrika Alert Bot',
          iconEmoji: process.env.ALERT_SLACK_ICON || ':rotating_light:',
        }
      : undefined,
    email: {
      enabled: process.env.ALERT_EMAIL_ENABLED === 'true',
      recipients: process.env.ALERT_EMAIL_RECIPIENTS?.split(',') || [],
    },
    deduplication: {
      enabled: process.env.ALERT_DEDUPLICATION_ENABLED !== 'false', // Default true
      windowMs: parseInt(process.env.ALERT_DEDUPLICATION_WINDOW_MS || '300000'), // Default 5min
    },
  };

  return new AlertService(config, emailService, pinoLogger);
}
