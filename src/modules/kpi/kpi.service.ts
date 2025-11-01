import type {
  PrismaClient,
  KPICategory,
  KPIStatus,
  KPIPrivacyLevel,
  KPIAggregationPeriod,
  KPIDataSourceType,
  KPIValueSource,
  KPIVerificationStatus,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { badRequestError, conflictError, notFoundError } from '../../common/errors';
import type { Logger } from '../../lib/logger';

export interface CreateKPIInput {
  code: string;
  name: string;
  description?: string;
  category: KPICategory;
  calculationFormula: string;
  targetValue: number;
  unit: string;
  thresholdWarning?: number;
  thresholdCritical?: number;
  aggregationPeriod: KPIAggregationPeriod;
  dataSourceType: KPIDataSourceType;
  dataSourceReference?: Record<string, unknown>;
  stewardId: string;
  approverId?: string;
  privacyLevel?: KPIPrivacyLevel;
  linkedProjectIds?: string[];
  linkedTaskIds?: string[];
}

export interface UpdateKPIInput {
  name?: string;
  description?: string;
  calculationFormula?: string;
  targetValue?: number;
  unit?: string;
  thresholdWarning?: number;
  thresholdCritical?: number;
  aggregationPeriod?: KPIAggregationPeriod;
  dataSourceReference?: Record<string, unknown>;
  approverId?: string;
  status?: KPIStatus;
  linkedProjectIds?: string[];
  linkedTaskIds?: string[];
}

export interface AddDataPointInput {
  periodStart: Date;
  periodEnd: Date;
  actualValue: number;
  valueSource: KPIValueSource;
  collectedBy?: string;
  verificationNotes?: string;
}

export interface KPITrendData {
  kpiId: string;
  code: string;
  name: string;
  unit: string;
  targetValue: number;
  thresholdWarning?: number;
  thresholdCritical?: number;
  dataPoints: Array<{
    id: string;
    periodStart: Date;
    periodEnd: Date;
    actualValue: number;
    collectedAt: Date;
    verificationStatus: KPIVerificationStatus;
  }>;
  statistics: {
    average: number;
    minimum: number;
    maximum: number;
    latest: number;
    variance: number;
  };
}

export class KPIService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger,
  ) {}

  async createKPI(input: CreateKPIInput) {
    // Validate formula (basic syntax check)
    this.validateFormula(input.calculationFormula);

    // Ensure steward exists
    await this.ensureUser(input.stewardId);

    // Ensure approver exists if provided
    if (input.approverId) {
      await this.ensureUser(input.approverId);
    }

    // Check for duplicate code
    const existing = await this.prisma.kPIDefinition.findUnique({
      where: { code: input.code },
    });

    if (existing) {
      throw conflictError('KPI code already exists', { code: input.code });
    }

    const kpi = await this.prisma.kPIDefinition.create({
      data: {
        id: uuidv7(),
        code: input.code,
        name: input.name,
        description: input.description,
        category: input.category,
        calculationFormula: input.calculationFormula,
        targetValue: input.targetValue,
        unit: input.unit,
        thresholdWarning: input.thresholdWarning,
        thresholdCritical: input.thresholdCritical,
        aggregationPeriod: input.aggregationPeriod,
        dataSourceType: input.dataSourceType,
        dataSourceReference: input.dataSourceReference as Prisma.InputJsonValue | undefined,
        stewardId: input.stewardId,
        approverId: input.approverId,
        privacyLevel: input.privacyLevel ?? 'INTERNAL',
        linkedProjectIds: input.linkedProjectIds ?? [],
        linkedTaskIds: input.linkedTaskIds ?? [],
      },
      include: {
        steward: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
        approver: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
      },
    });

    this.logger.info({ kpiId: kpi.id, code: kpi.code }, 'KPI created');

    return kpi;
  }

  async listKPIs(filters?: {
    category?: KPICategory;
    status?: KPIStatus;
    stewardId?: string;
    search?: string;
  }) {
    const where: Record<string, unknown> = {};

    if (filters?.category) {
      where.category = filters.category;
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.stewardId) {
      where.stewardId = filters.stewardId;
    }

    if (filters?.search) {
      where.OR = [
        { code: { contains: filters.search, mode: 'insensitive' } },
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const kpis = await this.prisma.kPIDefinition.findMany({
      where,
      include: {
        steward: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
        approver: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return kpis;
  }

  async getKPI(kpiId: string) {
    const kpi = await this.prisma.kPIDefinition.findUnique({
      where: { id: kpiId },
      include: {
        steward: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
        approver: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
        series: {
          take: 1,
          orderBy: { periodEnd: 'desc' },
          include: {
            collector: {
              select: {
                id: true,
                email: true,
                fullName: true,
              },
            },
          },
        },
      },
    });

    if (!kpi) {
      throw notFoundError('KPI_NOT_FOUND', 'KPI not found');
    }

    return kpi;
  }

  async updateKPI(kpiId: string, input: UpdateKPIInput) {
    const existing = await this.prisma.kPIDefinition.findUnique({
      where: { id: kpiId },
    });

    if (!existing) {
      throw notFoundError('KPI_NOT_FOUND', 'KPI not found');
    }

    // Validate formula if provided
    if (input.calculationFormula) {
      this.validateFormula(input.calculationFormula);
    }

    // Ensure approver exists if provided
    if (input.approverId) {
      await this.ensureUser(input.approverId);
    }

    const updated = await this.prisma.kPIDefinition.update({
      where: { id: kpiId },
      data: {
        name: input.name,
        description: input.description,
        calculationFormula: input.calculationFormula,
        targetValue: input.targetValue,
        unit: input.unit,
        thresholdWarning: input.thresholdWarning,
        thresholdCritical: input.thresholdCritical,
        aggregationPeriod: input.aggregationPeriod,
        dataSourceReference: input.dataSourceReference as Prisma.InputJsonValue | undefined,
        approverId: input.approverId,
        status: input.status,
        linkedProjectIds: input.linkedProjectIds,
        linkedTaskIds: input.linkedTaskIds,
      },
      include: {
        steward: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
        approver: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
      },
    });

    this.logger.info({ kpiId: updated.id }, 'KPI updated');

    return updated;
  }

  async retireKPI(kpiId: string) {
    const existing = await this.prisma.kPIDefinition.findUnique({
      where: { id: kpiId },
    });

    if (!existing) {
      throw notFoundError('KPI_NOT_FOUND', 'KPI not found');
    }

    if (existing.status === 'RETIRED') {
      throw badRequestError('KPI_ALREADY_RETIRED', 'KPI is already retired');
    }

    const retired = await this.prisma.kPIDefinition.update({
      where: { id: kpiId },
      data: { status: 'RETIRED' },
    });

    this.logger.info({ kpiId: retired.id }, 'KPI retired');

    return retired;
  }

  async addDataPoint(kpiId: string, input: AddDataPointInput) {
    const kpi = await this.prisma.kPIDefinition.findUnique({
      where: { id: kpiId },
    });

    if (!kpi) {
      throw notFoundError('KPI_NOT_FOUND', 'KPI not found');
    }

    if (kpi.status === 'RETIRED') {
      throw badRequestError('KPI_RETIRED', 'Cannot add data to retired KPI');
    }

    // Ensure collector exists if provided
    if (input.collectedBy) {
      await this.ensureUser(input.collectedBy);
    }

    // Check for overlapping periods
    const overlapping = await this.prisma.kPISeries.findFirst({
      where: {
        kpiId,
        OR: [
          {
            AND: [
              { periodStart: { lte: input.periodStart } },
              { periodEnd: { gte: input.periodStart } },
            ],
          },
          {
            AND: [
              { periodStart: { lte: input.periodEnd } },
              { periodEnd: { gte: input.periodEnd } },
            ],
          },
        ],
      },
    });

    if (overlapping) {
      throw badRequestError('KPI_PERIOD_OVERLAP', 'Period overlaps with existing data point');
    }

    const dataPoint = await this.prisma.kPISeries.create({
      data: {
        id: uuidv7(),
        kpiId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        actualValue: input.actualValue,
        valueSource: input.valueSource,
        collectedBy: input.collectedBy,
        verificationNotes: input.verificationNotes,
      },
      include: {
        collector: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
      },
    });

    this.logger.info({ kpiId, dataPointId: dataPoint.id }, 'KPI data point added');

    // Update KPI status to MONITORING if it was ACTIVE
    if (kpi.status === 'ACTIVE') {
      await this.prisma.kPIDefinition.update({
        where: { id: kpiId },
        data: { status: 'MONITORING' },
      });
    }

    return dataPoint;
  }

  async getTrend(kpiId: string, limit = 12): Promise<KPITrendData> {
    const kpi = await this.prisma.kPIDefinition.findUnique({
      where: { id: kpiId },
    });

    if (!kpi) {
      throw notFoundError('KPI_NOT_FOUND', 'KPI not found');
    }

    const dataPoints = await this.prisma.kPISeries.findMany({
      where: { kpiId },
      orderBy: { periodEnd: 'desc' },
      take: limit,
    });

    // Calculate statistics
    let statistics = {
      average: 0,
      minimum: 0,
      maximum: 0,
      latest: 0,
      variance: 0,
    };

    if (dataPoints.length > 0) {
      const values = dataPoints.map((dp) => Number(dp.actualValue));
      const sum = values.reduce((a, b) => a + b, 0);
      const avg = sum / values.length;

      statistics = {
        average: avg,
        minimum: Math.min(...values),
        maximum: Math.max(...values),
        latest: values[0],
        variance: values.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / values.length,
      };
    }

    return {
      kpiId: kpi.id,
      code: kpi.code,
      name: kpi.name,
      unit: kpi.unit,
      targetValue: Number(kpi.targetValue),
      thresholdWarning: kpi.thresholdWarning ? Number(kpi.thresholdWarning) : undefined,
      thresholdCritical: kpi.thresholdCritical ? Number(kpi.thresholdCritical) : undefined,
      dataPoints: dataPoints.map((dp) => ({
        id: dp.id,
        periodStart: dp.periodStart,
        periodEnd: dp.periodEnd,
        actualValue: Number(dp.actualValue),
        collectedAt: dp.collectedAt,
        verificationStatus: dp.verificationStatus,
      })),
      statistics,
    };
  }

  async checkThresholds(kpiId: string) {
    const kpi = await this.prisma.kPIDefinition.findUnique({
      where: { id: kpiId },
      include: {
        series: {
          orderBy: { periodEnd: 'desc' },
          take: 1,
        },
      },
    });

    if (!kpi) {
      throw notFoundError('KPI_NOT_FOUND', 'KPI not found');
    }

    if (kpi.series.length === 0) {
      return {
        kpiId: kpi.id,
        hasData: false,
        breached: false,
        level: 'NORMAL' as const,
      };
    }

    const latestValue = Number(kpi.series[0].actualValue);
    const target = Number(kpi.targetValue);
    const warningPercent = kpi.thresholdWarning ? Number(kpi.thresholdWarning) : null;
    const criticalPercent = kpi.thresholdCritical ? Number(kpi.thresholdCritical) : null;

    // Calculate absolute threshold values from percentages
    const warningThreshold = warningPercent !== null ? target * (1 + warningPercent / 100) : null;
    const criticalThreshold = criticalPercent !== null ? target * (1 + criticalPercent / 100) : null;

    let level: 'NORMAL' | 'WARNING' | 'CRITICAL' = 'NORMAL';
    let breached = false;
    let exceedsWarning = false;
    let exceedsCritical = false;

    if (criticalThreshold !== null && latestValue >= criticalThreshold) {
      level = 'CRITICAL';
      breached = true;
      exceedsWarning = true;
      exceedsCritical = true;
    } else if (warningThreshold !== null && latestValue >= warningThreshold) {
      level = 'WARNING';
      breached = false;
      exceedsWarning = true;
      exceedsCritical = false;
    }

    return {
      kpiId: kpi.id,
      hasData: true,
      latestValue,
      currentValue: latestValue.toFixed(2),
      target,
      warning: warningThreshold,
      critical: criticalThreshold,
      breached,
      level,
      exceedsWarning,
      exceedsCritical,
      deviation: ((latestValue - target) / target) * 100,
    };
  }

  private validateFormula(formula: string) {
    // Basic validation: ensure formula is not empty and has reasonable length
    if (!formula || formula.trim().length === 0) {
      throw badRequestError('KPI_FORMULA_INVALID', 'Formula cannot be empty');
    }

    if (formula.length > 1000) {
      throw badRequestError('KPI_FORMULA_TOO_LONG', 'Formula exceeds maximum length');
    }

    // Check for dangerous patterns (basic security)
    const dangerousPatterns = [
      /eval\s*\(/i,
      /function\s*\(/i,
      /=>\s*{/,
      /require\s*\(/i,
      /import\s+/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(formula)) {
        throw badRequestError('KPI_FORMULA_INVALID', 'Formula contains invalid expressions');
      }
    }

    this.logger.debug({ formula }, 'Formula validated');
  }

  private async ensureUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw badRequestError('USER_NOT_FOUND', 'User not found');
    }
  }
}
