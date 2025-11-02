import { DocumentService } from '../../src/modules/documents/document.service';
import { DocumentType, DocumentClassification, DocumentRetentionPolicy } from '@prisma/client';

describe('DocumentService - Unit Tests', () => {
  let mockPrisma: any;
  let mockStorage: any;
  let mockVirusScanner: any;
  let mockApprovalQueue: any;
  let mockLogger: any;
  let documentService: DocumentService;

  beforeEach(() => {
    mockPrisma = {
      project: {
        findUnique: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      document: {
        create: jest.fn(),
        findUnique: jest.fn(),
      },
      documentVersion: {
        create: jest.fn(),
      },
      $transaction: jest.fn((callback) => callback(mockPrisma)),
    };

    mockStorage = {
      uploadObject: jest.fn(),
    };

    mockVirusScanner = {
      scan: jest.fn(),
    };

    mockApprovalQueue = {
      enqueue: jest.fn(),
      scheduleApprovalJobs: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };

    documentService = new DocumentService(
      mockPrisma,
      mockStorage,
      mockVirusScanner,
      mockApprovalQueue,
      mockLogger
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should reject file larger than 150MB', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'project-123' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-123' });

    const largeFile = {
      buffer: Buffer.alloc(1000),
      size: 160 * 1024 * 1024,
      mimeType: 'application/pdf',
      originalName: 'large.pdf',
    };

    const input = {
      title: 'Large Doc',
      docType: DocumentType.PLAN,
      classification: DocumentClassification.INTERNAL,
      ownerId: 'user-123',
      retentionPolicy: DocumentRetentionPolicy.DEFAULT,
    };

    await expect(
      documentService.createDocument('project-123', 'user-123', input, largeFile)
    ).rejects.toThrow('File exceeds maximum allowed size');
  });

  test('should reject file with virus', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'project-123' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-123' });
    mockVirusScanner.scan.mockResolvedValue('infected');

    const file = {
      buffer: Buffer.from('EICAR'),
      size: 68,
      mimeType: 'text/plain',
      originalName: 'virus.txt',
    };

    const input = {
      title: 'Infected Doc',
      docType: DocumentType.PLAN,
      classification: DocumentClassification.INTERNAL,
      ownerId: 'user-123',
      retentionPolicy: DocumentRetentionPolicy.DEFAULT,
    };

    await expect(
      documentService.createDocument('project-123', 'user-123', input, file)
    ).rejects.toThrow('Uploaded file failed virus scan');
  });

  test('should create document with clean file', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'project-123' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-123' });
    mockVirusScanner.scan.mockResolvedValue('clean');

    const file = {
      buffer: Buffer.from('Clean file content'),
      size: 18,
      mimeType: 'text/plain',
      originalName: 'doc.txt',
    };

    const input = {
      title: 'Test Doc',
      docType: DocumentType.PLAN,
      classification: DocumentClassification.INTERNAL,
      ownerId: 'user-123',
      retentionPolicy: DocumentRetentionPolicy.DEFAULT,
    };

    const createdDocument = {
      id: 'doc-uuid',
      title: input.title,
      docType: input.docType,
      classification: input.classification,
    };

    mockPrisma.document.create.mockResolvedValue(createdDocument);
    mockPrisma.document.findUnique.mockResolvedValue(createdDocument);

    await documentService.createDocument('project-123', 'user-123', input, file);

    expect(mockStorage.uploadObject).toHaveBeenCalled();
    expect(mockPrisma.document.create).toHaveBeenCalled();
    expect(mockApprovalQueue.scheduleApprovalJobs).toHaveBeenCalled();
  });

  test('should validate project exists before creating document', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);

    const file = {
      buffer: Buffer.from('content'),
      size: 7,
      mimeType: 'text/plain',
      originalName: 'doc.txt',
    };

    const input = {
      title: 'Doc',
      docType: DocumentType.PLAN,
      classification: DocumentClassification.INTERNAL,
      ownerId: 'user-123',
      retentionPolicy: DocumentRetentionPolicy.DEFAULT,
    };

    await expect(
      documentService.createDocument('non-existent', 'user-123', input, file)
    ).rejects.toThrow('Project not found');
  });

  test('should validate owner exists before creating document', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'project-123' });
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'creator-123' });

    const file = {
      buffer: Buffer.from('content'),
      size: 7,
      mimeType: 'text/plain',
      originalName: 'doc.txt',
    };

    const input = {
      title: 'Doc',
      docType: DocumentType.PLAN,
      classification: DocumentClassification.INTERNAL,
      ownerId: 'non-existent',
      retentionPolicy: DocumentRetentionPolicy.DEFAULT,
    };

    await expect(
      documentService.createDocument('project-123', 'creator-123', input, file)
    ).rejects.toThrow('User not found');
  });
});
