/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/source'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // ISB modules are mocked in tests, but Jest needs valid resolution paths
    '^@amzn/innovation-sandbox-commons/isb-services/sandbox-ou-service\\.js$':
      '<rootDir>/deps/isb/source/common/isb-services/sandbox-ou-service.ts',
    '^@amzn/innovation-sandbox-commons/data/sandbox-account/dynamo-sandbox-account-store\\.js$':
      '<rootDir>/deps/isb/source/common/data/sandbox-account/dynamo-sandbox-account-store.ts',
    '^@amzn/innovation-sandbox-commons/utils/cross-account-roles\\.js$':
      '<rootDir>/deps/isb/source/common/utils/cross-account-roles.ts',
    '^@amzn/innovation-sandbox-commons/data/sandbox-account/sandbox-account\\.js$':
      '<rootDir>/deps/isb/source/common/data/sandbox-account/sandbox-account.ts',
    '^@amzn/innovation-sandbox-commons/(.*)$': '<rootDir>/deps/isb/source/common/$1',
  },
  collectCoverageFrom: [
    'source/**/*.ts',
    'lib/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
