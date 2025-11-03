import { UserStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedRequestUser } from '../../types/auth-context';
import type { UserDTO, UserService } from '../../../modules/users/user.service';
import { unauthorizedError, validationError } from '../../../common/errors';
import { getRequestId } from '../../middleware/request-context';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().min(1).optional(),
  status: z.nativeEnum(UserStatus).optional(),
});

const createUserSchema = z.object({
  email: z.string().trim().email(),
  fullName: z.string().trim().min(1),
  password: z.string().min(8),
  roles: z.array(z.string().trim()).max(10).optional(),
  status: z.nativeEnum(UserStatus).optional(),
});

const updateUserSchema = z
  .object({
    email: z.string().trim().email().optional(),
    fullName: z.string().trim().min(1).optional(),
    password: z.string().min(8).optional(),
    roles: z.array(z.string().trim()).max(10).optional(),
    status: z.nativeEnum(UserStatus).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
    path: ['root'],
  });

export class UsersController {
  private readonly userService: UserService;

  constructor(userService: UserService) {
    this.userService = userService;
  }

  list = async (req: Request, res: Response) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const result = await this.userService.listUsers(parsed.data);
    const totalPages = Math.max(1, Math.ceil(result.total / result.limit));

    res.status(200).json({
      data: result.users.map((user) => this.toResource(user)),
      meta: {
        requestId: getRequestId(res),
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages,
        },
      },
    });
  };

  getById = async (req: Request, res: Response) => {
    const user = await this.userService.getUserById(req.params.id);
    res.status(200).json({
      data: this.toResource(user),
      meta: {
        requestId: getRequestId(res),
      },
    });
  };

  create = async (req: Request, res: Response) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const user = await this.userService.createUser(parsed.data);

    res.status(201).json({
      data: this.toResource(user),
      meta: {
        requestId: getRequestId(res),
      },
    });
  };

  update = async (req: Request, res: Response) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const user = await this.userService.updateUser(req.params.id, parsed.data);

    res.status(200).json({
      data: this.toResource(user),
      meta: {
        requestId: getRequestId(res),
      },
    });
  };

  deactivate = async (req: Request, res: Response) => {
    const user = await this.userService.deactivateUser(req.params.id);

    res.status(200).json({
      data: this.toResource(user),
      meta: {
        requestId: getRequestId(res),
      },
    });
  };

  activate = async (req: Request, res: Response) => {
    const user = await this.userService.activateUser(req.params.id);

    res.status(200).json({
      data: this.toResource(user),
      meta: {
        requestId: getRequestId(res),
      },
    });
  };

  me = async (req: Request, res: Response) => {
    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    if (!authUser) {
      throw unauthorizedError('Authentication required');
    }

    const profile = await this.userService.getUserProfile(authUser.id);
    res.status(200).json({
      data: this.toResource(profile),
      meta: {
        requestId: getRequestId(res),
      },
    });
  };

  private toResource(user: UserDTO) {
    const { id, ...attributes } = user;
    return {
      type: 'user',
      id,
      attributes,
    };
  }
}
