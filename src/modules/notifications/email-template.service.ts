import * as Handlebars from 'handlebars';
import * as fs from 'fs/promises';
import * as path from 'path';
import { LRUCache } from 'lru-cache';
import { logger } from '../../lib/logger';

export interface EmailTemplate {
  subject: string;
  html: string;
  text?: string;
}

export interface TemplateData {
  [key: string]: any;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
  itemCount: number;
  maxItems: number;
  hitRate: number;
}

export class EmailTemplateService {
  private templateCache: LRUCache<string, HandlebarsTemplateDelegate>;
  private readonly templatesDir: string;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor() {
    this.templatesDir = path.join(__dirname, '..', '..', '..', 'templates', 'emails');
    
    // LRU cache with TTL and size limits
    this.templateCache = new LRUCache<string, HandlebarsTemplateDelegate>({
      max: 100, // Maximum 100 templates
      ttl: 1000 * 60 * 60, // 1 hour TTL
      maxSize: 50 * 1024 * 1024, // 50MB max memory
      sizeCalculation: (value, key) => {
        // Estimate template size (compiled function + key)
        return key.length + 10000; // ~10KB per compiled template
      },
      updateAgeOnGet: true, // Refresh TTL on access
      updateAgeOnHas: false,
    });

    this.registerHelpers();
    
    // Warm cache on startup (async, non-blocking)
    this.warmCache().catch((error: unknown) => {
      logger.warn({ error }, 'Failed to warm template cache');
    });
  }

  /**
   * Handlebars helper'ları kaydet
   */
  private registerHelpers() {
    // Tarih formatlama
    Handlebars.registerHelper('formatDate', (date: Date | string) => {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleDateString('tr-TR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    });

    // Sayı formatlama
    Handlebars.registerHelper('formatNumber', (num: number, decimals = 0) => {
      if (num === undefined || num === null) return '0';
      return num.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    });

    // Yüzde formatlama
    Handlebars.registerHelper('formatPercent', (num: number) => {
      if (num === undefined || num === null) return '0%';
      return `${num.toFixed(1)}%`;
    });

    // Priority badge color
    Handlebars.registerHelper('priorityColor', (priority: string) => {
      const colors: Record<string, string> = {
        CRITICAL: '#DC2626',
        HIGH: '#EA580C',
        MEDIUM: '#F59E0B',
        LOW: '#10B981',
      };
      return colors[priority] || '#6B7280';
    });

    // Status badge color
    Handlebars.registerHelper('statusColor', (status: string) => {
      const colors: Record<string, string> = {
        DRAFT: '#9CA3AF',
        PLANNED: '#3B82F6',
        IN_PROGRESS: '#8B5CF6',
        BLOCKED: '#EF4444',
        ON_HOLD: '#F59E0B',
        COMPLETED: '#10B981',
        CANCELLED: '#6B7280',
      };
      return colors[status] || '#6B7280';
    });

    // String karşılaştırma
    Handlebars.registerHelper('eq', (a: any, b: any) => a === b);
    Handlebars.registerHelper('gt', (a: number, b: number) => a > b);
    Handlebars.registerHelper('lt', (a: number, b: number) => a < b);
  }

  /**
   * Template'i dosyadan yükle ve cache'e al
   */
  private async loadTemplate(templateName: string): Promise<HandlebarsTemplateDelegate> {
    // Cache'de var mı?
    const cached = this.templateCache.get(templateName);
    if (cached) {
      this.cacheHits++;
      logger.debug({ templateName, cacheHits: this.cacheHits }, 'Template cache hit');
      return cached;
    }

    this.cacheMisses++;
    logger.debug({ templateName, cacheMisses: this.cacheMisses }, 'Template cache miss');

    // Dosyadan oku
    const templatePath = path.join(this.templatesDir, `${templateName}.hbs`);
    try {
      const templateSource = await fs.readFile(templatePath, 'utf-8');
      const compiledTemplate = Handlebars.compile(templateSource);

      // Cache'e ekle
      this.templateCache.set(templateName, compiledTemplate);

      logger.info({ templateName }, 'Email template loaded and cached');
      return compiledTemplate;
    } catch (error) {
      logger.error({ templateName, error }, 'Failed to load email template');
      throw new Error(`Email template not found: ${templateName}`);
    }
  }

  /**
   * Template'i render et
   */
  async render(templateName: string, data: TemplateData): Promise<string> {
    const template = await this.loadTemplate(templateName);
    return template(data);
  }

  /**
   * Email render et (subject + body)
   */
  async renderEmail(
    templateName: string,
    data: TemplateData
  ): Promise<EmailTemplate> {
    const html = await this.render(templateName, data);

    // Subject'i HTML'den çıkar (meta tag)
    const subjectMatch = html.match(/<meta name="subject" content="([^"]+)"\s*\/?>/);
    const subject = subjectMatch ? subjectMatch[1] : `Metrika - ${templateName}`;

    // Plain text version oluştur (HTML tag'lerini kaldır)
    const text = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return { subject, html, text };
  }

  /**
   * Cache'i temizle (development'ta kullanışlı)
   */
  clearCache() {
    this.templateCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    logger.info('Email template cache cleared');
  }

  /**
   * Cache metrics'leri al
   */
  getCacheMetrics(): CacheMetrics {
    const hitRate = this.cacheHits + this.cacheMisses > 0 
      ? (this.cacheHits / (this.cacheHits + this.cacheMisses)) * 100 
      : 0;

    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      size: this.templateCache.size,
      maxSize: this.templateCache.maxSize || 0,
      itemCount: this.templateCache.size,
      maxItems: this.templateCache.max,
      hitRate: Math.round(hitRate * 100) / 100, // Round to 2 decimals
    };
  }

  /**
   * Cache'i önceden yükle (sık kullanılan template'ler)
   */
  private async warmCache(): Promise<void> {
    const commonTemplates = [
      'task-delayed',
      'kpi-breach',
      'welcome',
      'document-approval-reminder',
      'task-assigned',
      'task-completed',
    ];

    logger.info({ templates: commonTemplates }, 'Warming email template cache...');

    const results = await Promise.allSettled(
      commonTemplates.map(async (templateName) => {
        try {
          await this.loadTemplate(templateName);
          return { templateName, success: true };
        } catch (error) {
          logger.warn({ templateName, error }, 'Failed to warm cache for template');
          return { templateName, success: false };
        }
      })
    );

    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    logger.info(
      { total: commonTemplates.length, success: successCount },
      'Template cache warming completed'
    );
  }

  /**
   * Batch rendering (performans için)
   */
  async renderBatch(
    templateName: string,
    dataArray: TemplateData[]
  ): Promise<EmailTemplate[]> {
    // Template'i bir kez yükle
    const template = await this.loadTemplate(templateName);

    // Hepsini render et
    return dataArray.map((data) => {
      const html = template(data);
      const subjectMatch = html.match(/<meta name="subject" content="([^"]+)"\s*\/?>/);
      const subject = subjectMatch ? subjectMatch[1] : `Metrika - ${templateName}`;
      const text = html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      return { subject, html, text };
    });
  }
}

// Singleton instance
export const emailTemplateService = new EmailTemplateService();
