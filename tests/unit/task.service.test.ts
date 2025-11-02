import { TaskService } from '../../src/modules/tasks/task.service';
import { TaskStatus, TaskPriority, TaskDependencyType } from '@prisma/client';

describe('TaskService - Unit Tests', () => {
  let mockPrisma: any;
  let taskService: TaskService;

  beforeEach(() => {
    mockPrisma = {
      project: {
        findUnique: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      task: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      taskDependency: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    taskService = new TaskService(mockPrisma);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should validate project exists before creating task', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null);

    const input = {
      projectId: 'non-existent',
      title: 'Test Task',
      ownerId: 'user-123',
    };

    await expect(taskService.createTask(input)).rejects.toThrow('Project not found');
  });

  test('should validate owner exists before creating task', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'project-123' });
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const input = {
      projectId: 'project-123',
      title: 'Test Task',
      ownerId: 'non-existent',
    };

    await expect(taskService.createTask(input)).rejects.toThrow('User not found');
  });

  test('should validate progress percentage is between 0-100', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'project-123' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-123' });

    const input = {
      projectId: 'project-123',
      title: 'Test Task',
      ownerId: 'user-123',
      progressPct: 150,
    };

    await expect(taskService.createTask(input)).rejects.toThrow('Progress must be between 0 and 100');
  });

  test('should create task with default values', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'project-123' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-123' });

    const createdTask = {
      id: 'task-uuid',
      projectId: 'project-123',
      title: 'Test Task',
      status: TaskStatus.PLANNED,
      priority: TaskPriority.NORMAL,
      ownerId: 'user-123',
      progressPct: 0,
    };

    mockPrisma.task.create.mockResolvedValue(createdTask);

    const input = {
      projectId: 'project-123',
      title: 'Test Task',
      ownerId: 'user-123',
    };

    const result = await taskService.createTask(input);

    expect(result).toBeDefined();
    expect(result.status).toBe(TaskStatus.PLANNED);
    expect(result.priority).toBe(TaskPriority.NORMAL);
    expect(result.progressPct).toBe(0);
  });

  test('should update task status', async () => {
    const existing = {
      id: 'task-123',
      title: 'Old Title',
      status: TaskStatus.PLANNED,
      ownerId: 'user-123',
    };

    const updated = {
      ...existing,
      status: TaskStatus.IN_PROGRESS,
    };

    mockPrisma.task.findUnique.mockResolvedValue(existing);
    mockPrisma.task.update.mockResolvedValue(updated);

    const result = await taskService.updateTask('task-123', {
      status: TaskStatus.IN_PROGRESS,
    });

    expect(result.status).toBe(TaskStatus.IN_PROGRESS);
  });

  test('should update task with new owner', async () => {
    const existing = {
      id: 'task-123',
      title: 'Task',
      ownerId: 'user-old',
    };

    const updated = {
      ...existing,
      ownerId: 'user-new',
    };

    mockPrisma.task.findUnique.mockResolvedValue(existing);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-new' });
    mockPrisma.task.update.mockResolvedValue(updated);

    const result = await taskService.updateTask('task-123', {
      ownerId: 'user-new',
    });

    expect(result.ownerId).toBe('user-new');
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-new' },
      select: { id: true },
    });
  });

  test('should list project tasks ordered by planned start', async () => {
    mockPrisma.project.findUnique.mockResolvedValue({ id: 'project-123' });
    mockPrisma.task.findMany.mockResolvedValue([
      { id: 'task-1', title: 'Task 1', plannedStart: new Date('2025-01-01') },
      { id: 'task-2', title: 'Task 2', plannedStart: new Date('2025-01-02') },
    ]);

    const result = await taskService.listProjectTasks('project-123');

    expect(result).toHaveLength(2);
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'project-123' },
        orderBy: [{ plannedStart: 'asc' }, { createdAt: 'asc' }],
      })
    );
  });

  test('should throw error when task not found during update', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);

    await expect(
      taskService.updateTask('non-existent', { title: 'New Title' })
    ).rejects.toThrow('Task not found');
  });
});
