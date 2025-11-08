import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  DocumentType,
  DocumentClassification,
  DocumentRetentionPolicy,
  DocumentApprovalDecision,
} from '@prisma/client';
import type {
  DocumentService,
  UploadFilePayload,
} from '../../../modules/documents/document.service';
import { validationError } from '../../../common/errors';
import { getRequestId } from '../../middleware/request-context';
import type { AuthenticatedRequestUser } from '../../types/auth-context';
import type { AuditService } from '../../../modules/audit/audit.service';

const createDocumentSchema = z.object({
  title: z.string().trim().min(3),
  docType: z.nativeEnum(DocumentType),
  classification: z.nativeEnum(DocumentClassification),
  ownerId: z.string().uuid(),
  tags: z
    .union([
      z.array(z.string().trim()),
      z.string().transform((val) => val.split(',').map((tag) => tag.trim())),
    ])
    .optional(),
  linkedTaskIds: z.array(z.string().uuid()).optional(),
  linkedKpiIds: z.array(z.string().uuid()).optional(),
  retentionPolicy: z.nativeEnum(DocumentRetentionPolicy),
});

const createVersionSchema = z.object({
  versionLabel: z
    .string()
    .trim()
    .regex(/^\d+\.\d+\.\d+$/, { message: 'Version label must follow semantic versioning' })
    .optional(),
});

const approveVersionSchema = z.object({
  decision: z.nativeEnum(DocumentApprovalDecision),
  comment: z.string().trim().max(500).optional(),
});

const listDocumentsSchema = z.object({
  projectId: z.string().uuid().optional(),
  docType: z.nativeEnum(DocumentType).optional(),
  classification: z.nativeEnum(DocumentClassification).optional(),
  tags: z
    .string()
    .transform((val) => val.split(',').map((tag) => tag.trim()))
    .optional(),
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((val) => [20, 50, 100].includes(val), {
    message: 'Page size must be 20, 50, or 100',
  }).default(20),
});

const serializeDocument = (document: Awaited<ReturnType<DocumentService['getDocument']>>) => ({
  type: 'document',
  id: document.id,
  attributes: {
    projectId: document.projectId,
    title: document.title,
    docType: document.docType,
    classification: document.classification,
    ownerId: document.ownerId,
    tags: document.tags,
    linkedTaskIds: document.linkedTaskIds,
    linkedKpiIds: document.linkedKpiIds,
    retentionPolicy: document.retentionPolicy,
    currentVersionId: document.currentVersionId,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  },
  relationships: {
    versions: document.versions.map((version) => ({
      type: 'documentVersion',
      id: version.id,
      attributes: {
        versionNo: version.versionNo,
        status: version.status,
        checksum: version.checksum,
        sizeBytes: version.sizeBytes.toString(),
        mimeType: version.mimeType,
        virusScanStatus: version.virusScanStatus,
        createdBy: version.createdBy,
        createdAt: version.createdAt.toISOString(),
      },
      relationships: {
        approvals: version.approvals.map((approval) => ({
          type: 'documentApproval',
          id: approval.id,
          attributes: {
            approverId: approval.approverId,
            decision: approval.decision,
            comment: approval.comment,
            decidedAt: approval.decidedAt.toISOString(),
          },
        })),
      },
    })),
  },
});

export class DocumentsController {
  private readonly documentService: DocumentService;

  private readonly auditService: AuditService;

  constructor(documentService: DocumentService, auditService: AuditService) {
    this.documentService = documentService;
    this.auditService = auditService;
    this.searchDocuments = DocumentsController.searchDocuments(documentService);
  }

  public searchDocuments: ReturnType<typeof DocumentsController.searchDocuments>;

  create = async (req: Request, res: Response) => {
    const parsed = createDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const { file } = req;
    if (!file) {
      throw validationError({ file: ['File is required'] });
    }

    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    if (!authUser) {
      throw validationError({ auth: ['Missing authenticated user'] });
    }

    const document = await this.documentService.createDocument(
      req.params.projectId,
      authUser.id,
      parsed.data,
      DocumentsController.mapFilePayload(file),
    );

    await this.auditService.logEvent('DOCUMENT_CREATED', {
      actorId: authUser.id,
      detail: `Uploaded document ${document.title}`,
      context: { requestId: getRequestId(res) },
      metadata: {
        documentId: document.id,
        projectId: document.projectId,
        ownerId: document.ownerId,
      },
    });

    res.status(201).json({
      data: serializeDocument(document),
      meta: { requestId: getRequestId(res) },
    });
  };

  getById = async (req: Request, res: Response) => {
    const document = await this.documentService.getDocument(req.params.documentId);
    res.status(200).json({
      data: serializeDocument(document),
      meta: { requestId: getRequestId(res) },
    });
  };

