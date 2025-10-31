import type { UserStatus } from '@prisma/client';

export interface AuthenticatedUserDTO {
  id: string;
  email: string;
  fullName: string;
  status: UserStatus;
  roles: string[];
  permissions: string[];
  lastLoginAt: string | null;
}

export interface AuthTokensDTO {
  accessToken: string;
  accessTokenExpiresAt: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  refreshTokenExpiresIn: number;
}

export interface LoginResponseDTO {
  tokens: AuthTokensDTO;
  user: AuthenticatedUserDTO;
}
