import type { Request, Response } from 'express';
import { z } from 'zod';
import { TaskPriority, TaskStatus, TaskDependencyType } from '@prisma/client';
import type { TaskService } from '../../../modules/tasks/task.service';
import type { DocumentService } from '../../../modules/documents/document.service';
import { validationError } from '../../../common/errors';
import { getRequestId } from '../../middleware/request-context';

const isoDateTimeSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Invalid ISO datetime string',
  })
  .transform((value) => new Date(value));

const recordSchema = z.record(z.string(), z.unknown());

const createTaskSchema = z.object({
  parentTaskId: z.string().uuid().optional(),
  title: z.string().trim().min(3),
  description: z.string().trim().optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  ownerId: z.string().uuid(),
  reporterId: z.string().uuid().optional(),
  plannedStart: isoDateTimeSchema.optional(),
  plannedEnd: isoDateTimeSchema.optional(),
  metadata: recordSchema.optional(),
});

const updateTaskSchema = z.object({
  title: z.string().trim().min(3).optional(),
  description: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (value === null ? undefined : (value ?? undefined))),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  ownerId: z.string().uuid().optional(),
  reporterId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
  plannedStart: isoDateTimeSchema
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
  plannedEnd: isoDateTimeSchema
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
  actualStart: isoDateTimeSchema
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
  actualEnd: isoDateTimeSchema
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
  progressPct: z.number().int().min(0).max(100).optional(),
  effortPlannedHours: z
    .number()
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
  effortLoggedHours: z
    .number()
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
  metadata: recordSchema
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
});

const serializeTask = (task: Awaited<ReturnType<TaskService['createTask']>>) => ({
  type: 'task',
  id: task.id,
  attributes: {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    ownerId: task.ownerId,
    reporterId: task.reporterId,
    plannedStart: task.plannedStart ? task.plannedStart.toISOString() : null,
    plannedEnd: task.plannedEnd ? task.plannedEnd.toISOString() : null,
    actualStart: task.actualStart ? task.actualStart.toISOString() : null,
    actualEnd: task.actualEnd ? task.actualEnd.toISOString() : null,
    progressPct: task.progressPct,
    effortPlannedHours: task.effortPlannedHours,
    effortLoggedHours: task.effortLoggedHours,
    metadata: task.metadata ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  },
  relationships: {
    project: {
      type: 'project',
      id: task.project.id,
      attributes: {
        code: task.project.code,
        name: task.project.name,
      },
    },
  },
});

const dependencySchema = z.object({
  dependsOnTaskId: z.string().uuid(),
  type: z.nativeEnum(TaskDependencyType).optional(),
  lagMinutes: z
    .number()
    .int()
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});

const serializeDependency = (dependency: Awaited<ReturnType<TaskService['createDependency']>>) => ({
  type: 'taskDependency',
  id: dependency.id,
  attributes: {
    type: dependency.type,
    lagMinutes: dependency.lagMinutes,
    dependsOnTaskId: dependency.dependsOnTaskId,
  },
  relationships: {
    dependsOn: {
      type: 'task',
      id: dependency.dependsOn.id,
      attributes: {
        title: dependency.dependsOn.title,
        status: dependency.dependsOn.status,
        projectId: dependency.dependsOn.projectId,
      },
    },
  },
});

export class TasksController {
  private readonly taskService: TaskService;
  private readonly documentService: DocumentService;

  constructor(taskService: TaskService, documentService: DocumentService) {
    this.taskService = taskService;
    this.documentService = documentService;
  }

  create = async (req: Request, res: Response) => {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const task = await this.taskService.createTask({
      ...parsed.data,
      projectId: req.params.projectId,
    });

    res.status(201).json({
      data: serializeTask(task),
      meta: { requestId: getRequestId(res) },
    });
  };

  list = async (req: Request, res: Response) => {
    const tasks = await this.taskService.listProjectTasks(req.params.projectId);
    res.status(200).json({
      data: tasks.map((task) => serializeTask(task)),
      meta: { requestId: getRequestId(res) },
    });
  };

  update = async (req: Request, res: Response) => {
    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const task = await this.taskService.updateTask(req.params.taskId, parsed.data);
    res.status(200).json({
      data: serializeTask(task),
      meta: { requestId: getRequestId(res) },
    });
  };

  listDependencies = async (req: Request, res: Response) => {
    const dependencies = await this.taskService.listDependencies(req.params.taskId);

    res.status(200).json({
      data: dependencies.map((dependency) => serializeDependency(dependency)),
      meta: { requestId: getRequestId(res) },
    });
  };

  addDependency = async (req: Request, res: Response) => {
    const parsed = dependencySchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const dependency = await this.taskService.createDependency(req.params.taskId, parsed.data);

    res.status(201).json({
      data: serializeDependency(dependency),
      meta: { requestId: getRequestId(res) },
    });
  };

  deleteDependency = async (req: Request, res: Response) => {
    await this.taskService.deleteDependency(req.params.taskId, req.params.dependencyId);

    res.status(204).send();
  };

  /**
   * Get all documents linked to a task
   * GET /api/v1/tasks/:taskId/documents
   */
  getLinkedDocuments = async (req: Request, res: Response) => {
    const links = await this.documentService.getDocumentsForTask(req.params.taskId);

    res.status(200).json({
      data: links.map((link) => ({
        type: 'document-task-link',
        id: link.id,
        attributes: {
          linkedAt: link.linkedAt.toISOString(),
          document: {
            id: link.document.id,
            title: link.document.title,
            docType: link.document.docType,
            classification: link.document.classification,
            tags: link.document.tags,
            retentionPolicy: link.document.retentionPolicy,
            createdAt: link.document.createdAt.toISOString(),
            currentVersion: link.document.currentVersion
              ? {
                  id: link.document.currentVersion.id,
                  versionNo: link.document.currentVersion.versionNo,
                  status: link.document.currentVersion.status,
                  sizeBytes: link.document.currentVersion.sizeBytes.toString(),
                  mimeType: link.document.currentVersion.mimeType,
                }
              : null,
            owner: {
              id: link.document.owner.id,
              fullName: link.document.owner.fullName,
              email: link.document.owner.email,
            },
            project: {
              id: link.document.project.id,
              code: link.document.project.code,
              name: link.document.project.name,
            },
          },
          linkedBy: {
            id: link.linker.id,
            fullName: link.linker.fullName,
            email: link.linker.email,
          },
        },
      })),
      meta: { requestId: getRequestId(res) },
    });
  };
}
