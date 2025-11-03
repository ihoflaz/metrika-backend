/**
 * Project Clone Controller
 * Handles project cloning and template operations
 * Week 4 - Day 17-18
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ProjectCloneService } from '../../../modules/projects/project-clone.service';

const CloneProjectSchema = z.object({
  newCode: z.string().min(3).max(20).regex(/^[A-Z0-9_-]+$/),
  newName: z.string().min(3).max(200),
  newDescription: z.string().optional(),
  newSponsorId: z.string().uuid().optional(),
  newStartDate: z.string().datetime().optional(),
  copyMembers: z.boolean().optional().default(false),
  copyTasks: z.boolean().optional().default(true),
  copyDocuments: z.boolean().optional().default(false),
  preserveStatus: z.boolean().optional().default(false),
});

const CloneFromTemplateSchema = z.object({
  newCode: z.string().min(3).max(20).regex(/^[A-Z0-9_-]+$/),
  newName: z.string().min(3).max(200),
  newDescription: z.string().optional(),
  newSponsorId: z.string().uuid().optional(),
  newStartDate: z.string().datetime().optional(),
});

const serializeProject = (project: any) => ({
  type: 'project',
  id: project.id,
  attributes: {
    code: project.code,
    name: project.name,
    description: project.description,
    status: project.status,
  },
  metadata: project.metadata,
});

export class ProjectCloneController {
  constructor(private cloneService: ProjectCloneService) {}

  /**
   * POST /projects/:projectId/clone
   * Clone a project with options
   */
  async cloneProject(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      const { authUser } = res.locals as { authUser: { id: string } };
      const userId = authUser.id;

      // Validate request body
      const parsed = CloneProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          errors: parsed.error.issues.map((issue) => ({
            status: '400',
            title: 'Validation Error',
            detail: issue.message,
            source: { pointer: `/data/attributes/${issue.path.join('/')}` },
          })),
        });
        return;
      }

      const options = {
        ...parsed.data,
        newStartDate: parsed.data.newStartDate
          ? new Date(parsed.data.newStartDate)
          : undefined,
      };

      const result = await this.cloneService.cloneProject(
        projectId,
        options,
        userId,
      );

      res.status(201).json({
        data: {
          ...serializeProject(result.project),
          meta: {
            taskCount: result.taskCount,
            memberCount: result.memberCount,
            documentCount: result.documentCount,
          },
        },
      });
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        res.status(404).json({
          errors: [{
            status: '404',
            title: 'Not Found',
            detail: error.message,
          }],
        });
      } else if (error.message?.includes('already exists')) {
        res.status(409).json({
          errors: [{
            status: '409',
            title: 'Conflict',
            detail: error.message,
          }],
        });
      } else {
        throw error;
      }
    }
  }

  /**
   * POST /projects/:projectId/mark-as-template
   * Mark a project as a template
   */
  async markAsTemplate(req: Request, res: Response): Promise<void> {
    try {
      const { projectId } = req.params;
      const { authUser } = res.locals as { authUser: { id: string } };
      const userId = authUser.id;

      const project = await this.cloneService.createTemplate(projectId, userId);

      res.status(200).json({
        data: serializeProject(project),
      });
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        res.status(404).json({
          errors: [{
            status: '404',
            title: 'Not Found',
            detail: error.message,
          }],
        });
      } else {
        throw error;
      }
    }
  }

  /**
   * GET /project-templates
   * List all project templates
   */
  async listTemplates(req: Request, res: Response): Promise<void> {
    const templates = await this.cloneService.getTemplates();

    res.status(200).json({
      data: templates.map(serializeProject),
    });
  }

  /**
   * POST /project-templates/:templateId/clone
   * Clone from a template
   */
  async cloneFromTemplate(req: Request, res: Response): Promise<void> {
    try {
      const { templateId } = req.params;
      const { authUser } = res.locals as { authUser: { id: string } };
      const userId = authUser.id;

      // Validate request body
      const parsed = CloneFromTemplateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          errors: parsed.error.issues.map((issue) => ({
            status: '400',
            title: 'Validation Error',
            detail: issue.message,
            source: { pointer: `/data/attributes/${issue.path.join('/')}` },
          })),
        });
        return;
      }

      const options = {
        ...parsed.data,
        newStartDate: parsed.data.newStartDate
          ? new Date(parsed.data.newStartDate)
          : undefined,
      };

      const result = await this.cloneService.cloneFromTemplate(
        templateId,
        options,
        userId,
      );

      res.status(201).json({
        data: {
          ...serializeProject(result.project),
          meta: {
            taskCount: result.taskCount,
            memberCount: result.memberCount,
            documentCount: result.documentCount,
          },
        },
      });
    } catch (error: any) {
      if (error.message?.includes('not found')) {
        res.status(404).json({
          errors: [{
            status: '404',
            title: 'Not Found',
            detail: error.message,
          }],
        });
      } else if (error.message?.includes('not a template')) {
        res.status(400).json({
          errors: [{
            status: '400',
            title: 'Invalid Template',
            detail: error.message,
          }],
        });
      } else if (error.message?.includes('already exists')) {
        res.status(409).json({
          errors: [{
            status: '409',
            title: 'Conflict',
            detail: error.message,
          }],
        });
      } else {
        throw error;
      }
    }
  }
}