  download = async (req: Request, res: Response) => {
    const result = await this.documentService.downloadCurrentVersion(req.params.documentId);

    res.setHeader('Content-Type', result.contentType ?? 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.fileName.replace(/"/g, '')}"`,
    );

    result.stream.pipe(res);
  };

  createVersion = async (req: Request, res: Response) => {
    const parsed = createVersionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const { file } = req;
    if (!file) {
      throw validationError({ file: ['File is required'] });
    }

    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    if (!authUser) {
      throw validationError({ auth: ['Missing authenticated user'] });
    }

    const version = await this.documentService.createNewVersion(
      req.params.documentId,
      authUser.id,
      parsed.data,
      DocumentsController.mapFilePayload(file),
    );

    await this.auditService.logEvent('DOCUMENT_VERSION_SUBMITTED', {
      actorId: authUser.id,
      detail: `Uploaded new version for document ${req.params.documentId}`,
      context: { requestId: getRequestId(res) },
      metadata: {
        documentId: req.params.documentId,
        versionId: version.id,
        versionNo: version.versionNo,
      },
    });

    res.status(201).json({
      data: {
        type: 'documentVersion',
        id: version.id,
        attributes: {
          versionNo: version.versionNo,
          status: version.status,
          checksum: version.checksum,
          sizeBytes: version.sizeBytes.toString(),
          mimeType: version.mimeType,
          virusScanStatus: version.virusScanStatus,
          createdBy: version.createdBy,
          createdAt: version.createdAt.toISOString(),
        },
      },
      meta: { requestId: getRequestId(res) },
    });
  };

  approveVersion = async (req: Request, res: Response) => {
    const parsed = approveVersionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    if (!authUser) {
      throw validationError({ auth: ['Missing authenticated user'] });
    }

    const result = await this.documentService.approveVersion(
      req.params.versionId,
      authUser.id,
      parsed.data,
    );

    const eventCode =
      parsed.data.decision === DocumentApprovalDecision.APPROVED
        ? 'DOCUMENT_APPROVED'
        : 'DOCUMENT_REJECTED';
    await this.auditService.logEvent(eventCode, {
      actorId: authUser.id,
      detail: `${parsed.data.decision === DocumentApprovalDecision.APPROVED ? 'Approved' : 'Rejected'} document version ${req.params.versionId}`,
      context: { requestId: getRequestId(res) },
      metadata: {
        documentId: result.version.documentId,
        versionId: req.params.versionId,
        decision: parsed.data.decision,
      },
    });

    res.status(200).json({
      data: {
        type: 'documentApproval',
        id: result.approval.id,
        attributes: {
          versionId: result.approval.versionId,
          approverId: result.approval.approverId,
          decision: result.approval.decision,
          comment: result.approval.comment,
          decidedAt: result.approval.decidedAt.toISOString(),
        },
      },
      meta: { requestId: getRequestId(res) },
    });
  };

  list = async (req: Request, res: Response) => {
    const parsed = listDocumentsSchema.safeParse(req.query);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const { documents, pagination } = await this.documentService.listDocuments(parsed.data);

    res.json({
      data: documents.map((doc: {
        id: string;
        projectId: string;
        title: string;
        docType: string;
        classification: string;
        ownerId: string;
        tags: string[];
        linkedTaskIds: string[];
        linkedKpiIds: string[];
        retentionPolicy: string;
        createdAt: Date;
        updatedAt: Date;
        owner: { id: string; email: string; fullName: string };
        currentVersion: { id: string; versionNo: string; status: string; createdAt: Date } | null;
        project: { id: string; code: string; name: string };
      }) => ({
        type: 'document',
        id: doc.id,
        attributes: {
          title: doc.title,
          docType: doc.docType,
          classification: doc.classification,
          tags: doc.tags,
          retentionPolicy: doc.retentionPolicy,
          createdAt: doc.createdAt.toISOString(),
          updatedAt: doc.updatedAt.toISOString(),
        },
        relationships: {
          owner: {
            type: 'user',
            id: doc.owner.id,
            attributes: {
              email: doc.owner.email,
              fullName: doc.owner.fullName,
            },
          },
          currentVersion: doc.currentVersion
            ? {
                type: 'documentVersion',
                id: doc.currentVersion.id,
                attributes: {
                  versionNo: doc.currentVersion.versionNo,
                  status: doc.currentVersion.status,
                },
              }
            : null,
          project: {
            type: 'project',
            id: doc.project.id,
            attributes: {
              code: doc.project.code,
              name: doc.project.name,
            },
          },
        },
      })),
      meta: {
        requestId: getRequestId(res),
        pagination,
      },
    });
  };

  /**
   * Link a document to a task
   * POST /api/v1/documents/:documentId/link-task
   */
  linkToTask = async (req: Request, res: Response) => {
    const linkSchema = z.object({
      taskId: z.string().uuid(),
    });

    const parsed = linkSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const { authUser } = res.locals as { authUser: AuthenticatedRequestUser };
    const link = await this.documentService.linkDocumentToTask(
      req.params.documentId,
      parsed.data.taskId,
      authUser.id,
    );

    await this.auditService.logEvent('DOCUMENT_LINKED_TASK', {
      actorId: authUser.id,
      detail: `Linked document ${req.params.documentId} to task ${parsed.data.taskId}`,
      context: { requestId: getRequestId(res) },
      metadata: {
        documentId: req.params.documentId,
        taskId: parsed.data.taskId,
        linkId: link.id,
      },
    });

    res.status(201).json({
      data: {
        type: 'document-task-link',
        id: link.id,
        attributes: {
          documentId: link.documentId,
          taskId: link.taskId,
          linkedBy: link.linkedBy,
          linkedAt: link.linkedAt.toISOString(),
          document: {
            id: link.document.id,
            title: link.document.title,
            docType: link.document.docType,
          },
          task: {
            id: link.task.id,
            title: link.task.title,
            status: link.task.status,
          },
        },
      },
      meta: { requestId: getRequestId(res) },
    });
  };

  /**
   * Unlink a document from a task
   * DELETE /api/v1/documents/:documentId/unlink-task/:taskId
   */
  unlinkFromTask = async (req: Request, res: Response) => {
    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    const result = await this.documentService.unlinkDocumentFromTask(
      req.params.documentId,
      req.params.taskId,
    );

    await this.auditService.logEvent('DOCUMENT_UNLINKED_TASK', {
      actorId: authUser?.id ?? null,
      detail: `Unlinked document ${req.params.documentId} from task ${req.params.taskId}`,
      context: { requestId: getRequestId(res) },
      metadata: {
        documentId: req.params.documentId,
        taskId: req.params.taskId,
        linkId: result.linkId,
      },
    });

    res.status(200).json({
      data: {
        type: 'document-task-unlink',
        attributes: {
          success: result.success,
          linkId: result.linkId,
        },
      },
      meta: { requestId: getRequestId(res) },
    });
  };

  /**
   * Get all tasks linked to a document
   * GET /api/v1/documents/:documentId/tasks
   */
  getLinkedTasks = async (req: Request, res: Response) => {
    const links = await this.documentService.getTasksForDocument(req.params.documentId);

    res.status(200).json({
      data: links.map((link) => ({
        type: 'document-task-link',
        id: link.id,
        attributes: {
          linkedAt: link.linkedAt.toISOString(),
          task: {
            id: link.task.id,
            title: link.task.title,
            description: link.task.description,
            status: link.task.status,
            priority: link.task.priority,
            plannedStart: link.task.plannedStart?.toISOString(),
            plannedEnd: link.task.plannedEnd?.toISOString(),
            progressPct: link.task.progressPct,
            owner: {
              id: link.task.owner.id,
              fullName: link.task.owner.fullName,
              email: link.task.owner.email,
            },
            project: {
              id: link.task.project.id,
              code: link.task.project.code,
              name: link.task.project.name,
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

  /**
   * Full-text search documents
   * GET /api/v1/documents/search?q=query&limit=20&projectId=uuid
   */
  static searchDocuments = (documentService: DocumentService) => async (req: Request, res: Response) => {
    const authUser = res.locals.authUser as AuthenticatedRequestUser;
    const { q: query, limit, projectId } = req.query;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return validationError('INVALID_SEARCH_QUERY', 'Search query is required');
    }

    const parsedLimit = limit ? parseInt(limit as string, 10) : 20;
    if (Number.isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return validationError('INVALID_LIMIT', 'Limit must be between 1 and 100');
    }

    const options: { limit: number; projectId?: string } = { limit: parsedLimit };
    if (projectId && typeof projectId === 'string') {
      options.projectId = projectId;
    }

    const results = await documentService.searchDocuments(query.trim(), options);

    res.json({
      data: results.map((doc) => ({
        type: 'document',
        id: doc.id,
        attributes: {
          title: doc.title,
          docType: doc.docType,
          classification: doc.classification,
          projectId: doc.projectId,
          tags: doc.tags,
          createdAt: doc.createdAt.toISOString(),
          updatedAt: doc.updatedAt.toISOString(),
          rank: doc.rank,
          owner: doc.owner,
          project: doc.project,
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

  private static mapFilePayload(file: Express.Multer.File): UploadFilePayload {
    return {
      buffer: file.buffer,
      size: file.size,
      mimeType: file.mimetype,
      originalName: file.originalname,
    };
  }
}
