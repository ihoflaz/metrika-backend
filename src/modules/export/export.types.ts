/**
 * Export module type definitions
 * Supports Excel (.xlsx) and PDF exports for tasks, KPIs, and reports
 */

export enum ExportFormat {
  EXCEL = 'excel',
  PDF = 'pdf',
  CSV = 'csv',
}

export enum ExportType {
  TASKS = 'tasks',
  TASKS_SUMMARY = 'tasks_summary',
  TASK_METRICS = 'task_metrics',
  KPI_REPORT = 'kpi_report',
  KPI_DASHBOARD = 'kpi_dashboard',
  PROJECT_REPORT = 'project_report',
  PORTFOLIO_SUMMARY = 'portfolio_summary',
  GANTT_CHART = 'gantt_chart',
  AUDIT_LOG = 'audit_log',
}

export interface ExportOptions {
  format: ExportFormat;
  type: ExportType;
  filters?: ExportFilters;
  styling?: ExportStyling;
  metadata?: ExportMetadata;
}

export interface ExportFilters {
  projectId?: string;
  startDate?: Date;
  endDate?: Date;
  status?: string[];
  priority?: string[];
  ownerId?: string;
  includeCompleted?: boolean;
  includeArchived?: boolean;
}

export interface ExportStyling {
  includeCharts?: boolean;
  includeImages?: boolean;
  colorScheme?: 'default' | 'grayscale' | 'highcontrast';
  fontSize?: number;
  pageSize?: 'A4' | 'Letter' | 'Legal';
  orientation?: 'portrait' | 'landscape';
}

export interface ExportMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  createdAt?: Date;
  exportedBy?: string;
}

export interface ExportResult {
  success: boolean;
  format: ExportFormat;
  type: ExportType;
  buffer?: Buffer;
  filePath?: string;
  fileName: string;
  mimeType: string;
  size: number;
  error?: string;
}

// Excel-specific types
export interface ExcelWorkbookOptions {
  creator?: string;
  lastModifiedBy?: string;
  created?: Date;
  modified?: Date;
  properties?: {
    title?: string;
    subject?: string;
    keywords?: string;
    category?: string;
    description?: string;
  };
}

export interface ExcelSheetConfig {
  name: string;
  data: any[];
  columns: ExcelColumnConfig[];
  styling?: ExcelSheetStyling;
  autoFilter?: boolean;
  freezePane?: { row?: number; col?: number };
}

export interface ExcelColumnConfig {
  header: string;
  key: string;
  width?: number;
  style?: any;
  format?: string; // e.g., 'dd/mm/yyyy', '#,##0.00'
}

export interface ExcelSheetStyling {
  headerStyle?: any;
  evenRowStyle?: any;
  oddRowStyle?: any;
  totalRowStyle?: any;
}

// PDF-specific types
export interface PDFOptions {
  format?: 'A4' | 'Letter' | 'Legal';
  orientation?: 'portrait' | 'landscape';
  margin?: {
    top?: string;
    right?: string;
    bottom?: string;
    left?: string;
  };
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  printBackground?: boolean;
  scale?: number;
}

export interface PDFTemplateData {
  title: string;
  subtitle?: string;
  date: string;
  author?: string;
  content: any;
  metadata?: Record<string, any>;
}

// Task export specific types
export interface TaskExportData {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  owner: string;
  project: string;
  plannedStart?: Date;
  plannedEnd?: Date;
  actualStart?: Date;
  actualEnd?: Date;
  progress: number;
  estimatedHours?: number;
  loggedHours?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskExportSummary {
  totalTasks: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  completionRate: number;
  averageProgress: number;
  onTimeRate: number;
  delayedTasks: number;
}

// KPI export specific types
export interface KPIExportData {
  id: string;
  code: string;
  name: string;
  category: string;
  owner: string;
  targetValue: number;
  actualValue: number;
  unit: string;
  status: string;
  variance: number;
  variancePercentage: number;
  trend: 'up' | 'down' | 'stable';
  lastUpdated: Date;
}

export interface KPIExportSummary {
  totalKPIs: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
  achievementRate: number;
  criticalKPIs: number;
  breachedKPIs: number;
}

// Chart data types
export interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'doughnut' | 'scatter';
  labels: string[];
  datasets: ChartDataset[];
  options?: any;
}

export interface ChartDataset {
  label: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string | string[];
  borderWidth?: number;
}
