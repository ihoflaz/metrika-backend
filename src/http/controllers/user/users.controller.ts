import type { Request, Response } from 'express';
import type { AuthenticatedRequestUser } from '../../types/auth-context';
import type { UserService } from '../../../modules/users/user.service';
import { unauthorizedError } from '../../../common/errors';
import { getRequestId } from '../../middleware/request-context';

export class UsersController {
  private readonly userService: UserService;

  constructor(userService: UserService) {
    this.userService = userService;
  }

  me = async (req: Request, res: Response) => {
    const { authUser } = res.locals as { authUser?: AuthenticatedRequestUser };
    if (!authUser) {
      throw unauthorizedError('Authentication required');
    }

    const profile = await this.userService.getUserProfile(authUser.id);
    res.status(200).json({
      data: {
        type: 'user',
        id: profile.id,
        attributes: profile,
      },
      meta: {
        requestId: getRequestId(res),
      },
    });
  };
}
