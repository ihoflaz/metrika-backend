import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.test.json',
        isolatedModules: true, // Skip type checking for faster test runs
      },
    ],
  },
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  reporters: ['default'],
  clearMocks: true,
  verbose: false,
  testTimeout: 30000, // 30 seconds timeout per test
  forceExit: true, // Force Jest to exit after all tests complete
  detectOpenHandles: true, // Detect open handles that prevent Jest from exiting
};

export default config;
