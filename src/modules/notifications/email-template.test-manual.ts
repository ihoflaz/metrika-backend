/**
 * Manual test for Email Template Service
 * Run: npx tsx src/modules/notifications/email-template.test-manual.ts
 */
import { emailTemplateService } from './email-template.service';

async function testEmailTemplates() {
  console.log('🧪 Testing Email Template Service...\n');

  try {
    // Test 1: Task Delayed Template
    console.log('Test 1: Task Delayed Template');
    const taskDelayedResult = await emailTemplateService.renderEmail('task-delayed', {
      taskTitle: 'Implement BullMQ Integration',
      projectName: 'Metrika Backend',
      delayType: 'start',
      delayHours: 48,
      ownerName: 'John Doe',
      taskUrl: 'http://localhost:3000/tasks/123',
    });
    console.log('✅ Subject:', taskDelayedResult.subject);
    console.log('✅ HTML length:', taskDelayedResult.html.length);
    console.log('✅ Text length:', taskDelayedResult.text?.length || 0);
    console.log('');

    // Test 2: KPI Breach Template
    console.log('Test 2: KPI Breach Template');
    const kpiBreachResult = await emailTemplateService.renderEmail('kpi-breach', {
      kpiName: 'Project Completion Rate',
      kpiCode: 'PCR-2025',
      target: 95.0,
      actual: 72.5,
      deviation: -23.68,
      threshold: 'critical',
      taskUrl: 'http://localhost:3000/tasks/789',
    });
    console.log('✅ Subject:', kpiBreachResult.subject);
    console.log('✅ HTML length:', kpiBreachResult.html.length);
    console.log('');

    // Test 3: Document Approval Reminder
    console.log('Test 3: Document Approval Reminder');
    const docReminderResult = await emailTemplateService.renderEmail('document-approval-reminder', {
      documentTitle: 'Project Charter v2.0',
      documentType: 'Charter',
      version: '2.0',
      uploaderName: 'Alice Smith',
      pendingDays: 5,
      documentUrl: 'http://localhost:3000/documents/doc-123',
    });
    console.log('✅ Subject:', docReminderResult.subject);
    console.log('✅ HTML length:', docReminderResult.html.length);
    console.log('');

    // Test 4: Welcome Template
    console.log('Test 4: Welcome Template');
    const welcomeResult = await emailTemplateService.renderEmail('welcome', {
      userName: 'John Doe',
      userEmail: 'john.doe@example.com',
      userRole: 'Project Manager',
      appUrl: 'http://localhost:3000',
    });
    console.log('✅ Subject:', welcomeResult.subject);
    console.log('✅ HTML length:', welcomeResult.html.length);
    console.log('');

    // Test 5: Batch Rendering
    console.log('Test 5: Batch Rendering');
    const dataArray = [
      { taskTitle: 'Task 1', projectName: 'Project A', delayHours: 24, delayType: 'start', ownerName: 'User 1', taskUrl: 'http://localhost:3000/tasks/1' },
      { taskTitle: 'Task 2', projectName: 'Project B', delayHours: 48, delayType: 'end', ownerName: 'User 2', taskUrl: 'http://localhost:3000/tasks/2' },
      { taskTitle: 'Task 3', projectName: 'Project C', delayHours: 72, delayType: 'start', ownerName: 'User 3', taskUrl: 'http://localhost:3000/tasks/3' },
    ];
    const batchResults = await emailTemplateService.renderBatch('task-delayed', dataArray);
    console.log('✅ Batch rendering completed:', batchResults.length, 'emails');
    console.log('');

    // Test 6: Cache Performance
    console.log('Test 6: Cache Performance');
    const start1 = Date.now();
    await emailTemplateService.renderEmail('task-delayed', { taskTitle: 'Cache Test' });
    const duration1 = Date.now() - start1;

    const start2 = Date.now();
    await emailTemplateService.renderEmail('task-delayed', { taskTitle: 'Cache Test' });
    const duration2 = Date.now() - start2;

    console.log('✅ First render:', duration1, 'ms');
    console.log('✅ Cached render:', duration2, 'ms');
    console.log('✅ Cache speedup:', (duration1 / duration2).toFixed(2) + 'x');
    console.log('');

    console.log('🎉 All tests passed!\n');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testEmailTemplates();
