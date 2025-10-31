import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthService } from '../../../modules/auth/auth.service';
import { validationError } from '../../../common/errors';
import { getRequestId } from '../../middleware/request-context';

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export class AuthController {
  private readonly authService: AuthService;

  constructor(authService: AuthService) {
    this.authService = authService;
  }

  login = async (req: Request, res: Response) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const result = await this.authService.login(parsed.data.email, parsed.data.password, {
      ipAddress: req.ip,
      userAgent: req.header('user-agent') ?? undefined,
      requestId: getRequestId(res),
    });

    res.status(200).json({
      data: {
        type: 'authTokens',
        attributes: result.tokens,
        relationships: {
          user: {
            type: 'user',
            id: result.user.id,
            attributes: result.user,
          },
        },
      },
      meta: {
        requestId: getRequestId(res),
      },
    });
  };

  refresh = async (req: Request, res: Response) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error.flatten().fieldErrors);
    }

    const result = await this.authService.refresh(parsed.data.refreshToken, {
      ipAddress: req.ip,
      userAgent: req.header('user-agent') ?? undefined,
      requestId: getRequestId(res),
    });

    res.status(200).json({
      data: {
        type: 'authTokens',
        attributes: result.tokens,
        relationships: {
          user: {
            type: 'user',
            id: result.user.id,
            attributes: result.user,
          },
        },
      },
      meta: {
        requestId: getRequestId(res),
      },
    });
  };
}
