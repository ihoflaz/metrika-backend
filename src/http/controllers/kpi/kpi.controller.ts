import type { Request, Response } from 'express';
import { z } from 'zod';
import { validationError } from '../../../common/errors';
import type { KPIService } from '../../../modules/kpi/kpi.service';

const createKPISchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(160),
  description: z.string().optional(),
  category: z.enum(['FINANCIAL', 'SCHEDULE', 'QUALITY', 'RESOURCE', 'COMPLIANCE', 'CUSTOM']),
  calculationFormula: z.string().min(1).max(1000),
  targetValue: z.number(),
  unit: z.string().min(1).max(32),
  thresholdWarning: z.number().optional(),
  thresholdCritical: z.number().optional(),
  aggregationPeriod: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']),
  dataSourceType: z.enum(['MANUAL', 'SYSTEM', 'HYBRID']),
  dataSourceReference: z.record(z.string(), z.unknown()).optional(),
  stewardId: z.string().uuid(),
  approverId: z.string().uuid().optional(),
  privacyLevel: z.enum(['PUBLIC', 'INTERNAL', 'RESTRICTED']).optional(),
  linkedProjectIds: z.array(z.string().uuid()).optional(),
  linkedTaskIds: z.array(z.string().uuid()).optional(),
});

const updateKPISchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().optional(),
  calculationFormula: z.string().min(1).max(1000).optional(),
  targetValue: z.number().optional(),
  unit: z.string().min(1).max(32).optional(),
  thresholdWarning: z.number().optional(),
  thresholdCritical: z.number().optional(),
  aggregationPeriod: z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']).optional(),
  dataSourceReference: z.record(z.string(), z.unknown()).optional(),
  approverId: z.string().uuid().optional(),
  status: z
    .enum(['PROPOSED', 'UNDER_REVIEW', 'ACTIVE', 'MONITORING', 'BREACHED', 'RETIRED'])
    .optional(),
  linkedProjectIds: z.array(z.string().uuid()).optional(),
  linkedTaskIds: z.array(z.string().uuid()).optional(),
});

const addDataPointSchema = z.object({
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  actualValue: z.number(),
  valueSource: z.enum(['MANUAL_ENTRY', 'API_INGEST', 'FILE_UPLOAD']),
  collectedBy: z.string().uuid().optional(),
  verificationNotes: z.string().optional(),
});

const listKPIsQuerySchema = z.object({
  category: z.enum(['FINANCIAL', 'SCHEDULE', 'QUALITY', 'RESOURCE', 'COMPLIANCE', 'CUSTOM']).optional(),
  status: z
    .enum(['PROPOSED', 'UNDER_REVIEW', 'ACTIVE', 'MONITORING', 'BREACHED', 'RETIRED'])
    .optional(),
  stewardId: z.string().uuid().optional(),
  search: z.string().optional(),
});

const trendQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 12)),
});

export class KPIController {
  constructor(private readonly kpiService: KPIService) {}

  create = async (req: Request, res: Response) => {
    const validation = createKPISchema.safeParse(req.body);

    if (!validation.success) {
      throw validationError(validation.error.flatten().fieldErrors);
    }

    const kpi = await this.kpiService.createKPI(validation.data);

    res.status(201).json({
      data: {
        type: 'kpi',
        id: kpi.id,
        attributes: {
          code: kpi.code,
          name: kpi.name,
          description: kpi.description,
          category: kpi.category,
          calculationFormula: kpi.calculationFormula,
          targetValue: kpi.targetValue,
          unit: kpi.unit,
          thresholdWarning: kpi.thresholdWarning,
          thresholdCritical: kpi.thresholdCritical,
          aggregationPeriod: kpi.aggregationPeriod,
          dataSourceType: kpi.dataSourceType,
          dataSourceReference: kpi.dataSourceReference,
          status: kpi.status,
          privacyLevel: kpi.privacyLevel,
          linkedProjectIds: kpi.linkedProjectIds,
          linkedTaskIds: kpi.linkedTaskIds,
          createdAt: kpi.createdAt,
          updatedAt: kpi.updatedAt,
        },
        relationships: {
          steward: {
            type: 'user',
            id: kpi.steward.id,
            attributes: {
              email: kpi.steward.email,
              fullName: kpi.steward.fullName,
            },
          },
          approver: kpi.approver
            ? {
                type: 'user',
                id: kpi.approver.id,
                attributes: {
                  email: kpi.approver.email,
                  fullName: kpi.approver.fullName,
                },
              }
            : null,
        },
      },
    });
  };

