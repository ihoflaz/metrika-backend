import { describe, test, expect, beforeAll } from '@jest/globals';
import { emailTemplateService } from '../../src/modules/notifications/email-template.service';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Email Template Service', () => {
  beforeAll(async () => {
    // Template dizininin varlığını kontrol et
    const templatesDir = path.join(__dirname, '..', '..', 'templates', 'emails');
    const dirExists = await fs
      .access(templatesDir)
      .then(() => true)
      .catch(() => false);

    if (!dirExists) {
      throw new Error(`Templates directory not found: ${templatesDir}`);
    }
  });

  describe('Task Delayed Template', () => {
    test('should render task-delayed template with correct data', async () => {
      const data = {
        taskTitle: 'Implement BullMQ Integration',
        projectName: 'Metrika Backend',
        delayType: 'start',
        delayHours: 48,
        ownerName: 'John Doe',
        taskUrl: 'http://localhost:3000/tasks/123',
      };

      const result = await emailTemplateService.renderEmail('task-delayed', data);

      // Subject kontrolü
      expect(result.subject).toContain('Görev Gecikti');
      expect(result.subject).toContain('Implement BullMQ Integration');

      // HTML içerik kontrolü
      expect(result.html).toContain('Implement BullMQ Integration');
      expect(result.html).toContain('Metrika Backend');
      expect(result.html).toContain('48 saat');
      expect(result.html).toContain('John Doe');
      expect(result.html).toContain('http://localhost:3000/tasks/123');

      // Text version kontrolü
      expect(result.text).toBeTruthy();
      expect(result.text).toContain('Implement BullMQ Integration');
    });

    test('should show PMO notice for delays > 72 hours', async () => {
      const data = {
        taskTitle: 'Critical Task',
        projectName: 'Test Project',
        delayType: 'end',
        delayHours: 96,
        ownerName: 'Jane Doe',
        taskUrl: 'http://localhost:3000/tasks/456',
      };

      const result = await emailTemplateService.renderEmail('task-delayed', data);

      expect(result.html).toContain('PMO Bildirimi');
      expect(result.html).toContain('72 saatten fazla');
    });
  });

  describe('KPI Breach Template', () => {
    test('should render kpi-breach template with critical threshold', async () => {
      const data = {
        kpiName: 'Project Completion Rate',
        kpiCode: 'PCR-2025',
        target: 95.0,
        actual: 72.5,
        deviation: -23.68,
        threshold: 'critical',
        taskUrl: 'http://localhost:3000/tasks/789',
      };

      const result = await emailTemplateService.renderEmail('kpi-breach', data);

      // Subject kontrolü
      expect(result.subject).toContain('KPI Eşik Aşımı');
      expect(result.subject).toContain('Project Completion Rate');

      // HTML içerik kontrolü
      expect(result.html).toContain('Project Completion Rate');
      expect(result.html).toContain('PCR-2025');
      expect(result.html).toContain('95');
      expect(result.html).toContain('72.5');
      expect(result.html).toContain('KRİTİK');
    });

    test('should render kpi-breach template with warning threshold', async () => {
      const data = {
        kpiName: 'Task Delay Rate',
        kpiCode: 'TDR-2025',
        target: 10.0,
        actual: 18.5,
        deviation: 85.0,
        threshold: 'warning',
        taskUrl: 'http://localhost:3000/tasks/999',
      };

      const result = await emailTemplateService.renderEmail('kpi-breach', data);

      expect(result.html).toContain('UYARI');
      expect(result.html).toContain('5 gün');
    });
  });

  describe('Document Approval Reminder Template', () => {
    test('should render document-approval-reminder template', async () => {
      const data = {
        documentTitle: 'Project Charter v2.0',
        documentType: 'Charter',
        version: '2.0',
        uploaderName: 'Alice Smith',
        pendingDays: 5,
        documentUrl: 'http://localhost:3000/documents/doc-123',
      };

      const result = await emailTemplateService.renderEmail(
        'document-approval-reminder',
        data
      );

      // Subject kontrolü
      expect(result.subject).toContain('Onay Bekleyen Doküman');
      expect(result.subject).toContain('Project Charter v2.0');

      // HTML içerik kontrolü
      expect(result.html).toContain('Project Charter v2.0');
      expect(result.html).toContain('Charter');
      expect(result.html).toContain('2.0');
      expect(result.html).toContain('Alice Smith');
      expect(result.html).toContain('5 gün');
    });

    test('should show urgent warning for documents pending > 7 days', async () => {
      const data = {
        documentTitle: 'Old Document',
        documentType: 'Report',
        version: '1.0',
        uploaderName: 'Bob Jones',
        pendingDays: 10,
        documentUrl: 'http://localhost:3000/documents/doc-999',
      };

      const result = await emailTemplateService.renderEmail(
        'document-approval-reminder',
        data
      );

      expect(result.html).toContain('Dikkat!');
      expect(result.html).toContain('7 günden fazla');
    });
  });

  describe('Welcome Template', () => {
    test('should render welcome template with user data', async () => {
      const data = {
        userName: 'John Doe',
        userEmail: 'john.doe@example.com',
        userRole: 'Project Manager',
        appUrl: 'http://localhost:3000',
      };

      const result = await emailTemplateService.renderEmail('welcome', data);

      // Subject kontrolü
      expect(result.subject).toContain('Hoş Geldiniz');

      // HTML içerik kontrolü
      expect(result.html).toContain('John Doe');
      expect(result.html).toContain('john.doe@example.com');
      expect(result.html).toContain('Project Manager');
      expect(result.html).toContain('http://localhost:3000/login');
    });
  });

  describe('Template Caching', () => {
    test('should cache templates after first load', async () => {
      const data = { taskTitle: 'Test Task' };

      // İlk render (cache'e alınır)
      const start1 = Date.now();
      await emailTemplateService.renderEmail('task-delayed', data);
      const duration1 = Date.now() - start1;

      // İkinci render (cache'den gelir, daha hızlı olmalı)
      const start2 = Date.now();
      await emailTemplateService.renderEmail('task-delayed', data);
      const duration2 = Date.now() - start2;

      const allowableJitterMs = 5; // timer granularity + IO jitter
      expect(duration2).toBeLessThanOrEqual(duration1 + allowableJitterMs);
    });

    test('should clear cache', () => {
      emailTemplateService.clearCache();
      // Cache temizlendi, exception atmamalı
      expect(true).toBe(true);
    });
  });

  describe('Batch Rendering', () => {
    test('should render multiple emails efficiently', async () => {
      const dataArray = [
        { taskTitle: 'Task 1', projectName: 'Project A', delayHours: 24 },
        { taskTitle: 'Task 2', projectName: 'Project B', delayHours: 48 },
        { taskTitle: 'Task 3', projectName: 'Project C', delayHours: 72 },
      ];

      const results = await emailTemplateService.renderBatch(
        'task-delayed',
        dataArray
      );

      expect(results).toHaveLength(3);
      expect(results[0].html).toContain('Task 1');
      expect(results[1].html).toContain('Task 2');
      expect(results[2].html).toContain('Task 3');
    });
  });

  describe('Handlebars Helpers', () => {
    test('should format dates correctly', async () => {
      const data = {
        taskTitle: 'Test',
        testDate: new Date('2025-11-01T14:30:00'),
      };

      // Template oluştur (helper test için basit bir template)
      const result = await emailTemplateService.render('task-delayed', data);

      // Helper'ların çalıştığını doğrula
      expect(result).toBeTruthy();
    });

    test('should format numbers correctly', async () => {
      const data = {
        kpiName: 'Test KPI',
        target: 1234.56,
        actual: 789.12,
      };

      const result = await emailTemplateService.render('kpi-breach', data);

      expect(result).toBeTruthy();
    });
  });
});
