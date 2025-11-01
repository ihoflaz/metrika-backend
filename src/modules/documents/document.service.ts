import {
  PrismaClient,
  DocumentVersionStatus,
  VirusScanStatus,
  DocumentApprovalDecision,
  DocumentType,
  DocumentClassification,
  DocumentRetentionPolicy,
} from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { createHash } from 'node:crypto';
import { badRequestError, notFoundError } from '../../common/errors';
import { DocumentStorageService } from '../storage/document-storage.service';
import { VirusScannerService } from '../security/virus-scanner.service';
import { DocumentApprovalQueueService } from './document-approval-queue.service';
import type { Logger } from '../../lib/logger';

export interface UploadFilePayload {
  buffer: Buffer;
  size: number;
  mimeType: string;
  originalName: string;
}

export interface CreateDocumentInput {
  title: string;
  docType: DocumentType;
  classification: DocumentClassification;
  ownerId: string;
  tags?: string[];
  linkedTaskIds?: string[];
  linkedKpiIds?: string[];
  retentionPolicy: DocumentRetentionPolicy;
}

export interface CreateVersionInput {
  versionLabel?: string;
}

export interface ApproveVersionInput {
  decision: DocumentApprovalDecision;
  comment?: string | null;
}

const MAX_FILE_SIZE_BYTES = 150 * 1024 * 1024;

const toBigInt = (value: number) => BigInt(Math.floor(value));

export class DocumentService {
  private readonly prisma: PrismaClient;

  private readonly storageService: DocumentStorageService;

  private readonly virusScanner: VirusScannerService;

  private readonly approvalQueue: DocumentApprovalQueueService;

  private readonly logger: Logger;

  constructor(
    prisma: PrismaClient,
    storageService: DocumentStorageService,
    virusScanner: VirusScannerService,
    approvalQueue: DocumentApprovalQueueService,
    logger: Logger,
  ) {
    this.prisma = prisma;
    this.storageService = storageService;
    this.virusScanner = virusScanner;
    this.approvalQueue = approvalQueue;
    this.logger = logger;
  }

  async createDocument(
    projectId: string,
    createdBy: string,
    payload: CreateDocumentInput,
    file: UploadFilePayload,
  ) {
    await this.ensureProject(projectId);
    await this.ensureUser(payload.ownerId);
    await this.ensureUser(createdBy);

    DocumentService.ensureFileValid(file);

    const documentId = uuidv7();
    const versionId = uuidv7();
    const storageKey = `documents/${documentId}`;
    const objectKey = `${storageKey}/${versionId}`;

    await this.runVirusScanOrThrow(file.buffer, objectKey);
    await this.storageService.uploadObject(objectKey, file.buffer, file.mimeType);

    const checksum = DocumentService.computeChecksum(file.buffer);

    await this.prisma.$transaction(async (tx) => {
      await tx.document.create({
        data: {
          id: documentId,
          projectId,
          title: payload.title,
          docType: payload.docType,
          classification: payload.classification,
          ownerId: payload.ownerId,
          storageKey,
          tags: payload.tags ?? [],
          linkedTaskIds: payload.linkedTaskIds ?? [],
          linkedKpiIds: payload.linkedKpiIds ?? [],
          retentionPolicy: payload.retentionPolicy,
        },
      });

      await tx.documentVersion.create({
        data: {
          id: versionId,
          documentId,
          versionNo: '1.0.0',
          status: DocumentVersionStatus.IN_REVIEW,
          checksum,
          sizeBytes: toBigInt(file.size),
          mimeType: file.mimeType,
          storageKey: objectKey,
          virusScanStatus: VirusScanStatus.CLEAN,
          createdBy,
        },
        include: {
          approvals: true,
        },
      });
    });

    // Schedule approval reminder and escalation jobs
    await this.approvalQueue.scheduleApprovalJobs(documentId, versionId);

    return this.getDocument(documentId);
  }