  list = async (req: Request, res: Response) => {
    const validation = listKPIsQuerySchema.safeParse(req.query);

    if (!validation.success) {
      throw validationError(validation.error.flatten().fieldErrors);
    }

    const kpis = await this.kpiService.listKPIs(validation.data);

    res.status(200).json({
      data: kpis.map((kpi: any) => ({
        type: 'kpi',
        id: kpi.id,
        attributes: {
          code: kpi.code,
          name: kpi.name,
          description: kpi.description,
          category: kpi.category,
          calculationFormula: kpi.calculationFormula,
          targetValue: kpi.targetValue,
          unit: kpi.unit,
          thresholdWarning: kpi.thresholdWarning,
          thresholdCritical: kpi.thresholdCritical,
          aggregationPeriod: kpi.aggregationPeriod,
          status: kpi.status,
          privacyLevel: kpi.privacyLevel,
          createdAt: kpi.createdAt,
          updatedAt: kpi.updatedAt,
        },
        relationships: {
          steward: {
            type: 'user',
            id: kpi.steward.id,
            attributes: {
              email: kpi.steward.email,
              fullName: kpi.steward.fullName,
            },
          },
          approver: kpi.approver
            ? {
                type: 'user',
                id: kpi.approver.id,
                attributes: {
                  email: kpi.approver.email,
                  fullName: kpi.approver.fullName,
                },
              }
            : null,
        },
      })),
      meta: {
        total: kpis.length,
      },
    });
  };

  getById = async (req: Request, res: Response) => {
    const { kpiId } = req.params;

    const kpi = await this.kpiService.getKPI(kpiId);

    res.status(200).json({
      data: {
        type: 'kpi',
        id: kpi.id,
        attributes: {
          code: kpi.code,
          name: kpi.name,
          description: kpi.description,
          category: kpi.category,
          calculationFormula: kpi.calculationFormula,
          targetValue: kpi.targetValue,
          unit: kpi.unit,
          thresholdWarning: kpi.thresholdWarning,
          thresholdCritical: kpi.thresholdCritical,
          aggregationPeriod: kpi.aggregationPeriod,
          dataSourceType: kpi.dataSourceType,
          dataSourceReference: kpi.dataSourceReference,
          status: kpi.status,
          privacyLevel: kpi.privacyLevel,
          linkedProjectIds: kpi.linkedProjectIds,
          linkedTaskIds: kpi.linkedTaskIds,
          createdAt: kpi.createdAt,
          updatedAt: kpi.updatedAt,
        },
        relationships: {
          steward: {
            type: 'user',
            id: kpi.steward.id,
            attributes: {
              email: kpi.steward.email,
              fullName: kpi.steward.fullName,
            },
          },
          approver: kpi.approver
            ? {
                type: 'user',
                id: kpi.approver.id,
                attributes: {
                  email: kpi.approver.email,
                  fullName: kpi.approver.fullName,
                },
              }
            : null,
          latestDataPoint: kpi.series[0]
            ? {
                type: 'kpi-data',
                id: kpi.series[0].id,
                attributes: {
                  periodStart: kpi.series[0].periodStart,
                  periodEnd: kpi.series[0].periodEnd,
                  actualValue: kpi.series[0].actualValue,
                  valueSource: kpi.series[0].valueSource,
                  collectedAt: kpi.series[0].collectedAt,
                  verificationStatus: kpi.series[0].verificationStatus,
                },
              }
            : null,
        },
      },
    });
  };

