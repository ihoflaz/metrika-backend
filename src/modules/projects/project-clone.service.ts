/**
 * Project Clone Service
 * Handles project template creation and cloning with full data preservation
 * Week 4 - Day 17-18
 */

import type {
  PrismaClient,
  Project,
  Task,
  ProjectMember,
  Prisma,
  Document,
  DocumentVersion,
  DocumentTask,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import type { AuditService } from '../audit/audit.service';
import { DocumentStorageService } from '../storage/document-storage.service';

export interface CloneProjectOptions {
  newCode: string;
  newName: string;
  newDescription?: string;
  newSponsorId?: string;
  newStartDate?: Date;
  copyMembers?: boolean;
  copyTasks?: boolean;
  copyDocuments?: boolean;
  preserveStatus?: boolean;
}

export interface CloneResult {
  project: Project;
  taskCount: number;
  memberCount: number;
  documentCount: number;
  taskIdMapping: Map<string, string>;
}

interface TaskWithChildren extends Task {
  childTasks?: TaskWithChildren[];
  dependencies?: Array<{ dependsOnTaskId: string }>;
}

export class ProjectCloneService {
  constructor(
    private prisma: PrismaClient,
    private auditService: AuditService,
    private documentStorage: DocumentStorageService,
  ) { }

  /**
   * Clone a project with all related data
   */
  async cloneProject(
    sourceProjectId: string,
    options: CloneProjectOptions,
    actorId: string,
  ): Promise<CloneResult> {
    // Validate source project exists
    const sourceProject = await this.prisma.project.findUnique({
      where: { id: sourceProjectId },
      include: {
        tasks: true,
        members: true,
        documents: {
          include: {
            versions: true,
            linkedTasks: {
              select: {
                taskId: true,
              },
            },
          },
        },
      },
    });

    if (!sourceProject) {
      throw new Error(`Source project ${sourceProjectId} not found`);
    }

    // Check if new code is unique
    const existingProject = await this.prisma.project.findUnique({
      where: { code: options.newCode },
    });

    if (existingProject) {
      throw new Error(`Project code ${options.newCode} already exists`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Create new project
      const newProject = await this.createClonedProject(
        tx,
        sourceProject,
        options,
        actorId,
      );

      const taskIdMapping = new Map<string, string>();
      let taskCount = 0;

      // 2. Clone tasks with hierarchy
      if (options.copyTasks !== false) {
        const cloneResult = await this.cloneTasks(
          tx,
          sourceProject.tasks,
          newProject.id,
          actorId,
        );
        cloneResult.taskIdMapping.forEach((newId, oldId) => {
          taskIdMapping.set(oldId, newId);
        });
        taskCount = cloneResult.taskCount;
      }

      // 3. Clone members
      let memberCount = 0;
      if (options.copyMembers) {
        memberCount = await this.cloneMembers(
          tx,
          sourceProject.members,
          newProject.id,
          actorId,
        );
      }

      // 4. Clone documents (with updated task references)
      let documentCount = 0;
      if (options.copyDocuments) {
        documentCount = await this.cloneDocuments(
          tx,
          sourceProject.documents,
          newProject.id,
          taskIdMapping,
          actorId,
        );
      }

      // Audit log
      await this.auditService.logEvent('PROJECT_CLONED', {
        actorId,
        detail: `Cloned project ${sourceProject.code} to ${options.newCode}`,
        metadata: {
          sourceProjectId: sourceProject.id,
          targetProjectId: newProject.id,
          taskCount,
          memberCount,
          documentCount,
        },
      });

      return {
        project: newProject,
        taskCount,
        memberCount,
        documentCount,
        taskIdMapping,
      };
    });

    return result;
  }

  /**
   * Create a cloned project from source
   */
  private async createClonedProject(
    tx: Prisma.TransactionClient,
    sourceProject: Project,
    options: CloneProjectOptions,
    actorId: string,
  ): Promise<Project> {
    const newProject = await tx.project.create({
      data: {
        id: randomUUID(),
        code: options.newCode,
        name: options.newName,
        description: options.newDescription ?? sourceProject.description,
        sponsorId: options.newSponsorId ?? sourceProject.sponsorId,
        pmoOwnerId: sourceProject.pmoOwnerId,
        status: options.preserveStatus ? sourceProject.status : 'PLANNING',
        startDate: options.newStartDate ?? new Date(),
        endDate: null, // Reset dates for new project
        actualStart: null,
        actualEnd: null,
        budgetPlanned: sourceProject.budgetPlanned,
        metadata: {
          ...((sourceProject.metadata as any) ?? {}),
          clonedFrom: sourceProject.id,
          clonedAt: new Date().toISOString(),
          clonedBy: actorId,
        },
      },
    });

    return newProject;
  }

  /**
   * Clone tasks with hierarchy and dependencies
   */
  private async cloneTasks(
    tx: Prisma.TransactionClient,
    sourceTasks: Task[],
    newProjectId: string,
    actorId: string,
  ): Promise<{ taskCount: number; taskIdMapping: Map<string, string> }> {
    const taskIdMapping = new Map<string, string>();

    // Build task hierarchy
    const taskMap = new Map<string, TaskWithChildren>();
    const rootTasks: TaskWithChildren[] = [];

    sourceTasks.forEach((task) => {
      taskMap.set(task.id, { ...task, childTasks: [] });
    });

    sourceTasks.forEach((task) => {
      if (task.parentTaskId) {
        const parent = taskMap.get(task.parentTaskId);
        if (parent) {
          parent.childTasks!.push(taskMap.get(task.id)!);
        }
      } else {
        rootTasks.push(taskMap.get(task.id)!);
      }
    });

    // Clone tasks recursively (depth-first)
    const cloneTaskRecursive = async (
      task: TaskWithChildren,
      parentId: string | null,
    ): Promise<void> => {
      const newTaskId = randomUUID();
      taskIdMapping.set(task.id, newTaskId);

      await tx.task.create({
        data: {
          id: newTaskId,
          projectId: newProjectId,
          parentTaskId: parentId,
          title: task.title,
          description: task.description,
          status: 'PLANNED', // Reset status
          priority: task.priority,
          ownerId: task.ownerId,
          reporterId: task.reporterId,
          plannedStart: task.plannedStart,
          plannedEnd: task.plannedEnd,
          actualStart: null, // Reset actuals
          actualEnd: null,
          progressPct: 0, // Reset progress
          effortPlannedHours: task.effortPlannedHours,
          effortLoggedHours: null, // Reset logged hours
          metadata: {
            ...((task.metadata as any) ?? {}),
            clonedFrom: task.id,
          },
        },
      });

      // Clone children
      if (task.childTasks && task.childTasks.length > 0) {
        for (const childTask of task.childTasks) {
          await cloneTaskRecursive(childTask, newTaskId);
        }
      }
    };

    // Clone all root tasks and their children
    for (const rootTask of rootTasks) {
      await cloneTaskRecursive(rootTask, null);
    }

    // Now clone dependencies with mapped IDs
    for (const sourceTask of sourceTasks) {
      const dependencies = await tx.taskDependency.findMany({
        where: { taskId: sourceTask.id },
      });

      for (const dep of dependencies) {
        const newTaskId = taskIdMapping.get(sourceTask.id);
        const newDependsOnId = taskIdMapping.get(dep.dependsOnTaskId);

        if (newTaskId && newDependsOnId) {
          await tx.taskDependency.create({
            data: {
              id: randomUUID(),
              taskId: newTaskId,
              dependsOnTaskId: newDependsOnId,
              type: dep.type,
              lagMinutes: dep.lagMinutes,
            },
          });
        }
      }
    }

    return {
      taskCount: taskIdMapping.size,
      taskIdMapping,
    };
  }

  /**
   * Clone project members
   */
  private async cloneMembers(
    tx: Prisma.TransactionClient,
    sourceMembers: ProjectMember[],
    newProjectId: string,
    actorId: string,
  ): Promise<number> {
    let count = 0;

    for (const member of sourceMembers) {
      await tx.projectMember.create({
        data: {
          id: randomUUID(),
          projectId: newProjectId,
          userId: member.userId,
          role: member.role,
          allocationPct: member.allocationPct,
          joinedAt: new Date(),
          leftAt: null,
        },
      });
      count++;
    }

    return count;
  }

  /**
   * Clone documents with updated task references
   */
  private async cloneDocuments(
    tx: Prisma.TransactionClient,
    sourceDocuments: Array<
      Document & {
        versions: DocumentVersion[];
        linkedTasks: Pick<DocumentTask, 'taskId'>[];
      }
    >,
    newProjectId: string,
    taskIdMapping: Map<string, string>,
    actorId: string,
  ): Promise<number> {
    let count = 0;

    for (const doc of sourceDocuments) {
      const newDocId = randomUUID();
      const storageKey = `documents/${newDocId}`;
      const newLinkedTaskIds = (doc.linkedTaskIds || [])
        .map((oldTaskId: string) => taskIdMapping.get(oldTaskId))
        .filter((taskId): taskId is string => Boolean(taskId));

      await tx.document.create({
        data: {
          id: newDocId,
          projectId: newProjectId,
          title: doc.title,
          docType: doc.docType,
          classification: doc.classification,
          ownerId: doc.ownerId ?? actorId,
          storageKey,
          tags: doc.tags,
          linkedTaskIds: newLinkedTaskIds,
          linkedKpiIds: doc.linkedKpiIds || [],
          retentionPolicy: doc.retentionPolicy,
        },
      });

      const versionIdMap = new Map<string, string>();

      for (const version of doc.versions) {
        const newVersionId = randomUUID();
        const targetKey = `${storageKey}/${newVersionId}`;

        await this.documentStorage.copyObject(version.storageKey, targetKey);

        await tx.documentVersion.create({
          data: {
            id: newVersionId,
            documentId: newDocId,
            versionNo: version.versionNo,
            status: version.status,
            checksum: version.checksum,
            sizeBytes: version.sizeBytes,
            mimeType: version.mimeType,
            storageKey: targetKey,
            virusScanStatus: version.virusScanStatus,
            approvalChain: version.approvalChain as any,
            createdBy: actorId,
          },
        });

        versionIdMap.set(version.id, newVersionId);
      }

      if (doc.currentVersionId) {
        const mappedVersion = versionIdMap.get(doc.currentVersionId);
        if (mappedVersion) {
          await tx.document.update({
            where: { id: newDocId },
            data: { currentVersionId: mappedVersion },
          });
        }
      }

      if (doc.linkedTasks?.length) {
        for (const link of doc.linkedTasks) {
          const mappedTaskId = taskIdMapping.get(link.taskId);
          if (!mappedTaskId) {
            continue;
          }

          await tx.documentTask.create({
            data: {
              id: randomUUID(),
              documentId: newDocId,
              taskId: mappedTaskId,
              linkedBy: actorId,
            },
          });
        }
      }

      count++;
    }

    return count;
  }

  /**
   * Create a project template (mark project as template)
   */
  async createTemplate(
    projectId: string,
    actorId: string,
  ): Promise<Project> {
    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        metadata: {
          ...((await this.prisma.project.findUnique({ where: { id: projectId } }))?.metadata as any ?? {}),
          isTemplate: true,
          templateCreatedAt: new Date().toISOString(),
          templateCreatedBy: actorId,
        },
      },
    });

    await this.auditService.logAuthEvent('AUTH_LOGIN_SUCCESS', {
      actorId,
      detail: `Marked project ${project.code} as template`,
      metadata: { projectId },
    });

    return project;
  }

  /**
   * Get all project templates
   */
  async getTemplates(): Promise<Project[]> {
    const projects = await this.prisma.project.findMany({
      where: {
        metadata: {
          path: ['isTemplate'],
          equals: true,
        },
      },
      include: {
        _count: {
          select: {
            tasks: true,
            members: true,
            documents: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return projects;
  }

  /**
   * Clone from template with defaults
   */
  async cloneFromTemplate(
    templateId: string,
    options: Omit<CloneProjectOptions, 'copyTasks' | 'copyDocuments' | 'copyMembers'>,
    actorId: string,
  ): Promise<CloneResult> {
    // Verify it's a template
    const template = await this.prisma.project.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new Error(`Template ${templateId} not found`);
    }

    const metadata = template.metadata as any;
    if (!metadata?.isTemplate) {
      throw new Error(`Project ${templateId} is not a template`);
    }

    // Clone with default settings for templates
    return this.cloneProject(
      templateId,
      {
        ...options,
        copyTasks: true,
        copyDocuments: false, // Don't copy documents from templates
        copyMembers: false, // Don't copy members from templates
        preserveStatus: false,
      },
      actorId,
    );
  }
}
