/**
 * Event parser for CloudTrail MoveAccount events arriving via SQS.
 *
 * CloudTrail events flow: CloudTrail → EventBridge → SQS → Lambda
 * The SQS message body contains the stringified CloudTrail event.
 */

import { z } from 'zod';
import type { SQSEvent } from 'aws-lambda';
import type { ParsedMoveAccountEvent } from './types.js';
import {
  LOG_ACTIONS,
  MAX_SQS_RECORDS_PER_BATCH,
  ACCOUNT_ID_PATTERN,
  OU_ID_PATTERN,
  ROOT_ID_PATTERN,
} from './constants.js';

// ============================================================================
// Validation Helpers (defined first so they can be used by Zod schemas)
// ============================================================================

/**
 * Validates an account ID format.
 *
 * @param accountId - The account ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidAccountId(accountId: string): boolean {
  return ACCOUNT_ID_PATTERN.test(accountId);
}

/**
 * Validates an OU ID format.
 *
 * @param ouId - The OU ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidOuId(ouId: string): boolean {
  return OU_ID_PATTERN.test(ouId);
}

/**
 * Validates a parent ID format (OU or root).
 *
 * @param parentId - The parent ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidParentId(parentId: string): boolean {
  return OU_ID_PATTERN.test(parentId) || ROOT_ID_PATTERN.test(parentId);
}

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Validates that a string is a valid parent ID (OU or root).
 */
const ParentIdSchema = z.string().refine(isValidParentId, {
  message: 'Parent ID must be a valid OU ID (ou-xxx-xxx) or root ID (r-xxx)',
});

/**
 * Zod schema for MoveAccount request parameters.
 * Uses the shared validation patterns from constants.
 */
const MoveAccountRequestParametersSchema = z.object({
  accountId: z.string().refine((id) => isValidAccountId(id), {
    message: 'Account ID must be exactly 12 digits',
  }),
  sourceParentId: ParentIdSchema,
  destinationParentId: ParentIdSchema,
});

/**
 * Zod schema for CloudTrail event detail section.
 */
const CloudTrailDetailSchema = z.object({
  eventSource: z.literal('organizations.amazonaws.com'),
  eventName: z.literal('MoveAccount'),
  eventTime: z.string(),
  eventID: z.string(),
  requestParameters: MoveAccountRequestParametersSchema,
});

/**
 * Zod schema for the full CloudTrail MoveAccount event.
 */
const CloudTrailMoveAccountEventSchema = z.object({
  version: z.string(),
  id: z.string(),
  'detail-type': z.literal('AWS API Call via CloudTrail'),
  source: z.literal('aws.organizations'),
  account: z.string(),
  time: z.string(),
  region: z.string(),
  detail: CloudTrailDetailSchema,
});

/**
 * Error thrown when event parsing fails.
 */
export class EventParseError extends Error {
  constructor(
    message: string,
    public readonly action = LOG_ACTIONS.PARSE_ERROR,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'EventParseError';
  }
}

/**
 * Parses a CloudTrail MoveAccount event from an SQS event.
 *
 * @param sqsEvent - The SQS event containing CloudTrail event(s) in the body
 * @returns Array of parsed MoveAccount events
 * @throws EventParseError if parsing or validation fails
 *
 * @example
 * ```typescript
 * const handler = async (event: SQSEvent) => {
 *   const parsedEvents = parseCloudTrailEvents(event);
 *   for (const parsed of parsedEvents) {
 *     console.log(`Account ${parsed.accountId} moved from ${parsed.sourceParentId}`);
 *   }
 * };
 * ```
 */
export function parseCloudTrailEvents(sqsEvent: SQSEvent): ParsedMoveAccountEvent[] {
  if (!sqsEvent.Records || sqsEvent.Records.length === 0) {
    throw new EventParseError('SQS event contains no records', LOG_ACTIONS.PARSE_ERROR, {
      recordCount: 0,
    });
  }

  // Prevent DoS from excessive batch sizes (H1 fix)
  if (sqsEvent.Records.length > MAX_SQS_RECORDS_PER_BATCH) {
    throw new EventParseError(
      `SQS batch size ${sqsEvent.Records.length} exceeds maximum ${MAX_SQS_RECORDS_PER_BATCH}`,
      LOG_ACTIONS.PARSE_ERROR,
      {
        recordCount: sqsEvent.Records.length,
        maxAllowed: MAX_SQS_RECORDS_PER_BATCH,
      }
    );
  }

  const parsedEvents: ParsedMoveAccountEvent[] = [];

  for (const record of sqsEvent.Records) {
    const parsed = parseSingleRecord(record.body, record.messageId);
    parsedEvents.push(parsed);
  }

  return parsedEvents;
}

/**
 * Parses a single SQS record body into a ParsedMoveAccountEvent.
 *
 * @param body - The SQS record body (stringified CloudTrail event)
 * @param messageId - The SQS message ID for error context
 * @returns Parsed MoveAccount event
 * @throws EventParseError if parsing or validation fails
 */
function parseSingleRecord(body: string, messageId: string): ParsedMoveAccountEvent {
  // Step 1: Parse JSON
  let rawEvent: unknown;
  try {
    rawEvent = JSON.parse(body);
  } catch (error) {
    throw new EventParseError(
      `Failed to parse SQS message body as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
      LOG_ACTIONS.PARSE_ERROR,
      { messageId, body: body.substring(0, 200) }
    );
  }

  // Step 2: Validate against schema
  const validationResult = CloudTrailMoveAccountEventSchema.safeParse(rawEvent);

  if (!validationResult.success) {
    const errorMessages = validationResult.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');

    throw new EventParseError(
      `CloudTrail event validation failed: ${errorMessages}`,
      LOG_ACTIONS.PARSE_ERROR,
      {
        messageId,
        // Only include error paths, not full objects (M1 fix - avoid sensitive data)
        validationPaths: validationResult.error.issues.map((e) => e.path.join('.')),
      }
    );
  }

  const event = validationResult.data;

  // Step 3: Extract the fields we need
  return {
    accountId: event.detail.requestParameters.accountId,
    sourceParentId: event.detail.requestParameters.sourceParentId,
    destinationParentId: event.detail.requestParameters.destinationParentId,
    eventTime: event.detail.eventTime,
    eventId: event.detail.eventID,
  };
}

/**
 * Parses a single CloudTrail MoveAccount event (not wrapped in SQS).
 * Useful for testing or when receiving events directly from EventBridge.
 *
 * @param event - The raw CloudTrail event object
 * @returns Parsed MoveAccount event
 * @throws EventParseError if validation fails
 */
export function parseRawCloudTrailEvent(event: unknown): ParsedMoveAccountEvent {
  const validationResult = CloudTrailMoveAccountEventSchema.safeParse(event);

  if (!validationResult.success) {
    const errorMessages = validationResult.error.issues
      .map((e) => `${e.path.join('.')}: ${e.message}`)
      .join('; ');

    throw new EventParseError(
      `CloudTrail event validation failed: ${errorMessages}`,
      LOG_ACTIONS.PARSE_ERROR,
      {
        // Only include error paths, not full objects (M1 fix - avoid sensitive data)
        validationPaths: validationResult.error.issues.map((e) => e.path.join('.')),
      }
    );
  }

  const validated = validationResult.data;

  return {
    accountId: validated.detail.requestParameters.accountId,
    sourceParentId: validated.detail.requestParameters.sourceParentId,
    destinationParentId: validated.detail.requestParameters.destinationParentId,
    eventTime: validated.detail.eventTime,
    eventId: validated.detail.eventID,
  };
}

