/**
 * Simple Email Service Test (Without Queue)
 * Run: npx tsx src/modules/notifications/email-service.test-simple.ts
 */

import { initializeEnv } from '../../config/env';
import { loadAppConfig } from '../../config/app-config';
import { createLogger } from '../../lib/logger';
import { EmailService } from './email.service';

// Initialize env first
initializeEnv();

const logger = createLogger({ name: 'EmailServiceTest' });

async function testEmailService() {
  console.log('🧪 Testing Email Service (Simple)...\n');

  try {
    // Initialize
    const config = loadAppConfig();
    const emailService = new EmailService(config, logger);

    // Test 1: Connection
    console.log('Test 1: SMTP Connection');
    const isConnected = await emailService.verifyConnection();
    console.log(`${isConnected ? '✅' : '⚠️'} Connection: ${isConnected ? 'OK' : 'SKIPPED (no SMTP configured)'}\n`);

    // Test 2: Simple Email
    console.log('Test 2: Simple Email');
    const result1 = await emailService.send({
      to: ['test@example.com'],
      subject: 'Test Email from Metrika',
      text: 'Plain text version',
      html: '<h1>HTML Version</h1><p>This is a test email.</p>',
    });
    console.log('Result:', result1);
    console.log('');

    // Test 3: Template Email
    console.log('Test 3: Template Email');
    const result2 = await emailService.sendTemplateEmail({
      to: ['manager@example.com'],
      template: 'task-delayed',
      data: {
        taskTitle: 'Test Task',
        projectName: 'Test Project',
        delayType: 'start',
        delayHours: 24,
        ownerName: 'Test User',
        taskUrl: 'http://localhost:3000/tasks/1',
      },
    });
    console.log('Result:', result2);
    console.log('');

    // Test 4: Batch Emails
    console.log('Test 4: Batch Emails (3 recipients)');
    const batchResults = await emailService.sendBatchTemplateEmails('welcome', [
      { to: ['user1@example.com'], data: { userName: 'User 1', userEmail: 'user1@example.com', userRole: 'PM', appUrl: 'http://localhost:3000' } },
      { to: ['user2@example.com'], data: { userName: 'User 2', userEmail: 'user2@example.com', userRole: 'Dev', appUrl: 'http://localhost:3000' } },
      { to: ['user3@example.com'], data: { userName: 'User 3', userEmail: 'user3@example.com', userRole: 'QA', appUrl: 'http://localhost:3000' } },
    ]);
    console.log(`Results: ${batchResults.filter(r => r.success).length}/3 successful`);
    console.log('');

    await emailService.close();

    console.log('🎉 All tests completed!');
    console.log('📧 Check MailHog: http://localhost:8025');
    console.log('');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testEmailService();
