import type { Request, Response } from 'express';
import { z } from 'zod';
import { ProjectStatus } from '@prisma/client';
import type { ProjectService } from '../../../modules/projects/project.service';
import { ProjectClosurePDFService } from '../../../modules/projects/project-closure-pdf.service';
import { validationError } from '../../../common/errors';
import { getRequestId } from '../../middleware/request-context';

const isoDateSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Invalid ISO date string',
  })
  .transform((value) => new Date(value));

const recordSchema = z.record(z.string(), z.unknown());

const createProjectSchema = z.object({
  name: z.string().trim().min(3),
  description: z.string().trim().min(1).optional(),
  sponsorId: z.string().uuid(),
  pmoOwnerId: z.string().uuid().optional(),
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  budgetPlanned: z.number().positive().optional(),
  metadata: recordSchema.optional(),
});

const updateProjectSchema = z.object({
  name: z.string().trim().min(3).optional(),
  description: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .optional()
    .transform((value) => (value === null ? undefined : value)),
  status: z.nativeEnum(ProjectStatus).optional(),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  actualStart: isoDateSchema.optional(),
  actualEnd: isoDateSchema.optional(),
  budgetPlanned: z
    .number()
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
  metadata: recordSchema
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
  pmoOwnerId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
});

const serializeProject = (project: Awaited<ReturnType<ProjectService['createProject']>>) => ({
  type: 'project',
  id: project.id,
  attributes: {
    code: project.code,
    name: project.name,
    description: project.description,
    sponsorId: project.sponsorId,
    pmoOwnerId: project.pmoOwnerId,
    status: project.status,
    startDate: project.startDate.toISOString(),
    endDate: project.endDate ? project.endDate.toISOString() : null,
    actualStart: project.actualStart ? project.actualStart.toISOString() : null,
    actualEnd: project.actualEnd ? project.actualEnd.toISOString() : null,
    budgetPlanned: project.budgetPlanned,
    metadata: project.metadata ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  },
});

export class ProjectsController {
  private readonly projectService: ProjectService;
  private readonly pdfService: ProjectClosurePDFService;

  constructor(projectService: ProjectService) {
    this.projectService = projectService;
    this.pdfService = new ProjectClosurePDFService();
  }

  create = async (req: Request, res: Response) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const project = await this.projectService.createProject(parsed.data);
    res.status(201).json({
      data: serializeProject(project),
      meta: { requestId: getRequestId(res) },
    });
  };

  list = async (req: Request, res: Response) => {
    const filters = {
      status: req.query.status as string | string[] | undefined,
      sponsorId: req.query.sponsorId as string | undefined,
      pmoOwnerId: req.query.pmoOwnerId as string | undefined,
      search: req.query.search as string | undefined,
      startDateFrom: req.query.startDateFrom as string | undefined,
      startDateTo: req.query.startDateTo as string | undefined,
      endDateFrom: req.query.endDateFrom as string | undefined,
      endDateTo: req.query.endDateTo as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
      sortBy: req.query.sortBy as string | undefined,
      sortOrder: req.query.sortOrder as 'asc' | 'desc' | undefined,
    };

    const result = await this.projectService.listProjects(filters);
    
    res.status(200).json({
      data: result.data.map((project) => serializeProject(project)),
      meta: {
        requestId: getRequestId(res),
        pagination: result.meta,
      },
    });
  };

  getById = async (req: Request, res: Response) => {
    const project = await this.projectService.getProjectById(req.params.projectId);
    res.status(200).json({
      data: serializeProject(project),
      meta: { requestId: getRequestId(res) },
    });
  };

  update = async (req: Request, res: Response) => {
    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const project = await this.projectService.updateProject(req.params.projectId, parsed.data);
    res.status(200).json({
      data: serializeProject(project),
      meta: { requestId: getRequestId(res) },
    });
  };

  close = async (req: Request, res: Response) => {
    const project = await this.projectService.closeProject(req.params.projectId);
    res.status(200).json({
      data: serializeProject(project),
      meta: { requestId: getRequestId(res) },
    });
  };

  /**
   * Generate project closure PDF report
   * Gathers project statistics and generates a professional PDF
   */
  generateClosureReport = async (req: Request, res: Response) => {
    const stats = await this.projectService.getProjectClosureStats(req.params.projectId);
    const pdfStream = this.pdfService.generateClosureReport(stats);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="project-closure-${stats.project.code}.pdf"`
    );

    pdfStream.pipe(res);
  };

  /**
   * Full-text search projects
   * GET /api/v1/projects/search?q=query&limit=20&status=ACTIVE
   */
  searchProjects = async (req: Request, res: Response) => {
    const { q: query, limit, status } = req.query;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      throw validationError('INVALID_SEARCH_QUERY', 'Search query is required');
    }

    const parsedLimit = limit ? parseInt(limit as string, 10) : 20;
    if (Number.isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw validationError('INVALID_LIMIT', 'Limit must be between 1 and 100');
    }

    const options: { limit: number; status?: ProjectStatus } = { limit: parsedLimit };

    if (status && typeof status === 'string') {
      if (!Object.values(ProjectStatus).includes(status as ProjectStatus)) {
        throw validationError('INVALID_STATUS', 'Invalid project status');
      }
      options.status = status as ProjectStatus;
    }

    const results = await this.projectService.searchProjects(query.trim(), options);

    res.json({
      data: results.map((project) => ({
        type: 'project',
        id: project.id,
        attributes: {
          code: project.code,
          name: project.name,
          description: project.description,
          status: project.status,
          startDate: project.startDate.toISOString(),
          endDate: project.endDate?.toISOString() || null,
          actualStart: project.actualStart?.toISOString() || null,
          actualEnd: project.actualEnd?.toISOString() || null,
          budgetPlanned: project.budgetPlanned,
          createdAt: project.createdAt.toISOString(),
          updatedAt: project.updatedAt.toISOString(),
          rank: project.rank,
          sponsor: project.sponsor,
          pmoOwner: project.pmo_owner,
        },
      })),
      meta: {
        requestId: getRequestId(res),
        query: query.trim(),
        total: results.length,
        limit: parsedLimit,
      },
    });
  };
}
