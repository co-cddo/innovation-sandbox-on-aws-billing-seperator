/**
 * Tests for UnquarantineLambda Handler
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// Mock AWS SDK clients before importing handler
const mockSendOrgs = jest.fn<() => Promise<unknown>>();
const mockSendScheduler = jest.fn<() => Promise<unknown>>();
const mockSendDynamo = jest.fn<() => Promise<unknown>>();

// Custom error class for ResourceNotFoundException
class MockResourceNotFoundException extends Error {
  name = 'ResourceNotFoundException';
  constructor(message: string) {
    super(message);
  }
}

jest.unstable_mockModule('@aws-sdk/client-organizations', () => ({
  OrganizationsClient: jest.fn().mockImplementation(() => ({
    send: mockSendOrgs,
  })),
  MoveAccountCommand: jest.fn(),
  ListOrganizationalUnitsForParentCommand: jest.fn(),
  paginateListOrganizationalUnitsForParent: jest.fn(),
}));

jest.unstable_mockModule('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: jest.fn().mockImplementation(() => ({
    send: mockSendScheduler,
  })),
  DeleteScheduleCommand: jest.fn(),
  ResourceNotFoundException: MockResourceNotFoundException,
}));

jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.unstable_mockModule('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: mockSendDynamo,
    }),
  },
  GetCommand: jest.fn(),
  PutCommand: jest.fn(),
}));

// Mock ISB commons - using any to avoid jest-globals strict typing issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetIsbOu: jest.Mock<any> = jest.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTransactionalMoveAccount: jest.Mock<any> = jest.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAccountStoreGet: jest.Mock<any> = jest.fn();

jest.unstable_mockModule(
  '@amzn/innovation-sandbox-commons/isb-services/sandbox-ou-service.js',
  () => ({
    SandboxOuService: jest.fn().mockImplementation(() => ({
      getIsbOu: mockGetIsbOu,
      transactionalMoveAccount: mockTransactionalMoveAccount,
    })),
  })
);

jest.unstable_mockModule(
  '@amzn/innovation-sandbox-commons/data/sandbox-account/dynamo-sandbox-account-store.js',
  () => ({
    DynamoSandboxAccountStore: jest.fn().mockImplementation(() => ({
      get: mockAccountStoreGet,
    })),
  })
);

jest.unstable_mockModule(
  '@amzn/innovation-sandbox-commons/utils/cross-account-roles.js',
  () => ({
    fromTemporaryIsbOrgManagementCredentials: jest.fn().mockReturnValue({}),
  })
);

// Helper to create scheduler payload
function createSchedulerPayload(overrides: Partial<{
  accountId: string;
  quarantinedAt: string;
  schedulerName: string;
}> = {}) {
  return {
    accountId: '417845783913',
    quarantinedAt: '2026-01-25T14:44:00.000Z', // 72+ hours ago
    schedulerName: 'isb-billing-sep-unquarantine-417845783913-1706194860000',
    ...overrides,
  };
}

// Store original env
const originalEnv = process.env;

describe('UnquarantineLambda Handler', () => {
  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Set required environment variables
    process.env = {
      ...originalEnv,
      ACCOUNT_TABLE_NAME: 'isb-accounts',
      SANDBOX_OU_ID: 'ou-2laj-sandbox',
      INTERMEDIATE_ROLE_ARN: 'arn:aws:iam::123456789012:role/IntermediateRole',
      ORG_MGT_ROLE_ARN: 'arn:aws:iam::999999999999:role/OrgMgtRole',
      USER_AGENT_EXTRA: 'isb-billing-separator/1.0.0',
    };

    // Default mock implementations
    mockGetIsbOu.mockImplementation(async (ouName: unknown) => {
      const ous: Record<string, { Id: string; Name: string }> = {
        CleanUp: { Id: 'ou-2laj-x3o8lbk8', Name: 'CleanUp' },
        Quarantine: { Id: 'ou-2laj-quarantine', Name: 'Quarantine' },
        Available: { Id: 'ou-2laj-oihxgbtr', Name: 'Available' },
      };
      return ous[ouName as string];
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockTransactionalMoveAccount.mockReturnValue({
      beginTransaction: jest.fn<any>().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn<any>().mockResolvedValue(undefined),
    });

    mockAccountStoreGet.mockResolvedValue({
      result: {
        awsAccountId: '417845783913',
        status: 'Quarantine',
        email: 'test@example.com',
      },
    });

    mockSendScheduler.mockResolvedValue({});
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('happy path: Quarantine → Available', () => {
    it('should release account and delete scheduler', async () => {
      // Import handler dynamically after mocks are set up
      const { handler } = await import('./handler.js');

      const payload = createSchedulerPayload();
      const result = await handler(payload);

      // Should succeed
      expect(result.success).toBe(true);
      expect(result.action).toBe('RELEASED');
      expect(result.accountId).toBe('417845783913');

      // Should have called transactionalMoveAccount
      expect(mockTransactionalMoveAccount).toHaveBeenCalledWith(
        expect.objectContaining({ awsAccountId: '417845783913' }),
        'Quarantine',
        'Available'
      );

      // Should have deleted scheduler
      expect(mockSendScheduler).toHaveBeenCalled();
    });
  });

  describe('skip path: account not in Quarantine status', () => {
    it('should skip release when account is in different status', async () => {
      // Mock account in CleanUp status (unexpected)
      mockAccountStoreGet.mockResolvedValue({
        result: {
          awsAccountId: '417845783913',
          status: 'CleanUp',
          email: 'test@example.com',
        },
      });

      const { handler } = await import('./handler.js');

      const payload = createSchedulerPayload();
      const result = await handler(payload);

      // Should succeed (skip is a success)
      expect(result.success).toBe(true);
      expect(result.action).toBe('SKIPPED');
      expect(result.message).toContain('not in expected state');

      // Should NOT have called transactionalMoveAccount
      expect(mockTransactionalMoveAccount).not.toHaveBeenCalled();

      // Should STILL have deleted scheduler
      expect(mockSendScheduler).toHaveBeenCalled();
    });
  });

  describe('idempotency: account already in Available', () => {
    it('should skip release when account is already in Available status', async () => {
      // Mock account already in Available
      mockAccountStoreGet.mockResolvedValue({
        result: {
          awsAccountId: '417845783913',
          status: 'Available',
          email: 'test@example.com',
        },
      });

      const { handler } = await import('./handler.js');

      const payload = createSchedulerPayload();
      const result = await handler(payload);

      // Should succeed (skip is a success)
      expect(result.success).toBe(true);
      expect(result.action).toBe('SKIPPED');
      expect(result.message).toContain('already in Available status');

      // Should NOT have called transactionalMoveAccount
      expect(mockTransactionalMoveAccount).not.toHaveBeenCalled();

      // Should STILL have deleted scheduler
      expect(mockSendScheduler).toHaveBeenCalled();
    });
  });

  describe('skip path: account not found in ISB tracking', () => {
    it('should skip release when account is not found', async () => {
      // Mock account not found
      mockAccountStoreGet.mockResolvedValue({
        result: null,
      });

      const { handler } = await import('./handler.js');

      const payload = createSchedulerPayload();
      const result = await handler(payload);

      // Should succeed (skip is a success)
      expect(result.success).toBe(true);
      expect(result.action).toBe('SKIPPED');
      expect(result.message).toContain('not found in ISB tracking');

      // Should NOT have called transactionalMoveAccount
      expect(mockTransactionalMoveAccount).not.toHaveBeenCalled();

      // Should STILL have deleted scheduler
      expect(mockSendScheduler).toHaveBeenCalled();
    });
  });

  describe('error handling: OU move failure', () => {
    it('should throw error when transactionalMoveAccount fails', async () => {
      // Mock move failure
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockTransactionalMoveAccount.mockReturnValue({
        beginTransaction: jest.fn<any>().mockRejectedValue(new Error('OU move failed')),
        rollbackTransaction: jest.fn<any>().mockResolvedValue(undefined),
      });

      const { handler } = await import('./handler.js');

      const payload = createSchedulerPayload();

      // Should throw error
      await expect(handler(payload)).rejects.toThrow('OU move failed');

      // Scheduler should NOT have been deleted (error occurred before cleanup)
      expect(mockSendScheduler).not.toHaveBeenCalled();
    });
  });

  describe('scheduler cleanup: idempotent delete', () => {
    it('should handle scheduler already deleted gracefully', async () => {
      // First call: delete scheduler throws ResourceNotFoundException
      mockSendScheduler.mockRejectedValue(
        new MockResourceNotFoundException('Schedule not found')
      );

      const { handler } = await import('./handler.js');

      const payload = createSchedulerPayload();
      const result = await handler(payload);

      // Should still succeed (ResourceNotFoundException is handled gracefully)
      expect(result.success).toBe(true);
      expect(result.action).toBe('RELEASED');
    });

    it('should throw on non-ResourceNotFoundException scheduler errors', async () => {
      // Scheduler delete fails with different error
      mockSendScheduler.mockRejectedValue(new Error('Access denied'));

      const { handler } = await import('./handler.js');

      const payload = createSchedulerPayload();

      // Should throw error
      await expect(handler(payload)).rejects.toThrow('Scheduler deletion failed');
    });
  });

  describe('error handling: missing environment variables', () => {
    it('should throw when required environment variables are missing', async () => {
      // Remove required env var
      delete process.env.ACCOUNT_TABLE_NAME;

      // Need to clear module cache to pick up new env
      jest.resetModules();

      // Re-apply mocks after reset
      jest.unstable_mockModule('@aws-sdk/client-organizations', () => ({
        OrganizationsClient: jest.fn().mockImplementation(() => ({
          send: mockSendOrgs,
        })),
        MoveAccountCommand: jest.fn(),
        ListOrganizationalUnitsForParentCommand: jest.fn(),
        paginateListOrganizationalUnitsForParent: jest.fn(),
      }));

      const { handler } = await import('./handler.js');

      const payload = createSchedulerPayload();

      // Should throw
      await expect(handler(payload)).rejects.toThrow('Missing required environment variables');
    });
  });

  describe('payload validation', () => {
    it('should throw on invalid accountId', async () => {
      const { handler } = await import('./handler.js');

      const payload = createSchedulerPayload({ accountId: 'invalid' });

      await expect(handler(payload)).rejects.toThrow('Invalid scheduler payload');
    });

    it('should throw on invalid quarantinedAt', async () => {
      const { handler } = await import('./handler.js');

      const payload = createSchedulerPayload({ quarantinedAt: 'not-a-date' });

      await expect(handler(payload)).rejects.toThrow('Invalid scheduler payload');
    });

    it('should throw on missing schedulerName', async () => {
      const { handler } = await import('./handler.js');

      const payload = createSchedulerPayload({ schedulerName: '' });

      await expect(handler(payload)).rejects.toThrow('Invalid scheduler payload');
    });
  });
});
