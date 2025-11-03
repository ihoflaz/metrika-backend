import { PrismaClient } from '@prisma/client';
import type { Logger } from '../../lib/logger';
import ExcelJS from 'exceljs';
import { ExportResult, ExportFormat, ExportType } from './export.types';
import { TaskStatus, TaskPriority, Task, Project, User } from '@prisma/client';
import { differenceInDays } from 'date-fns';

interface TaskWithDetails extends Task {
  project: { id: string; name: string; code: string };
  owner: { id: string; fullName: string; email: string };
}

interface TaskMetricsStats {
  totalTasks: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  completionRate: number;
  avgCompletionDays: number;
  delayedTasks: number;
  onTimeTasks: number;
}

interface ProjectTaskMetrics {
  projectId: string;
  projectName: string;
  projectCode: string;
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  delayedTasks: number;
  avgCompletionDays: number;
}

export class TaskMetricsExportService {
  constructor(
    private prisma: PrismaClient,
    private logger: Logger
  ) {}

  /**
   * Export Task Metrics - aggregate view of tasks across projects
   */
  async exportTaskMetrics(userId: string, filters?: {
    projectId?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    startDate?: Date;
    endDate?: Date;
  }): Promise<ExportResult> {
    try {
      this.logger.info({ userId, filters }, '[TaskMetricsExportService] Exporting task metrics');

      // Build where clause
      const where: any = {};

      // Access control: user can see tasks from projects they have access to
      where.project = {
        OR: [
          { sponsorId: userId },
          { pmoOwnerId: userId },
          { members: { some: { userId } } },
        ],
      };

      if (filters?.projectId) {
        where.projectId = filters.projectId;
      }

      if (filters?.status) {
        where.status = filters.status;
      }

      if (filters?.priority) {
        where.priority = filters.priority;
      }

      if (filters?.startDate || filters?.endDate) {
        where.createdAt = {};
        if (filters.startDate) {
          where.createdAt.gte = filters.startDate;
        }
        if (filters.endDate) {
          where.createdAt.lte = filters.endDate;
        }
      }

      // Fetch tasks
      const tasks = await this.prisma.task.findMany({
        where,
        include: {
          project: {
            select: { id: true, name: true, code: true },
          },
          owner: {
            select: { id: true, fullName: true, email: true },
          },
          reporter: {
            select: { id: true, fullName: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const stats = this.calculateTaskMetrics(tasks);
      const projectMetrics = this.calculateProjectMetrics(tasks);

      // Create workbook
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'Metrika PMO';
      workbook.created = new Date();

      // Add sheets
      this.addMetricsSummarySheet(workbook, stats);
      this.addProjectBreakdownSheet(workbook, projectMetrics);
      this.addTaskListSheet(workbook, tasks);
      this.addDelayAnalysisSheet(workbook, tasks);

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      const fileName = `task-metrics-${new Date().toISOString().split('T')[0]}.xlsx`;

      this.logger.info(
        { userId, fileSize: buffer.byteLength },
        '[TaskMetricsExportService] Task metrics exported successfully'
      );

      return {
        success: true,
        format: ExportFormat.EXCEL,
        type: ExportType.TASKS_SUMMARY,
        buffer: buffer as unknown as Buffer,
        fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: buffer.byteLength,
      };
    } catch (error) {
      this.logger.error({ error, userId }, '[TaskMetricsExportService] Failed to export task metrics');
      return {
        success: false,
        format: ExportFormat.EXCEL,
        type: ExportType.TASKS_SUMMARY,
        fileName: '',
        mimeType: '',
        size: 0,
        error: error instanceof Error ? error.message : 'Failed to export task metrics',
      };
    }
  }

  private calculateTaskMetrics(tasks: TaskWithDetails[]): TaskMetricsStats {
    const stats: TaskMetricsStats = {
      totalTasks: tasks.length,
      byStatus: {},
      byPriority: {},
      completionRate: 0,
      avgCompletionDays: 0,
      delayedTasks: 0,
      onTimeTasks: 0,
    };

    let totalCompletionDays = 0;
    let completedCount = 0;

    for (const task of tasks) {
      // Count by status
      stats.byStatus[task.status] = (stats.byStatus[task.status] || 0) + 1;

      // Count by priority
      stats.byPriority[task.priority] = (stats.byPriority[task.priority] || 0) + 1;

      // Completion metrics
      if (task.status === 'COMPLETED' && task.actualEnd) {
        completedCount++;
        const completionDays = differenceInDays(task.actualEnd, task.createdAt);
        totalCompletionDays += completionDays;

        // Check if on time (compare with plannedEnd)
        if (task.plannedEnd) {
          if (task.actualEnd <= task.plannedEnd) {
            stats.onTimeTasks++;
          } else {
            stats.delayedTasks++;
          }
        }
      }

      // Check delayed tasks (not completed but past planned end)
      if (task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && task.plannedEnd) {
        if (new Date() > task.plannedEnd) {
          stats.delayedTasks++;
        }
      }
    }

    stats.completionRate = tasks.length > 0 ? (completedCount / tasks.length) * 100 : 0;
    stats.avgCompletionDays = completedCount > 0 ? totalCompletionDays / completedCount : 0;

    return stats;
  }

  private calculateProjectMetrics(tasks: TaskWithDetails[]): ProjectTaskMetrics[] {
    const projectMap = new Map<string, TaskWithDetails[]>();

    // Group tasks by project
    for (const task of tasks) {
      if (!projectMap.has(task.project.id)) {
        projectMap.set(task.project.id, []);
      }
      projectMap.get(task.project.id)!.push(task);
    }

    // Calculate metrics per project
    const metrics: ProjectTaskMetrics[] = [];

    for (const [projectId, projectTasks] of projectMap.entries()) {
      const completedTasks = projectTasks.filter((t) => t.status === 'COMPLETED').length;
      const delayedTasks = projectTasks.filter((t) => {
        if (t.status === 'COMPLETED' && t.actualEnd && t.plannedEnd) {
          return t.actualEnd > t.plannedEnd;
        }
        if (t.status !== 'COMPLETED' && t.status !== 'CANCELLED' && t.plannedEnd) {
          return new Date() > t.plannedEnd;
        }
        return false;
      }).length;

      const completedWithDates = projectTasks.filter(
        (t) => t.status === 'COMPLETED' && t.actualEnd
      );
      const avgCompletionDays =
        completedWithDates.length > 0
          ? completedWithDates.reduce(
              (sum, t) => sum + differenceInDays(t.actualEnd!, t.createdAt),
              0
            ) / completedWithDates.length
          : 0;

      metrics.push({
        projectId,
        projectName: projectTasks[0].project.name,
        projectCode: projectTasks[0].project.code,
        totalTasks: projectTasks.length,
        completedTasks,
        completionRate: (completedTasks / projectTasks.length) * 100,
        delayedTasks,
        avgCompletionDays,
      });
    }

    return metrics.sort((a, b) => b.totalTasks - a.totalTasks);
  }

  private addMetricsSummarySheet(workbook: ExcelJS.Workbook, stats: TaskMetricsStats): void {
    const sheet = workbook.addWorksheet('Metrics Summary');

    // Title
    sheet.mergeCells('A1:D1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'Task Metrics Summary';
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // Overall metrics
    sheet.addRow([]);
    sheet.addRow(['Overall Metrics']);
    sheet.addRow(['Total Tasks', stats.totalTasks]);
    sheet.addRow(['Completion Rate', `${stats.completionRate.toFixed(2)}%`]);
    sheet.addRow(['Avg. Completion Days', stats.avgCompletionDays.toFixed(1)]);
    sheet.addRow(['Delayed Tasks', stats.delayedTasks]);
    sheet.addRow(['On-Time Tasks', stats.onTimeTasks]);

    // By status
    sheet.addRow([]);
    sheet.addRow(['Distribution by Status']);
    for (const [status, count] of Object.entries(stats.byStatus)) {
      const percentage = ((count / stats.totalTasks) * 100).toFixed(1);
      sheet.addRow([status, count, `${percentage}%`]);
    }

    // By priority
    sheet.addRow([]);
    const priorityRow = sheet.getRow(sheet.rowCount + 1);
    priorityRow.values = ['Distribution by Priority'];
    sheet.addRow(priorityRow.values);
    for (const [priority, count] of Object.entries(stats.byPriority)) {
      const percentage = ((count / stats.totalTasks) * 100).toFixed(1);
      sheet.addRow([priority, count, `${percentage}%`]);
    }

    // Styling
    sheet.getColumn('A').width = 30;
    sheet.getColumn('B').width = 15;
    sheet.getColumn('C').width = 15;

    // Bold section headers
    ['A3', 'A10', `A${sheet.rowCount - Object.keys(stats.byPriority).length}`].forEach((cell) => {
      const c = sheet.getCell(cell);
      if (c.value) {
        c.font = { bold: true };
      }
    });
  }

  private addProjectBreakdownSheet(
    workbook: ExcelJS.Workbook,
    metrics: ProjectTaskMetrics[]
  ): void {
    const sheet = workbook.addWorksheet('By Project');

    // Headers
    sheet.columns = [
      { header: 'Project Code', key: 'code', width: 15 },
      { header: 'Project Name', key: 'name', width: 30 },
      { header: 'Total Tasks', key: 'total', width: 12 },
      { header: 'Completed', key: 'completed', width: 12 },
      { header: 'Completion %', key: 'completion', width: 12 },
      { header: 'Delayed', key: 'delayed', width: 12 },
      { header: 'Avg. Days', key: 'avgDays', width: 12 },
    ];

    // Style header
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add data
    for (const metric of metrics) {
      sheet.addRow({
        code: metric.projectCode,
        name: metric.projectName,
        total: metric.totalTasks,
        completed: metric.completedTasks,
        completion: `${metric.completionRate.toFixed(1)}%`,
        delayed: metric.delayedTasks,
        avgDays: metric.avgCompletionDays.toFixed(1),
      });
    }

    // Conditional formatting for completion rate
    const completionCol = sheet.getColumn('completion');
    completionCol.eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      const value = parseFloat(cell.value as string);
      if (!isNaN(value)) {
        if (value >= 80) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF92D050' },
          };
        } else if (value >= 50) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFC000' },
          };
        } else {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFF0000' },
          };
          cell.font = { color: { argb: 'FFFFFFFF' } };
        }
      }
    });
  }

  private addTaskListSheet(workbook: ExcelJS.Workbook, tasks: TaskWithDetails[]): void {
    const sheet = workbook.addWorksheet('Task List');

    // Headers
    sheet.columns = [
      { header: 'Project', key: 'project', width: 20 },
      { header: 'Task Title', key: 'title', width: 35 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Assigned To', key: 'assignedTo', width: 25 },
      { header: 'Created', key: 'created', width: 15 },
      { header: 'Due Date', key: 'dueDate', width: 15 },
      { header: 'Completed', key: 'completed', width: 15 },
      { header: 'Days to Complete', key: 'daysToComplete', width: 15 },
      { header: 'Delay Status', key: 'delayStatus', width: 12 },
    ];

    // Style header
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };

    // Add data
    for (const task of tasks) {
      const daysToComplete =
        task.status === 'COMPLETED' && task.actualEnd
          ? differenceInDays(task.actualEnd, task.createdAt)
          : null;

      let delayStatus = 'On Time';
      if (task.status === 'COMPLETED' && task.actualEnd && task.plannedEnd) {
        delayStatus = task.actualEnd > task.plannedEnd ? 'Delayed' : 'On Time';
      } else if (task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && task.plannedEnd) {
        delayStatus = new Date() > task.plannedEnd ? 'Overdue' : 'On Track';
      } else {
        delayStatus = 'N/A';
      }

      sheet.addRow({
        project: task.project.name,
        title: task.title,
        status: task.status,
        priority: task.priority,
        assignedTo: task.owner.fullName,
        created: task.createdAt.toISOString().split('T')[0],
        dueDate: task.plannedEnd ? task.plannedEnd.toISOString().split('T')[0] : 'N/A',
        completed: task.actualEnd ? task.actualEnd.toISOString().split('T')[0] : 'N/A',
        daysToComplete: daysToComplete !== null ? daysToComplete : 'N/A',
        delayStatus,
      });
    }

    // Conditional formatting for delay status
    const delayCol = sheet.getColumn('delayStatus');
    delayCol.eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      if (cell.value === 'Delayed' || cell.value === 'Overdue') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFF0000' },
        };
        cell.font = { color: { argb: 'FFFFFFFF' } };
      } else if (cell.value === 'On Time' || cell.value === 'On Track') {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF92D050' },
        };
      }
    });
  }

  private addDelayAnalysisSheet(workbook: ExcelJS.Workbook, tasks: TaskWithDetails[]): void {
    const sheet = workbook.addWorksheet('Delay Analysis');

    // Filter delayed tasks
    const delayedTasks = tasks.filter((task) => {
      if (task.status === 'COMPLETED' && task.actualEnd && task.plannedEnd) {
        return task.actualEnd > task.plannedEnd;
      }
      if (task.status !== 'COMPLETED' && task.status !== 'CANCELLED' && task.plannedEnd) {
        return new Date() > task.plannedEnd;
      }
      return false;
    });

    // Summary
    sheet.addRow(['Delay Analysis Summary']);
    sheet.addRow([]);
    sheet.addRow(['Total Delayed Tasks', delayedTasks.length]);
    sheet.addRow(['Total Tasks', tasks.length]);
    sheet.addRow([
      'Delay Rate',
      `${((delayedTasks.length / tasks.length) * 100).toFixed(2)}%`,
    ]);
    sheet.addRow([]);

    // Delayed tasks table
    sheet.addRow(['Delayed Tasks Details']);
    sheet.addRow([]);

    // Headers
    const headerRow = sheet.getRow(sheet.rowCount + 1);
    headerRow.values = [
      'Project',
      'Task',
      'Priority',
      'Due Date',
      'Status',
      'Days Overdue',
      'Assigned To',
    ];
    headerRow.font = { bold: true };
    sheet.addRow(headerRow.values);

    // Data
    for (const task of delayedTasks) {
      const daysOverdue = task.plannedEnd
        ? differenceInDays(
            task.actualEnd || new Date(),
            task.plannedEnd
          )
        : 0;

      sheet.addRow([
        task.project.name,
        task.title,
        task.priority,
        task.plannedEnd ? task.plannedEnd.toISOString().split('T')[0] : 'N/A',
        task.status,
        daysOverdue > 0 ? daysOverdue : 0,
        task.owner.fullName,
      ]);
    }

    // Column widths
    sheet.getColumn(1).width = 20;
    sheet.getColumn(2).width = 35;
    sheet.getColumn(3).width = 12;
    sheet.getColumn(4).width = 15;
    sheet.getColumn(5).width = 15;
    sheet.getColumn(6).width = 15;
    sheet.getColumn(7).width = 25;

    // Style summary section
    sheet.getCell('A1').font = { bold: true, size: 14 };
  }
}
