import { badRequestError } from '../../common/errors';

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
}

export const defaultPasswordPolicy = (minLength: number): PasswordPolicy => ({
  minLength,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSymbol: true,
});

const uppercasePattern = /[A-Z]/;
const lowercasePattern = /[a-z]/;
const numberPattern = /[0-9]/;
const symbolPattern = /[^A-Za-z0-9]/;

export const validatePassword = (password: string, policy: PasswordPolicy) => {
  if (password.length < policy.minLength) {
    throw badRequestError(
      'PASSWORD_TOO_SHORT',
      'Password is too short',
      `Password must be at least ${policy.minLength} characters long`,
    );
  }

  if (policy.requireUppercase && !uppercasePattern.test(password)) {
    throw badRequestError(
      'PASSWORD_MISSING_UPPERCASE',
      'Password must include an uppercase letter',
    );
  }

  if (policy.requireLowercase && !lowercasePattern.test(password)) {
    throw badRequestError('PASSWORD_MISSING_LOWERCASE', 'Password must include a lowercase letter');
  }

  if (policy.requireNumber && !numberPattern.test(password)) {
    throw badRequestError('PASSWORD_MISSING_NUMBER', 'Password must include a number');
  }

  if (policy.requireSymbol && !symbolPattern.test(password)) {
    throw badRequestError('PASSWORD_MISSING_SYMBOL', 'Password must include a symbol');
  }
};
