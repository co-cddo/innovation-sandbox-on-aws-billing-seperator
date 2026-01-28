/**
 * QuarantineLambda Handler
 *
 * Intercepts CloudTrail MoveAccount events where accounts are moved to the Available OU.
 * If the source is CleanUp OU, the account is redirected to Quarantine OU for 72 hours.
 *
 * Event flow: CloudTrail → EventBridge → SQS → This Lambda
 */

import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { OrganizationsClient } from '@aws-sdk/client-organizations';
import { SchedulerClient, CreateScheduleCommand, FlexibleTimeWindowMode } from '@aws-sdk/client-scheduler';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// ISB Commons imports
import { SandboxOuService } from '@amzn/innovation-sandbox-commons/isb-services/sandbox-ou-service.js';
import { DynamoSandboxAccountStore } from '@amzn/innovation-sandbox-commons/data/sandbox-account/dynamo-sandbox-account-store.js';
import { fromTemporaryIsbOrgManagementCredentials } from '@amzn/innovation-sandbox-commons/utils/cross-account-roles.js';
import type { SandboxAccount, IsbOu } from '@amzn/innovation-sandbox-commons/data/sandbox-account/sandbox-account.js';

// Shared utilities
import { parseCloudTrailEvents } from '../shared/event-parser.js';
import type { ParsedMoveAccountEvent, QuarantineResult, SchedulerPayload } from '../shared/types.js';
import {
  LOG_ACTIONS,
  ENV_KEYS,
  QUARANTINE_DURATION_HOURS,
  SCHEDULER_GROUP,
  SCHEDULER_NAME_PREFIX,
  USER_AGENT_SUFFIX,
} from '../shared/constants.js';

/**
 * Environment configuration with validation
 */