  async getDocument(documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        versions: {
          orderBy: { createdAt: 'desc' },
          include: {
            approvals: true,
          },
        },
        currentVersion: true,
      },
    });

    if (!document) {
      throw notFoundError('DOCUMENT_NOT_FOUND', 'Document not found');
    }

    return document;
  }

  async downloadCurrentVersion(documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        title: true,
        currentVersion: {
          select: {
            id: true,
            storageKey: true,
            mimeType: true,
            versionNo: true,
          },
        },
      },
    });

    if (!document || !document.currentVersion) {
      throw notFoundError(
        'DOCUMENT_VERSION_NOT_AVAILABLE',
        'No approved version available for download',
      );
    }

    const { stream, contentType } = await this.storageService.getObjectStream(
      document.currentVersion.storageKey,
    );

    return {
      stream,
      contentType: contentType ?? document.currentVersion.mimeType,
      fileName: `${document.title}-v${document.currentVersion.versionNo}`,
    };
  }

  async createNewVersion(
    documentId: string,
    createdBy: string,
    payload: CreateVersionInput,
    file: UploadFilePayload,
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: {
        versions: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            versionNo: true,
          },
        },
      },
    });

    if (!document) {
      throw notFoundError('DOCUMENT_NOT_FOUND', 'Document not found');
    }

    await this.ensureUser(createdBy);
    DocumentService.ensureFileValid(file);

    const latestVersion = document.versions.at(0);
    const nextVersionNo = payload.versionLabel ?? this.incrementVersion(latestVersion?.versionNo);
    const versionId = uuidv7();
    const objectKey = `${document.storageKey}/${versionId}`;

    await this.runVirusScanOrThrow(file.buffer, objectKey);
    await this.storageService.uploadObject(objectKey, file.buffer, file.mimeType);

    const checksum = DocumentService.computeChecksum(file.buffer);

    const version = await this.prisma.documentVersion.create({
      data: {
        id: versionId,
        documentId,
        versionNo: nextVersionNo,
        status: DocumentVersionStatus.IN_REVIEW,
        checksum,
        sizeBytes: toBigInt(file.size),
        mimeType: file.mimeType,
        storageKey: objectKey,
        virusScanStatus: VirusScanStatus.CLEAN,
        createdBy,
      },
      include: {
        approvals: true,
      },
    });

    // Schedule approval reminder and escalation jobs
    await this.approvalQueue.scheduleApprovalJobs(documentId, versionId);

    return version;
  }

  async approveVersion(versionId: string, approverId: string, input: ApproveVersionInput) {
    const version = await this.prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: {
        document: {
          select: {
            id: true,
            currentVersionId: true,
          },
        },
        approvals: true,
      },
    });

    if (!version) {
      throw notFoundError('DOCUMENT_VERSION_NOT_FOUND', 'Document version not found');
    }

    await this.ensureUser(approverId);

    if (version.status === DocumentVersionStatus.ARCHIVED) {
      throw badRequestError(
        'DOCUMENT_VERSION_ARCHIVED',
        'Archived document versions cannot be approved',
      );
    }

    const approval = await this.prisma.documentApproval.upsert({
      where: {
        versionId_approverId: {
          versionId,
          approverId,
        },
      },
      update: {
        decision: input.decision,
        comment: input.comment ?? null,
        decidedAt: new Date(),
      },
      create: {
        id: uuidv7(),
        versionId,
        approverId,
        decision: input.decision,
        comment: input.comment ?? null,
      },
    });

    if (input.decision === DocumentApprovalDecision.REJECTED) {
      await this.prisma.documentVersion.update({
        where: { id: versionId },
        data: { status: DocumentVersionStatus.ARCHIVED },
      });

      // Cancel approval jobs since document is rejected
      await this.approvalQueue.cancelApprovalJobs(versionId);

      return {
        approval,
        version: await this.getDocumentVersion(versionId),
      };
    }

    const approvedCount = await this.prisma.documentApproval.count({
      where: {
        versionId,
        decision: DocumentApprovalDecision.APPROVED,
      },
    });

    if (approvedCount >= 2) {
      await this.prisma.$transaction(async (tx) => {
        if (version.document.currentVersionId && version.document.currentVersionId !== versionId) {
          await tx.documentVersion.update({
            where: { id: version.document.currentVersionId },
            data: { status: DocumentVersionStatus.ARCHIVED },
          });
        }

        await tx.documentVersion.update({
          where: { id: versionId },
          data: { status: DocumentVersionStatus.PUBLISHED },
        });

        await tx.document.update({
          where: { id: version.document.id },
          data: { currentVersionId: versionId },
        });
      });

      // Cancel approval jobs since document is fully approved
      await this.approvalQueue.cancelApprovalJobs(versionId);
    }

    return {
      approval,
      version: await this.getDocumentVersion(versionId),
    };
  }

  private static ensureFileValid(file: UploadFilePayload) {
    if (!file.buffer || file.size === 0) {
      throw badRequestError('DOCUMENT_FILE_INVALID', 'File payload is empty');
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw badRequestError('DOCUMENT_FILE_TOO_LARGE', 'File exceeds maximum allowed size');
    }
  }

  private async ensureProject(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!project) {
      throw notFoundError('PROJECT_NOT_FOUND', 'Project not found');
    }
  }

  private async ensureUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!user) {
      throw badRequestError('USER_NOT_FOUND', 'User not found');
    }
  }

  private static computeChecksum(buffer: Buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }

  private incrementVersion(current?: string) {
    if (!current) {
      return '1.0.0';
    }

    const parts = current.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
      this.logger.warn({ current }, 'Invalid version format, resetting to 1.0.0');
      return '1.0.0';
    }

    parts[2] += 1;
    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }

  private async runVirusScanOrThrow(buffer: Buffer, objectKey: string) {
    const result = await this.virusScanner.scan(buffer);
    if (result === 'infected') {
      this.logger.warn({ objectKey }, 'Virus detected in uploaded file');
      throw badRequestError('DOCUMENT_VIRUS_DETECTED', 'Uploaded file failed virus scan');
    }
  }

  private async getDocumentVersion(versionId: string) {
    return this.prisma.documentVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: {
        approvals: true,
      },
    });
  }

  async listDocuments(filters: {
    projectId?: string;
    docType?: DocumentType;
    classification?: DocumentClassification;
    tags?: string[];
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const {
      projectId,
      docType,
      classification,
      tags,
      search,
      page = 1,
      pageSize = 20,
    } = filters;

    // Validate page size
    if (![20, 50, 100].includes(pageSize)) {
      throw badRequestError('INVALID_PAGE_SIZE', 'Page size must be 20, 50, or 100');
    }

    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where: {
      projectId?: string;
      docType?: DocumentType;
      classification?: DocumentClassification;
      tags?: { hasSome: string[] };
      OR?: Array<{ title?: { contains: string; mode: 'insensitive' } }>;
    } = {};

    if (projectId) {
      where.projectId = projectId;
    }

    if (docType) {
      where.docType = docType;
    }

    if (classification) {
      where.classification = classification;
    }

    if (tags && tags.length > 0) {
      where.tags = { hasSome: tags };
    }

    if (search) {
      where.OR = [{ title: { contains: search, mode: 'insensitive' } }];
    }

    const [documents, total] = await Promise.all([
      this.prisma.document.findMany({
        where,
        skip,
        take,
        include: {
          owner: {
            select: {
              id: true,
              email: true,
              fullName: true,
            },
          },
          currentVersion: {
            select: {
              id: true,
              versionNo: true,
              status: true,
              createdAt: true,
            },
          },
          project: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.prisma.document.count({ where }),
    ]);

    return {
      documents,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }
}
