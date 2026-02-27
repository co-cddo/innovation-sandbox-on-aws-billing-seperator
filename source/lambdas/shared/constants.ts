/**
 * Shared constants for ISB Billing Separator Lambda handlers
 */

/**
 * Duration in hours that accounts remain in Quarantine before being released
 * to Available OU. This allows billing data to settle with the previous leaseholder.
 */
export const QUARANTINE_DURATION_HOURS = 72;

/**
 * EventBridge Scheduler group name for managing unquarantine schedules.
 * All scheduler schedules are created in this group for easy management.
 */
export const SCHEDULER_GROUP = 'isb-billing-separator';

/**
 * Prefix for EventBridge Scheduler schedule names.
 * Full pattern: `${SCHEDULER_NAME_PREFIX}-${accountId}-${timestamp}`
 */
export const SCHEDULER_NAME_PREFIX = 'isb-billing-sep-unquarantine';

/**
 * Resource prefix for all billing separator resources (FR25).
 */
export const RESOURCE_PREFIX = 'isb-billing-sep';

/**
 * User agent suffix for AWS SDK calls, enabling usage tracking.
 */
export const USER_AGENT_SUFFIX = 'isb-billing-separator/1.0.0';

/**
 * AWS Organizations tag key used to bypass quarantine for an account.
 * When present on an account, the quarantine handler skips the 72-hour hold
 * and removes the tag so subsequent cycles enforce quarantine normally.
 */
export const BYPASS_QUARANTINE_TAG_KEY = 'do-not-separate';

/**
 * Maximum number of SQS records to process per Lambda invocation.
 * Prevents DoS from excessive batch sizes.
 */
export const MAX_SQS_RECORDS_PER_BATCH = 10;

/**
 * Regex pattern for valid AWS account IDs (12 digits).
 */
export const ACCOUNT_ID_PATTERN = /^\d{12}$/;

/**
 * Regex pattern for valid OU IDs (ou-xxxx-xxxxxxxx format).
 */
export const OU_ID_PATTERN = /^ou-[a-z0-9]{4,32}-[a-z0-9]{8,32}$/;

/**
 * Regex pattern for valid root IDs (r-xxxx format).
 */
export const ROOT_ID_PATTERN = /^r-[a-z0-9]{4,32}$/;

/**
 * Environment variable keys used by Lambda handlers.
 * These are set via CDK stack configuration.
 */
export const ENV_KEYS = {
  /** Name of the ISB DynamoDB table storing sandbox account records */
  ACCOUNT_TABLE_NAME: 'ACCOUNT_TABLE_NAME',

  /** ID of the parent Innovation Sandbox OU */
  SANDBOX_OU_ID: 'SANDBOX_OU_ID',

  /** ID of the Available OU - destination that triggers quarantine */
  AVAILABLE_OU_ID: 'AVAILABLE_OU_ID',

  /** ID of the Quarantine OU - where accounts are held for 72 hours */
  QUARANTINE_OU_ID: 'QUARANTINE_OU_ID',

  /** ID of the CleanUp OU - only accounts FROM this OU are quarantined */
  CLEANUP_OU_ID: 'CLEANUP_OU_ID',

  /** ARN of the ISB intermediate role in Hub account for role chaining */
  INTERMEDIATE_ROLE_ARN: 'INTERMEDIATE_ROLE_ARN',

  /** ARN of the ISB role in Org Management account */
  ORG_MGT_ROLE_ARN: 'ORG_MGT_ROLE_ARN',

  /** ARN of the IAM role that EventBridge Scheduler assumes to invoke Lambda */
  SCHEDULER_ROLE_ARN: 'SCHEDULER_ROLE_ARN',

  /** EventBridge Scheduler group name */
  SCHEDULER_GROUP: 'SCHEDULER_GROUP',

  /** Custom user agent suffix for AWS SDK calls */
  USER_AGENT_EXTRA: 'USER_AGENT_EXTRA',
} as const;

/**
 * Log action types for structured logging.
 * Used to categorize log entries for filtering and analysis.
 */
export const LOG_ACTIONS = {
  /** Starting quarantine process for an account */
  QUARANTINE_START: 'QUARANTINE_START',

  /** Skipping quarantine (source not CleanUp or already quarantined) */
  QUARANTINE_SKIP: 'QUARANTINE_SKIP',

  /** Quarantine completed successfully */
  QUARANTINE_COMPLETE: 'QUARANTINE_COMPLETE',

  /** Starting unquarantine process for an account */
  UNQUARANTINE_START: 'UNQUARANTINE_START',

  /** Skipping unquarantine (not in Quarantine status) */
  UNQUARANTINE_SKIP: 'UNQUARANTINE_SKIP',

  /** Unquarantine completed successfully */
  UNQUARANTINE_COMPLETE: 'UNQUARANTINE_COMPLETE',

  /** Handler encountered an error */
  HANDLER_ERROR: 'HANDLER_ERROR',

  /** Event parsing error */
  PARSE_ERROR: 'PARSE_ERROR',

  /** Scheduler created successfully */
  SCHEDULER_CREATED: 'SCHEDULER_CREATED',

  /** Scheduler creation failed */
  SCHEDULER_CREATE_FAILED: 'SCHEDULER_CREATE_FAILED',

  /** Scheduler deleted successfully */
  SCHEDULER_DELETED: 'SCHEDULER_DELETED',

  /** Scheduler deletion failed */
  SCHEDULER_DELETE_FAILED: 'SCHEDULER_DELETE_FAILED',

  /** Quarantine bypassed due to do-not-separate tag */
  QUARANTINE_BYPASS_TAG: 'QUARANTINE_BYPASS_TAG',

  /** Failed to check for bypass tag (fail-safe: proceed with quarantine) */
  TAG_CHECK_FAILED: 'TAG_CHECK_FAILED',

  /** Failed to remove bypass tag after skipping quarantine */
  TAG_REMOVAL_FAILED: 'TAG_REMOVAL_FAILED',
} as const;
