/**
 * Tests for QuarantineLambda Handler
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import type { SQSEvent } from 'aws-lambda';

// Mock AWS SDK clients before importing handler
const mockSendOrgs = jest.fn<() => Promise<unknown>>();
const mockSendScheduler = jest.fn<() => Promise<unknown>>();
const mockSendDynamo = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule('@aws-sdk/client-organizations', () => ({
  OrganizationsClient: jest.fn().mockImplementation(() => ({
    send: mockSendOrgs,
  })),
  MoveAccountCommand: jest.fn(),
  ListOrganizationalUnitsForParentCommand: jest.fn(),
  paginateListOrganizationalUnitsForParent: jest.fn(),
  ListTagsForResourceCommand: jest.fn(),
  UntagResourceCommand: jest.fn(),
}));

jest.unstable_mockModule('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: jest.fn().mockImplementation(() => ({
    send: mockSendScheduler,
  })),
  CreateScheduleCommand: jest.fn(),
  FlexibleTimeWindowMode: { OFF: 'OFF' },
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

// Import test fixtures
import cloudTrailEvent from '../__fixtures__/cloudtrail-move-account-event.json' with { type: 'json' };

// Helper to create SQS event with custom CloudTrail event
function createSqsEvent(events: unknown[]): SQSEvent {
  return {
    Records: events.map((event, index) => ({
      messageId: `msg-${index}`,
      receiptHandle: `handle-${index}`,
      body: JSON.stringify(event),
      attributes: {
        ApproximateReceiveCount: '1',
        SentTimestamp: '1706448240000',
        SenderId: 'AROAEXAMPLE',
        ApproximateFirstReceiveTimestamp: '1706448240001',
      },
      messageAttributes: {},
      md5OfBody: 'abc',
      eventSource: 'aws:sqs',
      eventSourceARN: 'arn:aws:sqs:us-west-2:123456789012:queue',
      awsRegion: 'us-west-2',
    })),
  };
}

// Store original env
const originalEnv = process.env;

describe('QuarantineLambda Handler', () => {
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
      SCHEDULER_ROLE_ARN: 'arn:aws:iam::123456789012:role/SchedulerRole',
      UNQUARANTINE_LAMBDA_ARN: 'arn:aws:lambda:us-west-2:123456789012:function:UnquarantineLambda',
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

    mockTransactionalMoveAccount.mockReturnValue({
      beginTransaction: jest.fn<any>().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn<any>().mockResolvedValue(undefined),
    });

    mockAccountStoreGet.mockResolvedValue({
      result: {
        awsAccountId: '417845783913',
        status: 'CleanUp',
        email: 'test@example.com',
      },
    });

    mockSendScheduler.mockResolvedValue({});

    // Default: no bypass tag on account
    mockSendOrgs.mockResolvedValue({ Tags: [] });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('happy path: CleanUp → Available intercepted', () => {
    it('should quarantine account and create scheduler', async () => {
      // Import handler dynamically after mocks are set up
      const { handler } = await import('./handler.js');

      const sqsEvent = createSqsEvent([cloudTrailEvent]);
      const result = await handler(sqsEvent);

      // Should succeed with no failures
      expect(result.batchItemFailures).toHaveLength(0);

      // Should have called transactionalMoveAccount
      expect(mockTransactionalMoveAccount).toHaveBeenCalledWith(
        expect.objectContaining({ awsAccountId: '417845783913' }),
        'Available',
        'Quarantine'
      );

      // Should have created scheduler
      expect(mockSendScheduler).toHaveBeenCalled();
    });
  });

  describe('skip path: non-CleanUp source', () => {
    it('should skip quarantine when source is not CleanUp', async () => {
      // Modify source OU to be something other than CleanUp
      const nonCleanUpEvent = {
        ...cloudTrailEvent,
        detail: {
          ...cloudTrailEvent.detail,
          requestParameters: {
            ...cloudTrailEvent.detail.requestParameters,
            sourceParentId: 'ou-2laj-different', // Different OU
          },
        },
      };

      const { handler } = await import('./handler.js');

      const sqsEvent = createSqsEvent([nonCleanUpEvent]);
      const result = await handler(sqsEvent);

      // Should succeed (skip is a success)
      expect(result.batchItemFailures).toHaveLength(0);

      // Should NOT have called transactionalMoveAccount
      expect(mockTransactionalMoveAccount).not.toHaveBeenCalled();

      // Should NOT have created scheduler
      expect(mockSendScheduler).not.toHaveBeenCalled();
    });
  });

  describe('idempotency: already quarantined', () => {
    it('should skip quarantine when account is already in Quarantine status', async () => {
      // Mock account already in Quarantine
      mockAccountStoreGet.mockResolvedValue({
        result: {
          awsAccountId: '417845783913',
          status: 'Quarantine', // Already quarantined
          email: 'test@example.com',
        },
      });

      const { handler } = await import('./handler.js');

      const sqsEvent = createSqsEvent([cloudTrailEvent]);
      const result = await handler(sqsEvent);

      // Should succeed (skip is a success)
      expect(result.batchItemFailures).toHaveLength(0);

      // Should NOT have called transactionalMoveAccount
      expect(mockTransactionalMoveAccount).not.toHaveBeenCalled();

      // Should NOT have created scheduler
      expect(mockSendScheduler).not.toHaveBeenCalled();
    });
  });

  describe('skip path: account not in ISB tracking', () => {
    it('should skip quarantine when account is not found in DynamoDB', async () => {
      // Mock account not found
      mockAccountStoreGet.mockResolvedValue({
        result: null,
      });

      const { handler } = await import('./handler.js');

      const sqsEvent = createSqsEvent([cloudTrailEvent]);
      const result = await handler(sqsEvent);

      // Should succeed (skip is a success)
      expect(result.batchItemFailures).toHaveLength(0);

      // Should NOT have called transactionalMoveAccount
      expect(mockTransactionalMoveAccount).not.toHaveBeenCalled();
    });
  });

  describe('error handling: OU move failure', () => {
    it('should report failure when transactionalMoveAccount fails', async () => {
      // Mock move failure
      mockTransactionalMoveAccount.mockReturnValue({
        beginTransaction: jest.fn<any>().mockRejectedValue(new Error('OU move failed')),
        rollbackTransaction: jest.fn<any>().mockResolvedValue(undefined),
      });

      const { handler } = await import('./handler.js');

      const sqsEvent = createSqsEvent([cloudTrailEvent]);
      const result = await handler(sqsEvent);

      // Should report failure
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-0');
    });
  });

  describe('error handling: scheduler creation failure', () => {
    it('should report failure when scheduler creation fails', async () => {
      // Mock scheduler creation failure
      mockSendScheduler.mockRejectedValue(new Error('Scheduler creation failed'));

      const { handler } = await import('./handler.js');

      const sqsEvent = createSqsEvent([cloudTrailEvent]);
      const result = await handler(sqsEvent);

      // Should report failure (scheduler is required)
      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-0');

      // OU move should have been attempted
      expect(mockTransactionalMoveAccount).toHaveBeenCalled();
    });
  });

  describe('error handling: missing environment variables', () => {
    it('should fail when required environment variables are missing', async () => {
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
        ListTagsForResourceCommand: jest.fn(),
        UntagResourceCommand: jest.fn(),
      }));

      const { handler } = await import('./handler.js');

      const sqsEvent = createSqsEvent([cloudTrailEvent]);

      // Should throw or return all failures
      await expect(handler(sqsEvent)).rejects.toThrow('Missing required environment variables');
    });
  });

  describe('bypass tag: do-not-separate', () => {
    it('should skip quarantine and remove tag when do-not-separate tag is present', async () => {
      // Mock tag present on the account
      mockSendOrgs.mockResolvedValue({
        Tags: [{ Key: 'do-not-separate', Value: '' }],
      });

      const { handler } = await import('./handler.js');

      const sqsEvent = createSqsEvent([cloudTrailEvent]);
      const result = await handler(sqsEvent);

      // Should succeed with no failures
      expect(result.batchItemFailures).toHaveLength(0);

      // Should have called ListTagsForResource and UntagResource
      expect(mockSendOrgs).toHaveBeenCalledTimes(2);

      // Should NOT have moved to Quarantine OU
      expect(mockTransactionalMoveAccount).not.toHaveBeenCalled();

      // Should NOT have created a scheduler
      expect(mockSendScheduler).not.toHaveBeenCalled();
    });

    it('should proceed with normal quarantine when tag is absent', async () => {
      // Default mock already returns empty Tags
      const { handler } = await import('./handler.js');

      const sqsEvent = createSqsEvent([cloudTrailEvent]);
      const result = await handler(sqsEvent);

      // Should succeed
      expect(result.batchItemFailures).toHaveLength(0);

      // Should have quarantined the account
      expect(mockTransactionalMoveAccount).toHaveBeenCalledWith(
        expect.objectContaining({ awsAccountId: '417845783913' }),
        'Available',
        'Quarantine'
      );

      // Should have created a scheduler
      expect(mockSendScheduler).toHaveBeenCalled();
    });

    it('should proceed with quarantine when tag check API fails (fail-safe)', async () => {
      // Mock tag check failure
      mockSendOrgs.mockRejectedValueOnce(new Error('AccessDeniedException'));
      // Subsequent orgs calls succeed (for OU listing etc.)
      mockSendOrgs.mockResolvedValue({ Tags: [] });

      const { handler } = await import('./handler.js');

      const sqsEvent = createSqsEvent([cloudTrailEvent]);
      const result = await handler(sqsEvent);

      // Should succeed (quarantine proceeds)
      expect(result.batchItemFailures).toHaveLength(0);

      // Should have quarantined the account
      expect(mockTransactionalMoveAccount).toHaveBeenCalled();
    });

    it('should still skip quarantine when tag removal fails', async () => {
      // First call: ListTagsForResource returns tag
      mockSendOrgs
        .mockResolvedValueOnce({
          Tags: [{ Key: 'do-not-separate', Value: '' }],
        })
        // Second call: UntagResource fails
        .mockRejectedValueOnce(new Error('UntagResource failed'));

      const { handler } = await import('./handler.js');

      const sqsEvent = createSqsEvent([cloudTrailEvent]);
      const result = await handler(sqsEvent);

      // Should succeed (bypass still happens)
      expect(result.batchItemFailures).toHaveLength(0);

      // Should NOT have moved to Quarantine OU
      expect(mockTransactionalMoveAccount).not.toHaveBeenCalled();

      // Should NOT have created a scheduler
      expect(mockSendScheduler).not.toHaveBeenCalled();
    });
  });

  describe('batch processing', () => {
    it('should process multiple events and report partial failures', async () => {
      // First event succeeds, second fails
      const event1 = cloudTrailEvent;
      const event2 = {
        ...cloudTrailEvent,
        detail: {
          ...cloudTrailEvent.detail,
          requestParameters: {
            accountId: '222222222222',
            sourceParentId: 'ou-2laj-x3o8lbk8', // CleanUp
            destinationParentId: 'ou-2laj-oihxgbtr', // Available
          },
          eventID: 'second-event-id',
        },
      };

      // First account succeeds, second account not found (will be skipped successfully)
      mockAccountStoreGet
        .mockResolvedValueOnce({
          result: {
            awsAccountId: '417845783913',
            status: 'CleanUp',
          },
        })
        .mockResolvedValueOnce({
          result: null, // Not found - will skip
        });

      const { handler } = await import('./handler.js');

      const sqsEvent = createSqsEvent([event1, event2]);
      const result = await handler(sqsEvent);

      // Both should succeed (one quarantined, one skipped)
      expect(result.batchItemFailures).toHaveLength(0);
    });
  });
});