interface LambdaEnv {
  ACCOUNT_TABLE_NAME: string;
  SANDBOX_OU_ID: string;
  INTERMEDIATE_ROLE_ARN: string;
  ORG_MGT_ROLE_ARN: string;
  SCHEDULER_ROLE_ARN: string;
  UNQUARANTINE_LAMBDA_ARN: string;
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
    'SCHEDULER_ROLE_ARN',
    'UNQUARANTINE_LAMBDA_ARN',
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
    SCHEDULER_ROLE_ARN: process.env[ENV_KEYS.SCHEDULER_ROLE_ARN]!,
    UNQUARANTINE_LAMBDA_ARN: process.env.UNQUARANTINE_LAMBDA_ARN!,
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
 * Processes a single parsed event and returns the result.
 */
async function processEvent(
  event: ParsedMoveAccountEvent,
  services: ReturnType<typeof createServices>,
  env: LambdaEnv
): Promise<QuarantineResult> {
  const { accountId, sourceParentId } = event;
  const { sandboxOuService, accountStore, schedulerClient } = services;

  log(LOG_ACTIONS.QUARANTINE_START, accountId, {
    sourceParentId,
    eventId: event.eventId,
    eventTime: event.eventTime,
  });

  // Step 1: Get current account status for idempotency check
  const accountResult = await accountStore.get(accountId);

  if (!accountResult.result) {
    // Account not in ISB tracking - skip
    log(LOG_ACTIONS.QUARANTINE_SKIP, accountId, {
      reason: 'Account not found in ISB tracking',
    });
    return {
      success: true,
      action: 'SKIPPED',
      accountId,
      message: 'Account not found in ISB tracking',
    };
  }

  const account = accountResult.result;

  // Idempotency: Skip if already in Quarantine
  if (account.status === 'Quarantine') {
    log(LOG_ACTIONS.QUARANTINE_SKIP, accountId, {
      reason: 'Account already in Quarantine status',
      currentStatus: account.status,
    });
    return {
      success: true,
      action: 'SKIPPED',
      accountId,
      message: 'Account already in Quarantine status',
    };
  }

  // Step 2: Fresh lookup of CleanUp OU ID (FR2)
  const cleanUpOu = await sandboxOuService.getIsbOu('CleanUp');

  // Validate source is CleanUp OU (FR2, FR34)
  if (sourceParentId !== cleanUpOu.Id) {
    log(LOG_ACTIONS.QUARANTINE_SKIP, accountId, {
      reason: 'Source OU is not CleanUp',
      sourceParentId,
      cleanUpOuId: cleanUpOu.Id,
    });
    return {
      success: true,
      action: 'SKIPPED',
      accountId,
      message: `Skipping non-CleanUp move: source ${sourceParentId} is not CleanUp OU`,
    };
  }

  // Step 3: Move account to Quarantine OU (FR3, FR4)
  const quarantineOu = await sandboxOuService.getIsbOu('Quarantine');

  // The account is currently at Available (destination of the original move)
  // We need to move it from Available to Quarantine
  const transaction = sandboxOuService.transactionalMoveAccount(
    account as SandboxAccount,
    'Available' as IsbOu,
    'Quarantine' as IsbOu
  );

  await transaction.beginTransaction();

  log(LOG_ACTIONS.QUARANTINE_COMPLETE, accountId, {
    fromOu: 'Available',
    toOu: 'Quarantine',
    quarantineOuId: quarantineOu.Id,
  });

  // Step 4: Create EventBridge Scheduler for 72-hour release (FR10, FR11, FR12)
  const now = Date.now();
  const schedulerName = `${SCHEDULER_NAME_PREFIX}-${accountId}-${now}`;
  const scheduleTime = new Date(now + QUARANTINE_DURATION_HOURS * 60 * 60 * 1000);

  // Format: at(yyyy-mm-ddThh:mm:ss)
  const scheduleExpression = `at(${scheduleTime.toISOString().replace(/\.\d{3}Z$/, '')})`;

  const schedulerPayload: SchedulerPayload = {
    accountId,
    quarantinedAt: new Date(now).toISOString(),
    schedulerName,
  };

  try {
    await schedulerClient.send(
      new CreateScheduleCommand({
        Name: schedulerName,
        GroupName: SCHEDULER_GROUP,
        ScheduleExpression: scheduleExpression,
        FlexibleTimeWindow: { Mode: FlexibleTimeWindowMode.OFF },
        Target: {
          Arn: env.UNQUARANTINE_LAMBDA_ARN,
          RoleArn: env.SCHEDULER_ROLE_ARN,
          Input: JSON.stringify(schedulerPayload),
        },
        Description: `Release account ${accountId} from quarantine after 72 hours`,
      })
    );

    log(LOG_ACTIONS.SCHEDULER_CREATED, accountId, {
      schedulerName,
      scheduleTime: scheduleTime.toISOString(),
      quarantineDurationHours: QUARANTINE_DURATION_HOURS,
    });
  } catch (error) {
    // Scheduler creation failed after successful OU move
    // Log error but don't fail - the account is already quarantined
    // Manual intervention may be needed to create the release scheduler
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(LOG_ACTIONS.SCHEDULER_CREATE_FAILED, accountId, {
      error: errorMessage,
      schedulerName,
      scheduleTime: scheduleTime.toISOString(),
    });

    // Re-throw to trigger retry - the move was successful but we need the scheduler
    throw new Error(`Scheduler creation failed for account ${accountId}: ${errorMessage}`);
  }

  return {
    success: true,
    action: 'QUARANTINED',
    accountId,
    message: `Account quarantined, release scheduled for ${scheduleTime.toISOString()}`,
    schedulerName,
  };
}

/**
 * Lambda handler for processing SQS events containing CloudTrail MoveAccount events.
 *
 * Uses partial batch response to allow successful messages to be deleted
 * while failed messages are retried.
 */
export async function handler(sqsEvent: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  // Validate environment
  const env = getEnv();
  const services = createServices(env);

  // Parse all events
  let parsedEvents: ParsedMoveAccountEvent[];
  try {
    parsedEvents = parseCloudTrailEvents(sqsEvent);
  } catch (error) {
    // Parse failure - all messages failed
    log(LOG_ACTIONS.PARSE_ERROR, 'BATCH', {
      error: error instanceof Error ? error.message : 'Unknown error',
      messageCount: sqsEvent.Records.length,
    });

    // Return all message IDs as failures for retry
    return {
      batchItemFailures: sqsEvent.Records.map((r) => ({
        itemIdentifier: r.messageId,
      })),
    };
  }

  // Process each event individually
  for (let i = 0; i < parsedEvents.length; i++) {
    const event = parsedEvents[i];
    const messageId = sqsEvent.Records[i].messageId;

    try {
      // processEvent always returns success:true (throws on failure)
      // so we just need to await it - no need to check result.success
      await processEvent(event, services, env);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;

      log(LOG_ACTIONS.HANDLER_ERROR, event.accountId, {
        error: errorMessage,
        stack: errorStack,
        messageId,
        eventId: event.eventId,
      });

      batchItemFailures.push({ itemIdentifier: messageId });
    }
  }

  return { batchItemFailures };
}
