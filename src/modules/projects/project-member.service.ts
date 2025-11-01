import { PrismaClient, ProjectMemberRole } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import type { Logger } from '../../lib/logger';
import { notFoundError, conflictError } from '../../common/errors';

export interface AddProjectMemberInput {
  projectId: string;
  userId: string;
  role: ProjectMemberRole;
  allocationPct?: number;
}

export interface UpdateProjectMemberInput {
  role?: ProjectMemberRole;
  allocationPct?: number;
}

export class ProjectMemberService {
  private readonly prisma: PrismaClient;

  private readonly logger: Logger;

  constructor(prisma: PrismaClient, logger: Logger) {
    this.prisma = prisma;
    this.logger = logger;
  }

  async addMember(input: AddProjectMemberInput) {
    // Verify project exists
    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
    });

    if (!project) {
      throw notFoundError('PROJECT_NOT_FOUND', 'Project not found');
    }

    // Verify user exists
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
    });

    if (!user) {
      throw notFoundError('USER_NOT_FOUND', 'User not found');
    }

    // Check if member with same role already exists
    const existingMember = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId_role: {
          projectId: input.projectId,
          userId: input.userId,
          role: input.role,
        },
      },
    });

    if (existingMember) {
      throw conflictError('User already has this role in the project');
    }

    const member = await this.prisma.projectMember.create({
      data: {
        id: uuidv7(),
        projectId: input.projectId,
        userId: input.userId,
        role: input.role,
        allocationPct: input.allocationPct ?? 0,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    this.logger.info(
      { projectId: input.projectId, userId: input.userId, role: input.role },
      'Project member added',
    );

    return member;
  }

  async listMembers(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw notFoundError('PROJECT_NOT_FOUND', 'Project not found');
    }

    const members = await this.prisma.projectMember.findMany({
      where: {
        projectId,
        leftAt: null, // Only active members
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            status: true,
          },
        },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });

    return members;
  }

  async getMember(memberId: string) {
    const member = await this.prisma.projectMember.findUnique({
      where: { id: memberId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            status: true,
          },
        },
        project: {
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
          },
        },
      },
    });

    if (!member) {
      throw notFoundError('MEMBER_NOT_FOUND', 'Project member not found');
    }

    return member;
  }

  async updateMember(memberId: string, input: UpdateProjectMemberInput) {
    const existingMember = await this.prisma.projectMember.findUnique({
      where: { id: memberId },
    });

    if (!existingMember) {
      throw notFoundError('MEMBER_NOT_FOUND', 'Project member not found');
    }

    // If role is being updated, check for conflicts
    if (input.role && input.role !== existingMember.role) {
      const conflictingMember = await this.prisma.projectMember.findUnique({
        where: {
          projectId_userId_role: {
            projectId: existingMember.projectId,
            userId: existingMember.userId,
            role: input.role,
          },
        },
      });

      if (conflictingMember) {
        throw conflictError('User already has this role in the project');
      }
    }

    const updated = await this.prisma.projectMember.update({
      where: { id: memberId },
      data: {
        role: input.role,
        allocationPct: input.allocationPct,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    this.logger.info({ memberId }, 'Project member updated');

    return updated;
  }

  async removeMember(memberId: string) {
    const member = await this.prisma.projectMember.findUnique({
      where: { id: memberId },
    });

    if (!member) {
      throw notFoundError('MEMBER_NOT_FOUND', 'Project member not found');
    }

    // Soft delete by setting leftAt
    await this.prisma.projectMember.update({
      where: { id: memberId },
      data: {
        leftAt: new Date(),
      },
    });

    this.logger.info(
      { memberId, projectId: member.projectId, userId: member.userId },
      'Project member removed',
    );
  }
}
