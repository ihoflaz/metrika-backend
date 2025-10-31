import 'express-serve-static-core';
import type { AuthenticatedRequestUser } from '../../http/types/auth-context';

declare module 'express-serve-static-core' {
  interface ResponseLocals {
    requestId?: string;
    authUser?: AuthenticatedRequestUser;
  }
}
