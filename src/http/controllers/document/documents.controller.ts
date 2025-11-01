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

  constructor(documentService: DocumentService) {
    this.documentService = documentService;
  }

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

  private static mapFilePayload(file: Express.Multer.File): UploadFilePayload {
    return {
      buffer: file.buffer,
      size: file.size,
      mimeType: file.mimetype,
      originalName: file.originalname,
    };
  }
}
