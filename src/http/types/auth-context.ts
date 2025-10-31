export interface AuthenticatedRequestUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: string[];
}
