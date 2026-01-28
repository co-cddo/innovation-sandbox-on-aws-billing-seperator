/**
 * Type definitions for ISB Billing Separator Lambda handlers
 */

import type { SQSEvent, SQSRecord } from 'aws-lambda';

/**
 * CloudTrail MoveAccount event structure as received from EventBridge.
 * This is the raw event that gets forwarded from the Org Management account.
 */
export interface CloudTrailMoveAccountEvent {
  version: string;
  id: string;
  'detail-type': 'AWS API Call via CloudTrail';
  source: 'aws.organizations';
  account: string;
  time: string;
  region: string;
  resources: string[];
  detail: CloudTrailMoveAccountDetail;
}

/**
 * The detail section of a CloudTrail MoveAccount event.
 */
export interface CloudTrailMoveAccountDetail {
  eventVersion: string;
  userIdentity: {
    type: string;
    principalId: string;
    arn: string;
    accountId: string;
    accessKeyId?: string;
    sessionContext?: {
      sessionIssuer?: {
        type: string;
        principalId: string;
        arn: string;
        accountId: string;
        userName: string;
      };
      webIdFederationData?: Record<string, unknown>;
      attributes?: {
        mfaAuthenticated: string;
        creationDate: string;
      };
    };
    invokedBy?: string;
  };
  eventTime: string;
  eventSource: 'organizations.amazonaws.com';
  eventName: 'MoveAccount';
  awsRegion: string;
  sourceIPAddress: string;
  userAgent: string;
  requestParameters: MoveAccountRequestParameters;
  responseElements: null;
  requestID: string;
  eventID: string;
  readOnly: boolean;
  eventType: string;
  managementEvent: boolean;
  recipientAccountId: string;
  eventCategory: string;
}

/**
 * The request parameters from a MoveAccount API call.
 * These are the key fields we need for quarantine processing.
 */
export interface MoveAccountRequestParameters {
  /** The AWS account ID being moved */
  accountId: string;
  /** The OU ID the account is moving FROM */
  sourceParentId: string;
  /** The OU ID the account is moving TO */
  destinationParentId: string;
}

/**
 * Parsed and validated result from the event parser.
 * Contains only the fields needed for quarantine processing.
 */
export interface ParsedMoveAccountEvent {
  /** The AWS account ID being moved */
  accountId: string;
  /** The OU ID the account is moving FROM */
  sourceParentId: string;
  /** The OU ID the account is moving TO */
  destinationParentId: string;
  /** The timestamp of the original CloudTrail event */
  eventTime: string;
  /** The unique ID of the CloudTrail event */
  eventId: string;
}

/**
 * Payload for the UnquarantineLambda invoked by EventBridge Scheduler.
 * The scheduler is created by QuarantineLambda after successful quarantine.
 */
export interface SchedulerPayload {
  /** The AWS account ID to release from quarantine */
  accountId: string;
  /** When the account was quarantined (ISO 8601 timestamp) */
  quarantinedAt: string;
  /** Name of the scheduler that triggered this invocation */
  schedulerName: string;
}

/**
 * Result from the QuarantineLambda handler.
 */
export interface QuarantineResult {
  /** Whether quarantine was successful */
  success: boolean;
  /** The action taken */
  action: 'QUARANTINED' | 'SKIPPED' | 'ERROR';
  /** The account ID that was processed */
  accountId: string;
  /** Additional message describing the result */
  message: string;
  /** Name of the created scheduler (if action is QUARANTINED) */
  schedulerName?: string;
  /** Error details (if action is ERROR) */
  error?: string;
}

/**
 * Result from the UnquarantineLambda handler.
 */
export interface UnquarantineResult {
  /** Whether unquarantine was successful */
  success: boolean;
  /** The action taken */
  action: 'RELEASED' | 'SKIPPED' | 'ERROR';
  /** The account ID that was processed */
  accountId: string;
  /** Additional message describing the result */
  message: string;
  /** Whether the scheduler was cleaned up */
  schedulerDeleted?: boolean;
  /** Error details (if action is ERROR) */
  error?: string;
}

/**
 * Re-export SQS types for convenience.
 */
export type { SQSEvent, SQSRecord };
