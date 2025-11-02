import { ProjectService } from '../../src/modules/projects/project.service';
import { ProjectStatus } from '@prisma/client';

describe('ProjectService - Unit Tests', () => {
  let mockPrisma: any;
  let projectService: ProjectService;

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
      },
      project: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      projectCode: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((callback) => {
        // Execute callback with mock transaction prisma
        return callback({
          projectCode: mockPrisma.projectCode,
        });
      }),
    };

    projectService = new ProjectService(mockPrisma);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should validate sponsor exists before creating project', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const input = {
      name: 'Test Project',
      sponsorId: 'non-existent-sponsor',
      startDate: new Date('2025-01-01'),
    };

    await expect(projectService.createProject(input)).rejects.toThrow('Sponsor user must exist before project creation');
  });

  test('should create project with valid data', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'sponsor-123' });
    mockPrisma.project.count.mockResolvedValue(0);
    mockPrisma.project.findFirst.mockResolvedValue(null);
    
    // Mock projectCode sequence
    mockPrisma.projectCode.findUnique.mockResolvedValue(null); // No existing sequence
    mockPrisma.projectCode.create.mockResolvedValue({ year: 2025, nextSequence: 2 });
    
    const createdProject = {
      id: 'project-uuid',
      code: 'PRJ-2025-0001',
      name: 'Test Project',
      status: ProjectStatus.ACTIVE,
      sponsorId: 'sponsor-123',
      startDate: new Date('2025-01-01'),
      endDate: null,
      actualStart: null,
      actualEnd: null,
      budgetPlanned: null,
      pmoOwnerId: null,
      description: null,
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockPrisma.project.create.mockResolvedValue(createdProject);

    const input = {
      name: 'Test Project',
      sponsorId: 'sponsor-123',
      startDate: new Date('2025-01-01'),
    };

    const result = await projectService.createProject(input);

    expect(result).toBeDefined();
    expect(result.name).toBe(input.name);
    expect(result.code).toMatch(/^PRJ-\d{4}-\d{4}$/);
    expect(mockPrisma.project.create).toHaveBeenCalled();
  });

  test('should throw error when updating non-existent project', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);

    await expect(
      projectService.updateProject('non-existent-id', { name: 'New Name' })
    ).rejects.toThrow('Project not found');
  });

  test('should update project with valid data', async () => {
    const existing = {
      id: 'project-123',
      code: 'PROJ-2025-001',
      name: 'Old Name',
      status: ProjectStatus.ACTIVE,
      sponsorId: 'sponsor-123',
      startDate: new Date(),
    };

    const updated = {
      ...existing,
      name: 'Updated Name',
      status: ProjectStatus.ON_HOLD,
    };

    mockPrisma.project.findUnique.mockResolvedValue(existing);
    mockPrisma.project.update.mockResolvedValue(updated);

    const result = await projectService.updateProject('project-123', {
      name: 'Updated Name',
      status: ProjectStatus.ON_HOLD,
    });

    expect(result.name).toBe('Updated Name');
    expect(result.status).toBe(ProjectStatus.ON_HOLD);
  });

  test('should soft delete by setting status to CANCELLED', async () => {
    const existing = {
      id: 'project-123',
      status: ProjectStatus.ACTIVE,
      name: 'Project to Cancel',
    };

    const cancelled = {
      ...existing,
      status: ProjectStatus.CANCELLED,
    };

    mockPrisma.project.findUnique.mockResolvedValue(existing);
    mockPrisma.project.update.mockResolvedValue(cancelled);

    const result = await projectService.updateProject('project-123', {
      status: ProjectStatus.CANCELLED,
    });

    expect(result.status).toBe(ProjectStatus.CANCELLED);
  });

  test('should return paginated project list', async () => {
    const mockProjects = [
      {
        id: 'project-1',
        code: 'PROJ-2025-001',
        name: 'Project 1',
        status: ProjectStatus.ACTIVE,
      },
      {
        id: 'project-2',
        code: 'PROJ-2025-002',
        name: 'Project 2',
        status: ProjectStatus.ACTIVE,
      },
    ];

    mockPrisma.project.findMany.mockResolvedValue(mockProjects);
    mockPrisma.project.count.mockResolvedValue(2);

    const result = await projectService.listProjects({
      status: ProjectStatus.ACTIVE,
      page: 1,
      limit: 10,
    });

    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(2);
  });
});