  update = async (req: Request, res: Response) => {
    const { kpiId } = req.params;
    const validation = updateKPISchema.safeParse(req.body);

    if (!validation.success) {
      throw validationError(validation.error.flatten().fieldErrors);
    }

    const kpi = await this.kpiService.updateKPI(kpiId, validation.data);

    res.status(200).json({
      data: {
        type: 'kpi',
        id: kpi.id,
        attributes: {
          code: kpi.code,
          name: kpi.name,
          description: kpi.description,
          category: kpi.category,
          calculationFormula: kpi.calculationFormula,
          targetValue: kpi.targetValue,
          unit: kpi.unit,
          thresholdWarning: kpi.thresholdWarning,
          thresholdCritical: kpi.thresholdCritical,
          aggregationPeriod: kpi.aggregationPeriod,
          status: kpi.status,
          privacyLevel: kpi.privacyLevel,
          linkedProjectIds: kpi.linkedProjectIds,
          linkedTaskIds: kpi.linkedTaskIds,
          updatedAt: kpi.updatedAt,
        },
        relationships: {
          steward: {
            type: 'user',
            id: kpi.steward.id,
            attributes: {
              email: kpi.steward.email,
              fullName: kpi.steward.fullName,
            },
          },
          approver: kpi.approver
            ? {
                type: 'user',
                id: kpi.approver.id,
                attributes: {
                  email: kpi.approver.email,
                  fullName: kpi.approver.fullName,
                },
              }
            : null,
        },
      },
    });
  };

  retire = async (req: Request, res: Response) => {
    const { kpiId } = req.params;

    const kpi = await this.kpiService.retireKPI(kpiId);

    res.status(200).json({
      data: {
        type: 'kpi',
        id: kpi.id,
        attributes: {
          status: kpi.status,
          updatedAt: kpi.updatedAt,
        },
      },
    });
  };

  addData = async (req: Request, res: Response) => {
    const { kpiId } = req.params;
    const validation = addDataPointSchema.safeParse(req.body);

    if (!validation.success) {
      throw validationError(validation.error.flatten().fieldErrors);
    }

    const dataPoint = await this.kpiService.addDataPoint(kpiId, {
      periodStart: new Date(validation.data.periodStart),
      periodEnd: new Date(validation.data.periodEnd),
      actualValue: validation.data.actualValue,
      valueSource: validation.data.valueSource,
      collectedBy: validation.data.collectedBy,
      verificationNotes: validation.data.verificationNotes,
    });

    res.status(201).json({
      data: {
        type: 'kpi-data',
        id: dataPoint.id,
        attributes: {
          periodStart: dataPoint.periodStart,
          periodEnd: dataPoint.periodEnd,
          actualValue: dataPoint.actualValue,
          valueSource: dataPoint.valueSource,
          collectedAt: dataPoint.collectedAt,
          verificationStatus: dataPoint.verificationStatus,
          verificationNotes: dataPoint.verificationNotes,
        },
        relationships: {
          collector: dataPoint.collector
            ? {
                type: 'user',
                id: dataPoint.collector.id,
                attributes: {
                  email: dataPoint.collector.email,
                  fullName: dataPoint.collector.fullName,
                },
              }
            : null,
        },
      },
    });
  };

  getTrend = async (req: Request, res: Response) => {
    const { kpiId } = req.params;
    const validation = trendQuerySchema.safeParse(req.query);

    if (!validation.success) {
      throw validationError(validation.error.flatten().fieldErrors);
    }

    const trend = await this.kpiService.getTrend(kpiId, validation.data.limit);

    res.status(200).json({
      data: {
        type: 'kpi-trend',
        id: trend.kpiId,
        attributes: {
          code: trend.code,
          name: trend.name,
          unit: trend.unit,
          targetValue: trend.targetValue,
          thresholdWarning: trend.thresholdWarning,
          thresholdCritical: trend.thresholdCritical,
          statistics: trend.statistics,
        },
        relationships: {
          dataPoints: trend.dataPoints.map((dp) => ({
            type: 'kpi-data',
            id: dp.id,
            attributes: {
              periodStart: dp.periodStart,
              periodEnd: dp.periodEnd,
              actualValue: dp.actualValue,
              collectedAt: dp.collectedAt,
              verificationStatus: dp.verificationStatus,
            },
          })),
        },
      },
    });
  };

  checkThresholds = async (req: Request, res: Response) => {
    const { kpiId } = req.params;

    const result = await this.kpiService.checkThresholds(kpiId);

    res.status(200).json({
      data: {
        type: 'kpi-threshold-check',
        id: result.kpiId,
        attributes: result,
      },
    });
  };
}
