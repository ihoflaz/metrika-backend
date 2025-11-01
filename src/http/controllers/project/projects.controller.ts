import type { Request, Response } from 'express';
import { z } from 'zod';
import { ProjectStatus } from '@prisma/client';
import type { ProjectService } from '../../../modules/projects/project.service';
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

  constructor(projectService: ProjectService) {
    this.projectService = projectService;
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

  list = async (_req: Request, res: Response) => {
    const projects = await this.projectService.listProjects();
    res.status(200).json({
      data: projects.map((project) => serializeProject(project)),
      meta: { requestId: getRequestId(res) },
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
}
