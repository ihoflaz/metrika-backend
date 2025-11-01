import type { Request, Response } from 'express';
import { z } from 'zod';
import { ProjectMemberRole } from '@prisma/client';
import type { ProjectMemberService } from '../../../modules/projects/project-member.service';
import { validationError } from '../../../common/errors';

const AddMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.nativeEnum(ProjectMemberRole),
  allocationPct: z.number().int().min(0).max(100).optional(),
});

const UpdateMemberSchema = z.object({
  role: z.nativeEnum(ProjectMemberRole).optional(),
  allocationPct: z.number().int().min(0).max(100).optional(),
});

export class ProjectMembersController {
  private readonly service: ProjectMemberService;

  constructor(service: ProjectMemberService) {
    this.service = service;
  }

  addMember = async (req: Request, res: Response) => {
    const { projectId } = req.params;
    
    const parsed = AddMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten());
    }

    const member = await this.service.addMember({
      projectId,
      ...parsed.data,
    });

    res.status(201).json({
      data: {
        type: 'projectMember',
        id: member.id,
        attributes: {
          role: member.role,
          allocationPct: member.allocationPct,
          joinedAt: member.joinedAt,
        },
        relationships: {
          user: {
            type: 'user',
            id: member.user.id,
            attributes: {
              email: member.user.email,
              fullName: member.user.fullName,
            },
          },
          project: {
            type: 'project',
            id: member.project.id,
            attributes: {
              name: member.project.name,
            },
          },
        },
      },
    });
  };

  listMembers = async (req: Request, res: Response) => {
    const { projectId } = req.params;

    const members = await this.service.listMembers(projectId);

    res.json({
      data: members.map((member: { id: string; role: string; allocationPct: number | null; joinedAt: Date; user: { id: string; email: string; fullName: string; status: string } }) => ({
        type: 'projectMember',
        id: member.id,
        attributes: {
          role: member.role,
          allocationPct: member.allocationPct,
          joinedAt: member.joinedAt,
        },
        relationships: {
          user: {
            type: 'user',
            id: member.user.id,
            attributes: {
              email: member.user.email,
              fullName: member.user.fullName,
              status: member.user.status,
            },
          },
        },
      })),
      meta: {
        total: members.length,
      },
    });
  };

  getMember = async (req: Request, res: Response) => {
    const { memberId } = req.params;

    const member = await this.service.getMember(memberId);

    res.json({
      data: {
        type: 'projectMember',
        id: member.id,
        attributes: {
          role: member.role,
          allocationPct: member.allocationPct,
          joinedAt: member.joinedAt,
          leftAt: member.leftAt,
        },
        relationships: {
          user: {
            type: 'user',
            id: member.user.id,
            attributes: {
              email: member.user.email,
              fullName: member.user.fullName,
              status: member.user.status,
            },
          },
          project: {
            type: 'project',
            id: member.project.id,
            attributes: {
              code: member.project.code,
              name: member.project.name,
              status: member.project.status,
            },
          },
        },
      },
    });
  };

  updateMember = async (req: Request, res: Response) => {
    const { memberId } = req.params;

    const parsed = UpdateMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten());
    }

    const member = await this.service.updateMember(memberId, parsed.data);

    res.json({
      data: {
        type: 'projectMember',
        id: member.id,
        attributes: {
          role: member.role,
          allocationPct: member.allocationPct,
          joinedAt: member.joinedAt,
        },
        relationships: {
          user: {
            type: 'user',
            id: member.user.id,
            attributes: {
              email: member.user.email,
              fullName: member.user.fullName,
            },
          },
          project: {
            type: 'project',
            id: member.project.id,
            attributes: {
              name: member.project.name,
            },
          },
        },
      },
    });
  };

  removeMember = async (req: Request, res: Response) => {
    const { memberId } = req.params;

    await this.service.removeMember(memberId);

    res.status(204).send();
  };
}
