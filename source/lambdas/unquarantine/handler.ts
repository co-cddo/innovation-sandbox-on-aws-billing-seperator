/**
 * UnquarantineLambda Handler
 *
 * Releases accounts from Quarantine to Available OU after 72-hour quarantine period.
 * Triggered by EventBridge Scheduler with payload containing accountId and schedulerName.
 *
 * Event flow: EventBridge Scheduler → This Lambda (direct invocation)
 */

import { OrganizationsClient } from '@aws-sdk/client-organizations';
import {
  SchedulerClient,
  DeleteScheduleCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-scheduler';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';

// ISB Commons imports
import { SandboxOuService } from '@amzn/innovation-sandbox-commons/isb-services/sandbox-ou-service.js';
import { DynamoSandboxAccountStore } from '@amzn/innovation-sandbox-commons/data/sandbox-account/dynamo-sandbox-account-store.js';
import { fromTemporaryIsbOrgManagementCredentials } from '@amzn/innovation-sandbox-commons/utils/cross-account-roles.js';
import type { SandboxAccount, IsbOu } from '@amzn/innovation-sandbox-commons/data/sandbox-account/sandbox-account.js';

// Shared utilities
import type { SchedulerPayload, UnquarantineResult } from '../shared/types.js';
import {
  LOG_ACTIONS,
  ENV_KEYS,
  SCHEDULER_GROUP,
  USER_AGENT_SUFFIX,
} from '../shared/constants.js';

/**
 * Zod schema for scheduler payload validation
 */
const SchedulerPayloadSchema = z.object({
  accountId: z.string().regex(/^\d{12}$/, 'accountId must be 12 digits'),
  quarantinedAt: z.string().datetime({ message: 'quarantinedAt must be ISO 8601 datetime' }),
  schedulerName: z.string().min(1, 'schedulerName is required'),
});

/**
 * Environment configuration with validation
 */
interface LambdaEnv {
  ACCOUNT_TABLE_NAME: string;
  SANDBOX_OU_ID: string;
  INTERMEDIATE_ROLE_ARN: string;
  ORG_MGT_ROLE_ARN: string;
  USER_AGENT_EXTRA: string;
}

/**
 * Validates and returns required environment variables.
 * Throws if any required variable is missing.
 */
function getEnv(): LambdaEnv {
  const required = [
    'ACCOUNT_TABLE_NAME',
    'SANDBOX_OU_ID',
    'INTERMEDIATE_ROLE_ARN',
    'ORG_MGT_ROLE_ARN',
  ] as const;

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    ACCOUNT_TABLE_NAME: process.env[ENV_KEYS.ACCOUNT_TABLE_NAME]!,
    SANDBOX_OU_ID: process.env[ENV_KEYS.SANDBOX_OU_ID]!,
    INTERMEDIATE_ROLE_ARN: process.env[ENV_KEYS.INTERMEDIATE_ROLE_ARN]!,
    ORG_MGT_ROLE_ARN: process.env[ENV_KEYS.ORG_MGT_ROLE_ARN]!,
    USER_AGENT_EXTRA: process.env[ENV_KEYS.USER_AGENT_EXTRA] || USER_AGENT_SUFFIX,
  };
}

/**
 * Creates ISB services with cross-account credentials.
 */
function createServices(env: LambdaEnv) {
  // Organizations client with cross-account credentials
  const orgsCredentials = fromTemporaryIsbOrgManagementCredentials({
    INTERMEDIATE_ROLE_ARN: env.INTERMEDIATE_ROLE_ARN,
    ORG_MGT_ROLE_ARN: env.ORG_MGT_ROLE_ARN,
    USER_AGENT_EXTRA: env.USER_AGENT_EXTRA,
  });

  const orgsClient = new OrganizationsClient({
    credentials: orgsCredentials,
    customUserAgent: env.USER_AGENT_EXTRA,
  });

  // DynamoDB client (local to Hub account)
  const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  const accountStore = new DynamoSandboxAccountStore({
    client: ddbClient,
    accountTableName: env.ACCOUNT_TABLE_NAME,
  });

  const sandboxOuService = new SandboxOuService({
    namespace: 'isb-billing-sep',
    sandboxAccountStore: accountStore,
    sandboxOuId: env.SANDBOX_OU_ID,
    orgsClient,
  });

  // Scheduler client (local to Hub account)
  const schedulerClient = new SchedulerClient({});

  return { sandboxOuService, accountStore, schedulerClient };
}

/**
 * Structured logging helper
 */
function log(
  action: string,
  accountId: string,
  details: Record<string, unknown> = {}
): void {
  // Using console.log for Lambda structured logging
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      action,
      accountId,
      ...details,
    })
  );
}

/**
 * Parses and validates the scheduler payload.
 */
