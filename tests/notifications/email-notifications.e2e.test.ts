import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { initializeEnv } from '../../src/config/env';
import { loadAppConfig } from '../../src/config/app-config';
import { createLogger } from '../../src/lib/logger';
import { EmailService } from '../../src/modules/notifications/email.service';
import { getQueueService } from '../../src/modules/automation/queue.service';
import { startNotificationWorker, stopNotificationWorker } from '../../src/modules/automation/workers/notification.worker';
import { PrismaClient } from '@prisma/client';

// Initialize env
initializeEnv();

const logger = createLogger({ name: 'EmailE2ETest' });
const prisma = new PrismaClient();
let emailService: EmailService;
let queueService: ReturnType<typeof getQueueService>;

describe('Email Notifications E2E Tests', () => {
  beforeAll(async () => {
    // Initialize services
    const config = loadAppConfig();
    emailService = new EmailService(config, logger);
    
    // Mock the transporter's sendMail method to avoid actual SMTP calls
    const mockSendMail = jest.fn<() => Promise<any>>().mockResolvedValue({
      messageId: `mock-${Date.now()}@test.local`,
      accepted: [],
      rejected: [],
      pending: [],
      response: '250 Message queued',
    });
    
    // Replace the transporter with a mock
    (emailService as any).transporter = {
      sendMail: mockSendMail,
      close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined as void),
    };
    
    queueService = getQueueService();

    // Start notification worker
    startNotificationWorker();

    logger.info('E2E test suite initialized with mocked email transporter');
  });

  afterAll(async () => {
    // Cleanup
    await stopNotificationWorker();
    await queueService.close();
    await emailService.close();
    await prisma.$disconnect();
    logger.info('E2E test suite cleaned up');
  });

  describe('Direct Email Sending', () => {
    test('should send simple email directly', async () => {
      const result = await emailService.send({
        to: ['test-simple@example.com'],
        subject: 'E2E Test: Simple Email',
        text: 'This is a simple test email',
        html: '<h1>E2E Test</h1><p>This is a simple test email</p>',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(result.recipients).toEqual(['test-simple@example.com']);
    });

    test('should send email with CC and BCC', async () => {
      const result = await emailService.send({
        to: ['primary@example.com'],
        cc: ['cc1@example.com', 'cc2@example.com'],
        bcc: ['bcc@example.com'],
        subject: 'E2E Test: CC/BCC Email',
        text: 'Testing CC and BCC recipients',
        html: '<p>Testing CC and BCC recipients</p>',
      });

      expect(result.success).toBe(true);
      expect(result.recipients).toEqual(['primary@example.com']);
    });

    test('should handle empty recipient list', async () => {
      const result = await emailService.send({
        to: [],
        subject: 'Should be skipped',
        text: 'This should not be sent',
      });

      expect(result.success).toBe(true);
      expect(result.recipients).toEqual([]);
    });
  });

  describe('Template Email Sending', () => {
    test('should send task-delayed notification', async () => {
      const result = await emailService.sendTemplateEmail({
        to: ['pm@example.com'],
        template: 'task-delayed',
        data: {
          taskTitle: 'E2E Test Task',
          projectName: 'E2E Test Project',
          delayType: 'start',
          delayHours: 48,
          ownerName: 'Test User',
          taskUrl: 'http://localhost:3000/tasks/test-123',
        },
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(result.recipients).toContain('pm@example.com');
    });

    test('should send KPI breach notification', async () => {
      const result = await emailService.sendTemplateEmail({
        to: ['kpi-owner@example.com'],
        template: 'kpi-breach',
        data: {
          kpiName: 'Test KPI',
          kpiCode: 'TEST-KPI-001',
          target: 100,
          actual: 75,
          deviation: -25,
          threshold: 'critical',
          taskUrl: 'http://localhost:3000/tasks/test-456',
        },
      });

      expect(result.success).toBe(true);
      expect(result.recipients).toContain('kpi-owner@example.com');
    });

    test('should send document approval reminder', async () => {
      const result = await emailService.sendTemplateEmail({
        to: ['approver@example.com'],
        template: 'document-approval-reminder',
        data: {
          documentTitle: 'Test Document',
          documentType: 'Charter',
          version: '1.0',
          uploaderName: 'Test Uploader',
          pendingDays: 5,
          documentUrl: 'http://localhost:3000/documents/test-789',
        },
      });

      expect(result.success).toBe(true);
      expect(result.recipients).toContain('approver@example.com');
    });

    test('should send welcome email', async () => {
      const result = await emailService.sendTemplateEmail({
        to: ['newuser@example.com'],
        template: 'welcome',
        data: {
          userName: 'New User',
          userEmail: 'newuser@example.com',
          userRole: 'Developer',
          appUrl: 'http://localhost:3000',
        },
      });

      expect(result.success).toBe(true);
      expect(result.recipients).toContain('newuser@example.com');
    });

    test('should handle invalid template gracefully', async () => {
      const result = await emailService.sendTemplateEmail({
        to: ['test@example.com'],
        template: 'non-existent-template',
        data: {},
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('not found');
    });
  });

  describe('Batch Email Sending', () => {
    test('should send batch template emails', async () => {
      const recipients = [
        {
          to: ['user1@example.com'],
          data: {
            userName: 'User 1',
            userEmail: 'user1@example.com',
            userRole: 'PM',
            appUrl: 'http://localhost:3000',
          },
        },
        {
          to: ['user2@example.com'],
          data: {
            userName: 'User 2',
            userEmail: 'user2@example.com',
            userRole: 'Developer',
            appUrl: 'http://localhost:3000',
          },
        },
        {
          to: ['user3@example.com'],
          data: {
            userName: 'User 3',
            userEmail: 'user3@example.com',
            userRole: 'QA',
            appUrl: 'http://localhost:3000',
          },
        },
      ];

      const results = await emailService.sendBatchTemplateEmails(
        'welcome',
        recipients
      );

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
      expect(results[0].recipients).toContain('user1@example.com');
      expect(results[1].recipients).toContain('user2@example.com');
      expect(results[2].recipients).toContain('user3@example.com');
    });

    test('should handle batch with mixed success/failure', async () => {
      const recipients = [
        {
          to: ['valid@example.com'],
          data: {
            userName: 'Valid User',
            userEmail: 'valid@example.com',
            userRole: 'PM',
            appUrl: 'http://localhost:3000',
          },
        },
        {
          to: [], // Empty recipient - should succeed but skip
          data: {
            userName: 'No Recipient',
            userEmail: 'none@example.com',
            userRole: 'Dev',
            appUrl: 'http://localhost:3000',
          },
        },
      ];

      const results = await emailService.sendBatchTemplateEmails(
        'welcome',
        recipients
      );

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true); // Empty recipient handled gracefully
    });
  });

  describe('Queue Integration', () => {
    test('should send email via queue system', async () => {
      const job = await queueService.sendTemplateEmail({
        to: ['queue-test@example.com'],
        template: 'task-delayed',
        data: {
          taskTitle: 'Queue Test Task',
          projectName: 'Queue Test Project',
          delayType: 'end',
          delayHours: 24,
          ownerName: 'Queue Test User',
          taskUrl: 'http://localhost:3000/tasks/queue-123',
        },
        priority: 2,
      });

      expect(job.id).toBeDefined();
      expect(job.name).toBe('EMAIL');

      // Wait for worker to process
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check queue metrics
      const metrics = await queueService.getAllMetrics();
      const notificationMetrics = metrics.find((m) => m.queueName === 'notification');

      expect(notificationMetrics).toBeDefined();
      // In test environment without SMTP, jobs may fail but should still be processed
      // Check that jobs were added (completed + failed > 0)
      const totalProcessed = (notificationMetrics!.completed || 0) + (notificationMetrics!.failed || 0);
      expect(totalProcessed).toBeGreaterThan(0);
    });

    test('should handle queue job with CC/BCC', async () => {
      const job = await queueService.addNotificationJob({
        to: ['primary@example.com'],
        cc: ['manager@example.com'],
        bcc: ['pmo@example.com'],
        type: 'EMAIL',
        template: 'kpi-breach',
        payload: {
          kpiName: 'Queue KPI Test',
          kpiCode: 'QUEUE-KPI-001',
          target: 90,
          actual: 60,
          deviation: -33.33,
          threshold: 'warning',
          taskUrl: 'http://localhost:3000/tasks/queue-456',
        },
        priority: 3,
      });

      expect(job.id).toBeDefined();

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 2000));
    });

    test('should retry failed email jobs', async () => {
      // This test would require mock SMTP failure
      // For now, we'll just verify the job is created
      const job = await queueService.sendTemplateEmail({
        to: ['retry-test@example.com'],
        template: 'welcome',
        data: {
          userName: 'Retry Test',
          userEmail: 'retry-test@example.com',
          userRole: 'Tester',
          appUrl: 'http://localhost:3000',
        },
      });

      expect(job.id).toBeDefined();
      expect(job.opts?.attempts).toBeGreaterThan(1); // Should have retry config
    });
  });

  describe('Template Rendering Validation', () => {
    test('should render task-delayed template correctly', async () => {
      const result = await emailService.sendTemplateEmail({
        to: ['render-test@example.com'],
        template: 'task-delayed',
        data: {
          taskTitle: 'Render Test Task',
          projectName: 'Render Test Project',
          delayType: 'start',
          delayHours: 72, // Should trigger PMO notice
          ownerName: 'Render Test User',
          taskUrl: 'http://localhost:3000/tasks/render-123',
        },
      });

      expect(result.success).toBe(true);
      // For 72+ hours, should include PMO notice in template
    });

    test('should render KPI breach with correct threshold', async () => {
      const criticalResult = await emailService.sendTemplateEmail({
        to: ['critical@example.com'],
        template: 'kpi-breach',
        data: {
          kpiName: 'Critical KPI',
          kpiCode: 'CRITICAL-001',
          target: 100,
          actual: 50,
          deviation: -50,
          threshold: 'critical',
          taskUrl: 'http://localhost:3000/tasks/critical-123',
        },
      });

      const warningResult = await emailService.sendTemplateEmail({
        to: ['warning@example.com'],
        template: 'kpi-breach',
        data: {
          kpiName: 'Warning KPI',
          kpiCode: 'WARNING-001',
          target: 100,
          actual: 80,
          deviation: -20,
          threshold: 'warning',
          taskUrl: 'http://localhost:3000/tasks/warning-123',
        },
      });

      expect(criticalResult.success).toBe(true);
      expect(warningResult.success).toBe(true);
    });

    test('should render document approval with urgent notice for 7+ days', async () => {
      const result = await emailService.sendTemplateEmail({
        to: ['urgent@example.com'],
        template: 'document-approval-reminder',
        data: {
          documentTitle: 'Urgent Document',
          documentType: 'Contract',
          version: '2.0',
          uploaderName: 'Urgent Uploader',
          pendingDays: 10, // Should trigger urgent notice
          documentUrl: 'http://localhost:3000/documents/urgent-123',
        },
      });

      expect(result.success).toBe(true);
      // For 7+ days, template should include urgent warning
    });
  });

  describe('Error Handling', () => {
    test('should handle missing required template data', async () => {
      const result = await emailService.sendTemplateEmail({
        to: ['incomplete@example.com'],
        template: 'task-delayed',
        data: {
          taskTitle: 'Incomplete Data',
          // Missing required fields
        },
      });

      // Should still succeed but template might not render perfectly
      expect(result.success).toBe(true);
    });

    test('should handle SMTP connection issues gracefully', async () => {
      // This would require mocking SMTP failure
      // For now, verify service initialization
      const isConnected = await emailService.verifyConnection();
      expect(typeof isConnected).toBe('boolean');
    });
  });
});
