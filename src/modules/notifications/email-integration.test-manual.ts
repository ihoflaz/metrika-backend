/**
 * Manual test for Email Service Integration
 * Run: npx tsx src/modules/notifications/email-integration.test-manual.ts
 * 
 * Prerequisites:
 * 1. MailHog running on localhost:1025 (or configure SMTP in .env)
 * 2. Redis running on localhost:6379
 * 3. Run: docker-compose up -d metrika-redis metrika-mailhog
 */

import { emailTemplateService } from './email-template.service';
import { loadAppConfig } from '../../config/app-config';
import { createLogger } from '../../lib/logger';
import { EmailService } from './email.service';
import { getQueueService } from '../automation/queue.service';

const logger = createLogger({ name: 'EmailIntegrationTest' });

async function testEmailIntegration() {
  console.log('🧪 Testing Email Service Integration...\n');

  try {
    // Initialize services
    const config = loadAppConfig();
    const emailService = new EmailService(config, logger);
    const queueService = getQueueService();

    // Test 1: EmailService Connection
    console.log('Test 1: Verify SMTP Connection');
    const isConnected = await emailService.verifyConnection();
    console.log(`✅ SMTP Connection: ${isConnected ? 'OK' : 'SKIPPED (not configured)'}\n`);

    // Test 2: Send Simple Email
    console.log('Test 2: Send Simple Email');
    const simpleResult = await emailService.send({
      to: ['test@example.com'],
      subject: 'Test Email',
      text: 'This is a test email from Metrika PMO',
      html: '<h1>Test Email</h1><p>This is a test email from Metrika PMO</p>',
    });
    console.log(`✅ Simple Email Result:`, simpleResult);
    console.log('');

    // Test 3: Send Template Email
    console.log('Test 3: Send Template Email (Task Delayed)');
    const templateResult = await emailService.sendTemplateEmail({
      to: ['pm@example.com'],
      template: 'task-delayed',
      data: {
        taskTitle: 'Implement Email Service',
        projectName: 'Metrika Backend',
        delayType: 'start',
        delayHours: 48,
        ownerName: 'John Doe',
        taskUrl: 'http://localhost:3000/tasks/123',
      },
    });
    console.log(`✅ Template Email Result:`, templateResult);
    console.log('');

    // Test 4: Batch Email Sending
    console.log('Test 4: Batch Email Sending');
    const batchResults = await emailService.sendBatchTemplateEmails('welcome', [
      {
        to: ['user1@example.com'],
        data: {
          userName: 'Alice Smith',
          userEmail: 'user1@example.com',
          userRole: 'Project Manager',
          appUrl: 'http://localhost:3000',
        },
      },
      {
        to: ['user2@example.com'],
        data: {
          userName: 'Bob Jones',
          userEmail: 'user2@example.com',
          userRole: 'Developer',
          appUrl: 'http://localhost:3000',
        },
      },
      {
        to: ['user3@example.com'],
        data: {
          userName: 'Charlie Brown',
          userEmail: 'user3@example.com',
          userRole: 'QA Engineer',
          appUrl: 'http://localhost:3000',
        },
      },
    ]);
    const successCount = batchResults.filter((r) => r.success).length;
    console.log(`✅ Batch Emails: ${successCount}/${batchResults.length} sent successfully`);
    console.log('');

    // Test 5: Email with CC/BCC
    console.log('Test 5: Email with CC/BCC');
    const ccBccResult = await emailService.sendTemplateEmail({
      to: ['primary@example.com'],
      cc: ['manager@example.com'],
      bcc: ['pmo@example.com'],
      template: 'kpi-breach',
      data: {
        kpiName: 'Project Completion Rate',
        kpiCode: 'PCR-2025',
        target: 95.0,
        actual: 72.5,
        deviation: -23.68,
        threshold: 'critical',
        taskUrl: 'http://localhost:3000/tasks/789',
      },
    });
    console.log(`✅ CC/BCC Email Result:`, ccBccResult);
    console.log('');

    // Test 6: Queue Integration
    console.log('Test 6: Queue Integration (Send via Queue)');
    const job = await queueService.sendTemplateEmail({
      to: ['queue-test@example.com'],
      template: 'document-approval-reminder',
      data: {
        documentTitle: 'Project Charter v2.0',
        documentType: 'Charter',
        version: '2.0',
        uploaderName: 'Alice Smith',
        pendingDays: 5,
        documentUrl: 'http://localhost:3000/documents/doc-123',
      },
      priority: 3,
    });
    console.log(`✅ Queue Job Created: ${job.id}`);
    console.log('⏳ Waiting 5 seconds for worker to process...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
    console.log('✅ Check MailHog (http://localhost:8025) for the email');
    console.log('');

    // Test 7: Queue Metrics
    console.log('Test 7: Queue Metrics');
    const metrics = await queueService.getAllMetrics();
    const notificationMetrics = metrics.find((m) => m.queueName === 'notification');
    console.log(`✅ Notification Queue Metrics:`, notificationMetrics);
    console.log('');

    // Cleanup
    await emailService.close();
    await queueService.close();

    console.log('🎉 All email integration tests completed!\n');
    console.log('📧 Check MailHog: http://localhost:8025');
    console.log('');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testEmailIntegration();