function parseSchedulerPayload(event: unknown): SchedulerPayload {
  const result = SchedulerPayloadSchema.safeParse(event);
  if (!result.success) {
    const errorMessages = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid scheduler payload: ${errorMessages}`);
  }
  return result.data;
}

/**
 * Deletes the scheduler that triggered this invocation.
 * Handles ResourceNotFoundException gracefully for idempotency.
 */
async function deleteScheduler(
  schedulerClient: SchedulerClient,
  schedulerName: string,
  accountId: string
): Promise<void> {
  try {
    await schedulerClient.send(
      new DeleteScheduleCommand({
        Name: schedulerName,
        GroupName: SCHEDULER_GROUP,
      })
    );

    log(LOG_ACTIONS.SCHEDULER_DELETED, accountId, {
      schedulerName,
      schedulerGroup: SCHEDULER_GROUP,
    });
  } catch (error) {
    // Handle already-deleted scheduler gracefully (idempotent)
    if (error instanceof ResourceNotFoundException) {
      log(LOG_ACTIONS.SCHEDULER_DELETED, accountId, {
        schedulerName,
        schedulerGroup: SCHEDULER_GROUP,
        note: 'Scheduler already deleted (idempotent)',
      });
      return;
    }

    // Re-throw other errors
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(LOG_ACTIONS.SCHEDULER_DELETE_FAILED, accountId, {
      error: errorMessage,
      schedulerName,
    });
    throw new Error(`Scheduler deletion failed for ${schedulerName}: ${errorMessage}`);
  }
}

/**
 * Lambda handler for processing EventBridge Scheduler invocations.
 *
 * Releases accounts from Quarantine to Available OU and cleans up the scheduler.
 */
export async function handler(event: unknown): Promise<UnquarantineResult> {
  // Validate environment
  const env = getEnv();
  const services = createServices(env);
  const { sandboxOuService, accountStore, schedulerClient } = services;

  // Parse and validate payload
  const payload = parseSchedulerPayload(event);
  const { accountId, quarantinedAt, schedulerName } = payload;

  log(LOG_ACTIONS.UNQUARANTINE_START, accountId, {
    quarantinedAt,
    schedulerName,
  });

  try {
    // Step 1: Get current account status for validation
    const accountResult = await accountStore.get(accountId);

    if (!accountResult.result) {
      // Account not in ISB tracking - skip but still cleanup scheduler
      log(LOG_ACTIONS.UNQUARANTINE_SKIP, accountId, {
        reason: 'Account not found in ISB tracking',
      });

      // Still delete the scheduler to prevent future invocations
      await deleteScheduler(schedulerClient, schedulerName, accountId);

      return {
        success: true,
        action: 'SKIPPED',
        accountId,
        message: 'Account not found in ISB tracking',
      };
    }

    const account = accountResult.result;

    // Idempotency: Skip OU move if already in Available
    if (account.status === 'Available') {
      log(LOG_ACTIONS.UNQUARANTINE_SKIP, accountId, {
        reason: 'Account already in Available status',
        currentStatus: account.status,
      });

      // Still delete the scheduler to prevent future invocations
      await deleteScheduler(schedulerClient, schedulerName, accountId);

      return {
        success: true,
        action: 'SKIPPED',
        accountId,
        message: 'Account already in Available status',
      };
    }

    // Validate account is in Quarantine status (FR8)
    if (account.status !== 'Quarantine') {
      log(LOG_ACTIONS.UNQUARANTINE_SKIP, accountId, {
        reason: 'Account not in Quarantine status',
        currentStatus: account.status,
        expectedStatus: 'Quarantine',
      });

      // Still delete the scheduler to prevent future invocations
      await deleteScheduler(schedulerClient, schedulerName, accountId);

      return {
        success: true,
        action: 'SKIPPED',
        accountId,
        message: `Account not in expected state: status is ${account.status}, expected Quarantine`,
      };
    }

    // Step 2: Move account to Available OU (FR6, FR7)
    const availableOu = await sandboxOuService.getIsbOu('Available');

    const transaction = sandboxOuService.transactionalMoveAccount(
      account as SandboxAccount,
      'Quarantine' as IsbOu,
      'Available' as IsbOu
    );

    await transaction.beginTransaction();

    log(LOG_ACTIONS.UNQUARANTINE_COMPLETE, accountId, {
      fromOu: 'Quarantine',
      toOu: 'Available',
      availableOuId: availableOu.Id,
      quarantinedAt,
      quarantineDuration: calculateQuarantineDuration(quarantinedAt),
    });

    // Step 3: Clean up the scheduler (FR35)
    await deleteScheduler(schedulerClient, schedulerName, accountId);

    return {
      success: true,
      action: 'RELEASED',
      accountId,
      message: 'Account released from quarantine to Available OU',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    log(LOG_ACTIONS.HANDLER_ERROR, accountId, {
      error: errorMessage,
      stack: errorStack,
      schedulerName,
    });

    // Re-throw to trigger retry
    throw error;
  }
}

/**
 * Calculates the actual quarantine duration in hours.
 */
function calculateQuarantineDuration(quarantinedAt: string): string {
  const quarantinedTime = new Date(quarantinedAt).getTime();
  const now = Date.now();
  const durationHours = (now - quarantinedTime) / (1000 * 60 * 60);
  return `${durationHours.toFixed(2)} hours`;
}
