---
stepsCompleted: [1, 2, 3, 4, 5]
inputDocuments: []
workflowType: 'research'
lastStep: 1
research_type: 'technical'
research_topic: 'ISB Account Quarantine Automation'
research_goals: 'Understand Innovation Sandbox on AWS codebase to build standalone Lambda that subscribes to EventBridge cleanup events, quarantines accounts, and unquarantines after 72 hours via direct DynamoDB and OU manipulation'
user_name: 'Cns'
date: '2026-01-27'
web_research_enabled: true
source_verification: true
---

# Research Report: Technical - ISB Account Quarantine Automation

**Date:** 2026-01-27
**Author:** Cns
**Research Type:** Technical (Codebase Analysis)

---

## Executive Summary

**Purpose:** Build a standalone, removable Lambda solution to quarantine AWS accounts for 72 hours after cleanup before returning them to the available pool.

**Why:** ISB currently returns cleaned accounts immediately to Available. This creates risk of users getting accounts with residual state. A 72-hour quarantine provides a buffer for any delayed cleanup operations.

**Key Design Decisions:**
1. **Trigger:** AWS Organizations `MoveAccount` CloudTrail event (NOT `AccountCleanupSucceeded`) - eliminates race condition
2. **Delay Mechanism:** EventBridge Scheduler (72-hour one-time schedule)
3. **Dependency:** Git submodule reference to ISB commons - reuse existing services
4. **Deployment:** Standalone CDK stack in Hub Account - easy removal when upstream solution available

**Critical Files:**
- `SandboxOuService` - OU operations with atomic DB updates
- `DynamoSandboxAccountStore` - Account CRUD operations
- `fromTemporaryIsbOrgManagementCredentials` - Cross-account role chain

**Live Environment (ndx-try):**
- Account Table: `ndx-try-isb-data-SandboxAccountTableEFB9C069-198TPLJI6Z9KV`
- Hub Account: `568672915267`
- Org Mgmt Account: `955063685555`
- Parent Sandbox OU: `ou-2laj-4dyae1oa`

---

## Research Overview

This research analyzes the Innovation Sandbox on AWS (ISB) codebase to understand how to build a standalone Lambda-based solution for automated account quarantine management. The solution will:

1. Subscribe to CloudTrail `MoveAccount` events when ISB moves account to Available OU
2. Immediately move the account to Quarantine (OU + database update)
3. After 72 hours, check if account is still quarantined and release it back to the pool

**Key Constraint:** ISB does not currently expose an API endpoint for quarantine operations, requiring direct DynamoDB and AWS Organizations OU manipulation.

---

## Technical Research Scope Confirmation

**Research Topic:** ISB Account Quarantine Automation
**Research Goals:** Understand Innovation Sandbox on AWS codebase to build standalone Lambda that subscribes to EventBridge cleanup events, quarantines accounts, and unquarantines after 72 hours via direct DynamoDB and OU manipulation

**Technical Research Scope:**

- Architecture Analysis - design patterns, frameworks, system architecture
- Implementation Approaches - development methodologies, coding patterns
- Technology Stack - languages, frameworks, tools, platforms
- Integration Patterns - APIs, protocols, interoperability
- Performance Considerations - scalability, optimization, patterns

**Research Methodology:**

- Codebase exploration with source verification
- Pattern identification from existing implementations
- Comprehensive technical coverage with architecture-specific insights

**Scope Confirmed:** 2026-01-27

---

## Technology Stack Analysis

### ISB Core Technology Stack

**Language & Runtime:**
- TypeScript (Node.js 18+)
- AWS CDK v2 for infrastructure as code
- Monorepo structure using npm workspaces

**Key Dependencies:**
- `zod` - Runtime schema validation
- `@aws-lambda-powertools` - Logger, Tracer, Metrics
- `@aws-sdk/client-*` - AWS SDK v3 clients
- `luxon` - DateTime handling
- `exponential-backoff` - Retry logic for AWS API calls

**AWS Services Used:**
- **EventBridge** - Central event bus (`ISBEventBus`) for all ISB activity
- **DynamoDB** - Account and Lease storage
- **Lambda** - Event handlers (TypeScript, bundled with esbuild)
- **SQS** - Event buffering between EventBridge and Lambda
- **AWS Organizations** - OU management for account lifecycle
- **IAM Identity Center (IDC)** - User access management
- **Step Functions** - Account cleanup orchestration
- **AppConfig** - Global configuration management

### Project Structure

```
innovation-sandbox-on-aws/source/
├── common/                    # Shared business logic
│   ├── data/                  # DynamoDB schemas and stores
│   │   ├── sandbox-account/   # Account model and store
│   │   └── lease/             # Lease model and store
│   ├── events/                # EventBridge event definitions
│   ├── isb-services/          # Service abstractions
│   ├── sdk-clients/           # AWS SDK client wrappers
│   ├── lambda/                # Lambda middleware and environments
│   └── innovation-sandbox.ts  # Core business logic (quarantine, etc.)
├── infrastructure/            # CDK stacks
│   └── lib/components/        # Reusable CDK constructs
├── lambdas/                   # Lambda handlers
│   ├── account-cleanup/       # Cleanup orchestration
│   └── account-management/    # Lifecycle management
└── layers/                    # Lambda layers
```

---

## EventBridge Events

### Event Types Defined

File: `source/common/events/index.ts`

```typescript
export const EventDetailTypes = {
  // Lease Events
  LeaseRequested: "LeaseRequested",
  LeaseApproved: "LeaseApproved",
  LeaseDenied: "LeaseDenied",
  LeaseTerminated: "LeaseTerminated",
  LeaseFrozen: "LeaseFrozen",
  LeaseUnfrozen: "LeaseUnfrozen",

  // Alert Events
  LeaseBudgetThresholdBreachedAlert: "LeaseBudgetThresholdAlert",
  LeaseDurationThresholdBreachedAlert: "LeaseDurationThresholdAlert",
  LeaseFreezingThresholdBreachedAlert: "LeaseFreezingThresholdAlert",
  LeaseBudgetExceededAlert: "LeaseBudgetExceeded",
  LeaseExpiredAlert: "LeaseExpired",

  // Account Events (RELEVANT TO THIS PROJECT)
  CleanAccountRequest: "CleanAccountRequest",
  AccountCleanupSuccessful: "AccountCleanupSucceeded",  // ISB uses this internally
  AccountCleanupFailure: "AccountCleanupFailed",
  AccountQuarantined: "AccountQuarantined",
  AccountDriftDetected: "AccountDriftDetected",

  // Reporting Events
  GroupCostReportGenerated: "GroupCostReportGenerated",
  GroupCostReportGeneratedFailure: "GroupCostReportGeneratedFailure",
};
```

### AccountCleanupSuccessful Event Schema

File: `source/common/events/account-cleanup-successful-event.ts`

```typescript
export const AccountCleanupSuccessfulEventSchema = z.object({
  accountId: AwsAccountIdSchema,  // 12-digit AWS account ID
  cleanupExecutionContext: z.object({
    stateMachineExecutionArn: z.string(),
    stateMachineExecutionStartTime: z.string(),  // ISO datetime
  }),
});
```

**Event Structure on EventBridge:**
```json
{
  "detail-type": "AccountCleanupSucceeded",
  "source": "innovation-sandbox",
  "detail": {
    "accountId": "123456789012",
    "cleanupExecutionContext": {
      "stateMachineExecutionArn": "arn:aws:states:...",
      "stateMachineExecutionStartTime": "2026-01-27T10:00:00Z"
    }
  }
}
```

### Event Bus Configuration

File: `source/infrastructure/lib/components/events/isb-internal-core.ts`

- Event bus name: `ISBEventBus` (with namespace prefix)
- Has DLQ for failed deliveries
- All events logged to CloudWatch

---

## DynamoDB Schema

### Account Table Schema

File: `source/common/data/sandbox-account/sandbox-account.ts`

```typescript
// OU/Status enum - maps directly to AWS Organizations OU names
export const IsbOuSchema = z.enum([
  "Available",    // Ready for lease
  "Active",       // Assigned to active lease
  "CleanUp",      // Undergoing cleanup
  "Quarantine",   // Quarantined (cleanup failed, drift, etc.)
  "Frozen",       // Lease frozen
  "Entry",        // New account onboarding (not stored in DB)
  "Exit",         // Account removal (not stored in DB)
]);

// Status in DB excludes Entry/Exit
export const SandboxAccountStatusSchema = IsbOuSchema.exclude(["Entry", "Exit"]);

export const SandboxAccountSchema = z.object({
  awsAccountId: AwsAccountIdSchema,           // Primary Key (12-digit string)
  email: z.string().email().optional(),
  name: z.string().max(50).optional(),
  cleanupExecutionContext: z.object({
    stateMachineExecutionArn: z.string(),
    stateMachineExecutionStartTime: z.string().datetime(),
  }).optional(),
  status: SandboxAccountStatusSchema,         // "Available" | "Active" | "CleanUp" | "Quarantine" | "Frozen"
  driftAtLastScan: z.boolean().optional(),
  // Metadata fields (added by withMetadata decorator):
  // - version: number
  // - createdDate: string (ISO)
  // - lastModifiedDate: string (ISO)
  // - ttl?: number (Unix timestamp, optional)
});
```

### Account Store Operations

File: `source/common/data/sandbox-account/dynamo-sandbox-account-store.ts`

```typescript
export class DynamoSandboxAccountStore {
  // Get single account by ID
  async get(accountId: AwsAccountId): Promise<SingleItemResult<SandboxAccount>>

  // Create/update account
  async put(account: SandboxAccount): Promise<PutResult<SandboxAccount>>

  // Delete account
  async delete(accountId: AwsAccountId): Promise<OptionalItem>

  // Query by status (uses Scan with FilterExpression)
  async findByStatus(args: { status: SandboxAccountStatus; ... }): Promise<PaginatedQueryResult<SandboxAccount>>

  // List all accounts
  async findAll(args: { ... }): Promise<PaginatedQueryResult<SandboxAccount>>
}
```

---

## OU Management

### SandboxOuService

File: `source/common/isb-services/sandbox-ou-service.ts`

```typescript
export class SandboxOuService {
  readonly orgsClient: OrganizationsClient;
  readonly sandboxOuId: string;  // Parent OU containing all ISB OUs
  readonly sandboxAccountStore: SandboxAccountStore;

  // Get OU by name
  async getIsbOu(ouName: IsbOu): Promise<OrganizationalUnit>

  // Move account between OUs (with exponential backoff retry)
  async performAccountMoveAction(
    accountId: string,
    sourceOu: IsbOu,
    destinationOu: IsbOu
  ): Promise<void>

  // Move account AND update DynamoDB status atomically
  async moveAccount(
    account: SandboxAccount,
    sourceOu: IsbOu,
    destinationOu: IsbOu
  ): Promise<PutResult<SandboxAccount>>

  // Transactional move with rollback capability
  transactionalMoveAccount(
    account: SandboxAccount,
    sourceOu: IsbOu,
    destinationOu: IsbOu
  ): Transaction<...>

  // List accounts in OU
  async listAccountsInOU(options: { ouName: IsbOu; ... }): Promise<{ accounts: Account[]; ... }>
}
```

### OU Hierarchy

```
AWS Organizations Root
└── Sandbox OU (sandboxOuId from config)
    ├── Available
    ├── Active
    ├── CleanUp
    ├── Quarantine    ← Target for quarantine
    ├── Frozen
    ├── Entry
    └── Exit
```

---

## Quarantine Operation (Existing Implementation)

File: `source/common/innovation-sandbox.ts` (lines 756-815)

```typescript
public static async quarantineAccount(
  props: {
    accountId: string;
    currentOu: IsbOu;           // Source OU
    reason: string;
  },
  context: IsbContext<{
    orgsService: SandboxOuService;
    eventBridgeClient: IsbEventBridgeClient;
    sandboxAccountStore: SandboxAccountStore;
    idcService: IdcService;
    leaseStore: LeaseStore;
    globalConfig: GlobalConfig;
  }>
): Promise<void>
```

**Steps performed:**
1. Get or create account record from DynamoDB
2. Terminate all active leases on the account (sets status to "AccountQuarantined")
3. Move account: `currentOu` → `"Quarantine"` OU via `orgsService.transactionalMoveAccount()`
4. Emit `AccountQuarantinedEvent`
5. (IDC access revocation handled by lease termination)

---

## Account Lifecycle Manager (Event Handling Pattern)

File: `source/lambdas/account-management/account-lifecycle-management/src/account-lifecycle-manager.ts`

### Event Subscription Pattern

```typescript
// Events this handler subscribes to
export const trackedLeaseEvents = [
  EventDetailTypes.LeaseBudgetExceededAlert,
  EventDetailTypes.LeaseExpiredAlert,
  EventDetailTypes.AccountCleanupSuccessful,  // ← Cleanup succeeded
  EventDetailTypes.AccountCleanupFailure,     // ← Cleanup failed
  EventDetailTypes.AccountDriftDetected,
  EventDetailTypes.LeaseFreezingThresholdBreachedAlert,
];
```

### Handler Structure

```typescript
export const handler = baseMiddlewareBundle({
  logger,
  tracer,
  environmentSchema: AccountLifecycleManagementEnvironmentSchema,
  moduleName: "account-management",
})
  .use(isbConfigMiddleware())
  .handler(handleAccountLifeCycleEvent);

async function handleAccountLifeCycleEvent(sqsEvent: SQSEvent, context: ...) {
  const body = sqsEvent.Records[0]!.body;
  const event = JSON.parse(body);
  const eventDetailType = event["detail-type"];

  switch (eventDetailType) {
    case EventDetailTypes.AccountCleanupSuccessful:
      await handleAccountCleanupSuccessful(...);
      break;
    case EventDetailTypes.AccountCleanupFailure:
      await handleAccountCleanupFailure(...);
      break;
    // ... other cases
  }
}
```

### Current Behavior After Cleanup Success

```typescript
async function handleAccountCleanupSuccessful(event, context) {
  // Get account from DynamoDB
  const cleanSandboxAccount = await sandboxAccountStore.get(event.Detail.accountId);

  // Verify account is in CleanUp status
  if (cleanSandboxAccount.status != "CleanUp") {
    throw new Error("AccountCleanupSuccessfulEvent incorrectly raised...");
  }

  // Move account: CleanUp → Available
  await orgsService
    .transactionalMoveAccount(cleanSandboxAccount, "CleanUp", "Available")
    .complete();
}
```

### Current Behavior After Cleanup Failure

```typescript
async function handleAccountCleanupFailure(event, context) {
  // Quarantine the account
  await InnovationSandbox.quarantineAccount({
    accountId: event.Detail.accountId,
    reason: "Cleanup Failed",
    currentOu: "CleanUp",
  }, {...services});
}
```

---

## CDK Infrastructure Pattern

File: `source/infrastructure/lib/components/account-management/account-lifecycle-management-lambda.ts`

### EventBridge → SQS → Lambda Pattern

```typescript
new EventsToSqsToLambda(scope, "AccountLifeCycleEventsToSqsToLambda", {
  namespace: props.namespace,
  eventBus: props.isbEventBus,
  lambdaFunction: lambda.lambdaFunction,
  sqsQueueProps: {
    maxEventAge: Duration.hours(4),
    retryAttempts: 3,
  },
  ruleProps: {
    eventBus: props.isbEventBus,
    description: "Triggers account life cycle manager lambda via SQS",
    enabled: true,
    eventPattern: {
      detailType: AccountLifecycleManager.trackedLeaseEvents,  // Filter for specific events
    },
  },
});
```

### Lambda Environment Variables

```typescript
environment: {
  APP_CONFIG_APPLICATION_ID: configApplicationId,
  APP_CONFIG_PROFILE_ID: globalConfigConfigurationProfileId,
  APP_CONFIG_ENVIRONMENT_ID: configEnvironmentId,
  ISB_EVENT_BUS: props.isbEventBus.eventBusName,
  ISB_NAMESPACE: props.namespace,
  ACCOUNT_TABLE_NAME: accountTable,
  SANDBOX_OU_ID: sandboxOuId,
  LEASE_TABLE_NAME: leaseTable,
  INTERMEDIATE_ROLE_ARN: IntermediateRole.getRoleArn(),
  ORG_MGT_ROLE_ARN: getOrgMgtRoleArn(...),
  IDC_ROLE_ARN: getIdcRoleArn(...),
}
```

---

## Implementation Design for Quarantine Automation

### Proposed Architecture (Revised)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ISB Normal Flow                             │
│  AccountCleanupSucceeded → ISB Handler → MoveAccount(CleanUp→Avail) │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  CloudTrail     │────▶│  EventBridge         │────▶│  Quarantine     │
│  MoveAccount    │     │  (default bus)       │     │  Lambda         │
│  Event          │     │  filter: dest=Avail  │     │                 │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                                                            │
                        ┌───────────────────────────────────┤
                        │                                   │
                        ▼                                   ▼
              ┌──────────────────┐               ┌──────────────────┐
              │  AWS Orgs        │               │  EventBridge     │
              │  MoveAccount     │               │  Scheduler       │
              │  (Avail→Quaran)  │               │  (72-hour delay) │
              └──────────────────┘               └──────────────────┘
                                                            │
                                                            ▼
                                                ┌──────────────────────┐
                                                │  Unquarantine Lambda │
                                                │  (check + move)      │
                                                └──────────────────────┘
```

### Event Subscription Strategy

**Primary Event (Quarantine Trigger):**
- **Source:** `aws.organizations` (CloudTrail)
- **Event:** `MoveAccount` where `destinationParentId` = Available OU ID
- **Optional filter:** `sourceParentId` = CleanUp OU ID (only post-cleanup accounts)

**Scheduled Event (Unquarantine Trigger):**
- **Source:** EventBridge Scheduler (one-time, 72 hours after quarantine)

### Option 1: EventBridge Scheduler (Recommended)

**Quarantine Lambda** (triggered by Organizations `MoveAccount` event to Available OU):
1. Extract `accountId` from CloudTrail event `requestParameters`
2. Get account from DynamoDB (verify status is "Available")
3. Move account: `Available` → `Quarantine` (OU + DB update)
4. Create one-time EventBridge Scheduler rule for 72 hours later
5. Store scheduler ARN in account record (optional, for cancellation)

**Unquarantine Lambda** (triggered by scheduler):
1. Get account from DynamoDB
2. **Check status is still "Quarantine"** (skip if manually unquarantined)
3. Move account: `Quarantine` → `Available` (OU + DB update)
4. Delete the scheduler rule (self-cleanup)

### Option 2: Step Functions with Wait State

**Single State Machine:**
1. Quarantine account (OU + DB)
2. Wait 72 hours
3. Check status is still "Quarantine"
4. If yes, unquarantine (OU + DB)

**Pros:** Single deployment, built-in state tracking
**Cons:** Step Function execution costs for long-running workflows

### Option 3: DynamoDB TTL + Stream

**Not recommended** - TTL is for deletion, not triggering actions

---

## Required Operations for Standalone Lambda

### 1. Subscribe to Organizations MoveAccount Event (CloudTrail)

```typescript
// Event pattern for EventBridge rule on DEFAULT event bus
{
  "source": ["aws.organizations"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventSource": ["organizations.amazonaws.com"],
    "eventName": ["MoveAccount"],
    "requestParameters": {
      "destinationParentId": ["ou-xxxx-available-ou-id"],  // Available OU
      "sourceParentId": ["ou-xxxx-cleanup-ou-id"]          // Only from CleanUp
    }
  }
}
```

**Note:** This event comes from CloudTrail via the **default EventBridge bus**, not the ISB custom event bus.

### 2. Quarantine Account (After ISB Moves to Available)

Triggered by CloudTrail `MoveAccount` event when account lands in Available OU:

```typescript
// 1. Extract accountId from CloudTrail event
const accountId = event.detail.requestParameters.accountId;

// 2. Get account from DynamoDB
const accountResponse = await sandboxAccountStore.get(accountId);
const account = accountResponse.result;

// 3. Verify account is in Available (ISB completed its move)
if (account.status !== "Available") {
  logger.warn(`Account ${accountId} not in Available status, skipping`);
  return;
}

// 4. Move to Quarantine OU and update DB
await orgsService.transactionalMoveAccount(account, "Available", "Quarantine").complete();

// 5. Schedule unquarantine in 72 hours
await schedulerClient.send(new CreateScheduleCommand({
  Name: `isb-unquarantine-${accountId}-${Date.now()}`,
  ScheduleExpression: `at(${futureTime.toISO()})`,
  Target: {
    Arn: unquarantineLambdaArn,
    RoleArn: schedulerRoleArn,
    Input: JSON.stringify({ accountId }),
  },
  FlexibleTimeWindow: { Mode: 'OFF' },
}));
```

### 3. Unquarantine Account (After 72 Hours)

```typescript
// 1. Get account
const accountResponse = await sandboxAccountStore.get(accountId);
const account = accountResponse.result;

// 2. CHECK: Only proceed if still quarantined
if (account.status !== "Quarantine") {
  logger.info(`Account ${accountId} is no longer quarantined (status: ${account.status}), skipping`);
  return;
}

// 3. Move to Available OU and update DB
await orgsService.transactionalMoveAccount(account, "Quarantine", "Available").complete();

// 4. Clean up scheduler (already fired, but good practice)
await schedulerClient.send(new DeleteScheduleCommand({
  Name: `unquarantine-${accountId}`,
}));
```

---

## Environment Variables Needed

```typescript
// Required for DynamoDB access
ACCOUNT_TABLE_NAME: string;

// Required for Organizations access
SANDBOX_OU_ID: string;
ORG_MGT_ROLE_ARN: string;
INTERMEDIATE_ROLE_ARN: string;

// Required for EventBridge Scheduler
UNQUARANTINE_LAMBDA_ARN: string;  // Target for scheduler
SCHEDULER_ROLE_ARN: string;       // Role for scheduler to invoke Lambda

// Optional for observability
ISB_NAMESPACE: string;
```

---

## Actual Deployed Configuration (ndx-try environment)

**Discovered via AWS API exploration on 2026-01-27:**

### DynamoDB Tables

| Table | Name |
|-------|------|
| Account Table | `ndx-try-isb-data-SandboxAccountTableEFB9C069-198TPLJI6Z9KV` |
| Lease Table | `ndx-try-isb-data-LeaseTable473C6DF2-1RC3238PVASE1` |
| Lease Template Table | `ndx-try-isb-data-LeaseTemplateTable5128F8F4-4XYVHP9P7VE8` |

### EventBridge

| Bus | Name/ARN |
|-----|----------|
| ISB Event Bus | `InnovationSandboxComputeISBEventBus6697FE33` |
| Default Bus | `arn:aws:events:us-west-2:568672915267:event-bus/default` |

### AWS Organizations

| Resource | Value |
|----------|-------|
| Parent Sandbox OU | `ou-2laj-4dyae1oa` |
| Org ID | `o-4g8nrlnr9s` |

**Note:** Child OU IDs (Available, CleanUp, Quarantine, etc.) require Organizations API access from the management account. These are dynamically resolved by ISB using `SandboxOuService.getIsbOu(ouName)`.

**Implementation Note:** For the EventBridge rule, we have two options:
1. **Runtime validation (recommended)** - Don't filter by OU ID in EventBridge rule; instead verify at Lambda runtime using `orgsService.getIsbOu()` to resolve OU names to IDs
2. **Deploy-time discovery** - Fetch OU IDs during CDK deployment via custom resource and inject into EventBridge rule

Option 1 is more resilient as it doesn't require cross-account calls during deployment.

### IAM Roles (Cross-Account)

| Role | ARN |
|------|-----|
| Intermediate Role (Hub) | `arn:aws:iam::568672915267:role/InnovationSandbox-ndx-IntermediateRole` |
| Org Mgmt Role | `arn:aws:iam::955063685555:role/InnovationSandbox-ndx-OrgMgtRole` |
| IDC Role | `arn:aws:iam::955063685555:role/InnovationSandbox-ndx-IdcRole` |

### Account IDs

| Account | ID |
|---------|-----|
| Hub Account | `568672915267` |
| Org Management Account | `955063685555` |

### AppConfig

| Resource | ID |
|----------|-----|
| Application | `gk3dbyt` |
| Environment | `djiv3as` |
| Global Config Profile | `gvz7520` |

### ISB Namespace

`ndx`

### Sample Account Record (from DynamoDB)

```json
{
  "awsAccountId": "680464296760",
  "status": "Available",
  "email": "ndx-try-provider+gds-ndx-try-aws-pool-005@dsit.gov.uk",
  "name": "pool-005",
  "driftAtLastScan": false,
  "cleanupExecutionContext": {
    "stateMachineExecutionArn": "arn:aws:states:us-west-2:568672915267:execution:AccountCleanerStepFunction...",
    "stateMachineExecutionStartTime": "2026-01-26T12:21:33.279Z"
  },
  "meta": {
    "lastEditTime": "2026-01-26T12:32:43.371Z",
    "createdTime": "2025-12-01T10:00:00.000Z",
    "schemaVersion": 1
  }
}
```

### Current Account Pool Status

- **Total Accounts:** 9
- **All Currently Available** (at time of query)

---

## Cross-Account IAM Pattern

ISB uses a cross-account role assumption pattern:

```
Hub Account Lambda
       │
       ▼ (assumes)
Intermediate Role (in Hub)
       │
       ▼ (assumes)
Org Management Role (in Org Mgmt Account)
       │
       ▼ (performs)
Organizations API calls (MoveAccount)
```

File: `source/common/utils/cross-account-roles.ts`

```typescript
export function fromTemporaryIsbOrgManagementCredentials(env: {...}): AwsCredentialIdentityProvider {
  return async () => {
    // First assume intermediate role
    const intermediateCredentials = await assumeRole(env.INTERMEDIATE_ROLE_ARN);
    // Then assume org management role
    return assumeRole(env.ORG_MGT_ROLE_ARN, intermediateCredentials);
  };
}
```

---

## Summary: Key Files for Implementation

| Purpose | File Path |
|---------|-----------|
| Event definitions | `source/common/events/index.ts` |
| Account schema | `source/common/data/sandbox-account/sandbox-account.ts` |
| Account store | `source/common/data/sandbox-account/dynamo-sandbox-account-store.ts` |
| OU service | `source/common/isb-services/sandbox-ou-service.ts` |
| Quarantine logic | `source/common/innovation-sandbox.ts` |
| Lambda middleware | `source/common/lambda/middleware/base-middleware-bundle.js` |
| CDK event wiring | `source/infrastructure/lib/components/events-to-sqs-to-lambda.ts` |
| Example handler | `source/lambdas/account-management/account-lifecycle-management/` |
| Cross-account roles | `source/common/utils/cross-account-roles.ts` |

---

## Dependency Strategy: Git Submodule + Local Reference

### Setup

```bash
# Add ISB as a git submodule
git submodule add https://github.com/aws-solutions/innovation-sandbox-on-aws.git deps/isb

# Pin to specific version
cd deps/isb
git checkout v1.1.7
cd ../..
git add deps/isb
git commit -m "Pin ISB submodule to v1.1.7"
```

### package.json

```json
{
  "name": "isb-quarantine-automation",
  "dependencies": {
    "@amzn/innovation-sandbox-commons": "file:./deps/isb/source/common"
  }
}
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@amzn/innovation-sandbox-commons/*": ["./deps/isb/source/common/*"]
    }
  }
}
```

### Benefits

- **Version control** - Pin to specific ISB commit/tag
- **Easy updates** - `git submodule update --remote` to pull upstream changes
- **Clean removal** - `git rm deps/isb` when upstream solution available
- **Full access** - Use all ISB services, schemas, and utilities directly

### Available Imports

```typescript
// Service factories
import { IsbServices } from "@amzn/innovation-sandbox-commons/isb-services/index.js";

// Data models & stores
import { SandboxAccount } from "@amzn/innovation-sandbox-commons/data/sandbox-account/sandbox-account.js";
import { DynamoSandboxAccountStore } from "@amzn/innovation-sandbox-commons/data/sandbox-account/dynamo-sandbox-account-store.js";

// OU service
import { SandboxOuService } from "@amzn/innovation-sandbox-commons/isb-services/sandbox-ou-service.js";

// Events
import { EventDetailTypes } from "@amzn/innovation-sandbox-commons/events/index.js";
import { AccountCleanupSuccessfulEvent } from "@amzn/innovation-sandbox-commons/events/account-cleanup-successful-event.js";

// Cross-account credentials
import { fromTemporaryIsbOrgManagementCredentials } from "@amzn/innovation-sandbox-commons/utils/cross-account-roles.js";

// Lambda middleware (optional - for consistency with ISB patterns)
import baseMiddlewareBundle from "@amzn/innovation-sandbox-commons/lambda/middleware/base-middleware-bundle.js";
```

---

## Race Condition Mitigation: Organizations MoveAccount Event

### The Problem

When `AccountCleanupSucceeded` fires, two handlers process the event simultaneously:
1. **ISB's `account-lifecycle-manager`** - moves account `CleanUp → Available`
2. **Our quarantine handler** - would want to move account to `Quarantine`

**Critical:** ISB has auto-approval enabled for lease requests. The race condition risk is **real and practical** - an account could be leased in the brief window between ISB moving it to Available and our handler quarantining it.

### The Solution: Watch for Organizations MoveAccount Event

Instead of subscribing to `AccountCleanupSucceeded`, subscribe to the **AWS Organizations `MoveAccount` CloudTrail event** where the destination is the Available OU. This guarantees ISB has already completed its move before we act.

**Event Pattern:**
```json
{
  "source": ["aws.organizations"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventSource": ["organizations.amazonaws.com"],
    "eventName": ["MoveAccount"],
    "requestParameters": {
      "destinationParentId": ["ou-xxxx-available-ou-id"]
    }
  }
}
```

**Event Detail Structure:**
```json
{
  "detail": {
    "eventName": "MoveAccount",
    "requestParameters": {
      "accountId": "123456789012",
      "sourceParentId": "ou-xxxx-cleanup",
      "destinationParentId": "ou-xxxx-available"
    },
    "responseElements": null,
    "errorCode": null
  }
}
```

### Revised Flow

```
ISB Cleanup Complete
        │
        ▼
AccountCleanupSucceeded (ISB event)
        │
        ▼
ISB account-lifecycle-manager
        │
        ▼
MoveAccount API (CleanUp → Available)
        │
        ▼
CloudTrail logs MoveAccount
        │
        ▼
EventBridge receives aws.organizations event
        │
        ▼
OUR QuarantineLambda (triggered AFTER ISB completes)
        │
        ▼
MoveAccount API (Available → Quarantine)
        │
        ▼
Schedule unquarantine in 72 hours
```

### Benefits

1. **No race condition** - We only act after ISB has finished
2. **Guaranteed ordering** - CloudTrail event fires after API succeeds
3. **Filter by destination OU** - Only trigger when account lands in Available
4. **Can also filter by source OU** - Only trigger when coming from CleanUp (not from Active/Frozen)

### Considerations

- Event comes from **management account** (where Organizations API runs)
- May need cross-account EventBridge rule if Lambda is in hub account
- CloudTrail event delivery has slight latency (~15-90 seconds typical)
- Must configure CloudTrail to log Organizations events (usually on by default for org trails)

### Alternative: Retry Loop (Fallback)

If Organizations events aren't available or reliable, fall back to:
```typescript
// If still in CleanUp, ISB hasn't acted yet - schedule retry
if (account.status === "CleanUp") {
  await scheduler.createSchedule({
    Name: `quarantine-retry-${accountId}`,
    ScheduleExpression: "rate(10 seconds)",  // Check again in 10s
    // ... target this same Lambda
  });
  return;  // Exit, will retry
}

// Account is now Available - safe to quarantine
await orgsService.transactionalMoveAccount(account, "Available", "Quarantine");
```

---

## Recommendations

1. **Subscribe to Organizations MoveAccount event** - NOT `AccountCleanupSucceeded`. This eliminates the race condition where an account could be leased before quarantine (critical since auto-approval is enabled).

2. **Use EventBridge Scheduler** for the 72-hour delay - it's serverless, cost-effective, and doesn't require managing state machine executions.

3. **Keep it standalone** - Deploy as a separate CDK stack that imports the existing EventBridge bus and DynamoDB table ARNs. This makes removal easy when upstream solution is available.

4. **Reuse ISB commons via git submodule** - Reference `@amzn/innovation-sandbox-commons` for battle-tested services, schemas, and utilities.

5. **Follow existing patterns** - Use the same middleware bundle, logging patterns, and cross-account role assumption as existing ISB lambdas for consistency.

6. **Idempotent unquarantine** - Always check account status before unquarantining to handle manual interventions gracefully.

7. **Filter by source OU** - Only quarantine accounts coming from CleanUp OU, not accounts manually moved to Available from other OUs.

8. **Consider naming convention** - Use scheduler names like `isb-unquarantine-{accountId}-{timestamp}` to avoid collisions and enable debugging.

---

## What This Solution Does NOT Need To Do

Since accounts being quarantined are coming from a successful cleanup (not an active lease):

1. **NO lease termination needed** - Accounts completing cleanup have no active leases
2. **NO IDC access revocation needed** - Access was already revoked when the lease ended
3. **NO AccountQuarantinedEvent emission needed** - This is optional; ISB's existing monitoring doesn't depend on it for post-cleanup quarantine
4. **NO AppConfig access needed** - We don't need global configuration; just DynamoDB and Organizations access

This significantly simplifies the implementation compared to the full `InnovationSandbox.quarantineAccount()` method.

---

## CloudTrail Event Delivery Considerations

### Where Events Originate

- **MoveAccount API** is called from the **Hub Account Lambda** (568672915267)
- But the API executes in the **Org Management Account** (955063685555) via cross-account role
- **CloudTrail logs the event** in the management account's trail
- **Organization trail** forwards events to EventBridge in the management account

### Cross-Account Event Routing

To receive the CloudTrail event in the Hub Account where our Lambda runs:

**Option A: EventBridge Cross-Account Rule**
```typescript
// In Org Management Account - forward to Hub
new Rule(scope, "ForwardMoveAccountToHub", {
  eventPattern: {
    source: ["aws.organizations"],
    detailType: ["AWS API Call via CloudTrail"],
    detail: { eventName: ["MoveAccount"] }
  },
  targets: [new EventBridgeTarget(hubAccountEventBus)]
});
```

**Option B: Deploy Lambda in Org Management Account**
- Simpler event routing but requires deployment in management account
- May have policy restrictions

**Option C: Organization Trail with CloudWatch Logs → Lambda**
- Organization trail already aggregates to central bucket/logs
- Can trigger Lambda from CloudWatch Logs subscription

**Recommendation:** Option A is cleanest - minimal footprint in management account, Lambda stays in Hub.

---

## Runtime Environment Details (from live Lambda inspection)

| Setting | Value |
|---------|-------|
| Runtime | `nodejs22.x` |
| Architecture | `arm64` |
| Memory | `1024 MB` |
| Timeout | `60 seconds` |
| Tracing | X-Ray Active |
| Log Format | JSON |
| Log Group | `ndx-try-isb-compute-ISBLogGroupE607F9A7-dcuZvjiGqZiW` |

### Lambda Layers Used by ISB

1. **Dependencies Layer** - AWS SDK, zod, luxon, etc.
2. **Commons Layer** - ISB shared code
3. **AppConfig Extension** - For configuration fetching (we may not need this)

---

## Implementation Checklist

### Prerequisites
- [ ] AWS CLI configured with Hub Account access
- [ ] CDK v2 installed
- [ ] Node.js 18+ installed
- [ ] Access to deploy EventBridge rule in Org Management Account (or cross-account setup)

### Project Setup
- [ ] Initialize CDK TypeScript project
- [ ] Add ISB as git submodule: `git submodule add https://github.com/aws-solutions/innovation-sandbox-on-aws.git deps/isb`
- [ ] Pin to stable version: `cd deps/isb && git checkout v1.1.7`
- [ ] Configure package.json with local dependency
- [ ] Configure tsconfig.json with path mappings
- [ ] Install dependencies

### Lambda Implementation
- [ ] Create QuarantineLambda handler
  - [ ] Parse CloudTrail MoveAccount event
  - [ ] Validate source OU is CleanUp (via `orgsService.getIsbOu()`)
  - [ ] Validate destination OU is Available
  - [ ] Get account from DynamoDB
  - [ ] Verify status is "Available"
  - [ ] Move account to Quarantine OU
  - [ ] Create EventBridge Scheduler for 72h later
- [ ] Create UnquarantineLambda handler
  - [ ] Get account from DynamoDB
  - [ ] Check status is still "Quarantine"
  - [ ] If yes, move to Available OU
  - [ ] Delete scheduler (cleanup)

### CDK Infrastructure
- [ ] Create CDK stack
- [ ] Import existing resources (DynamoDB table ARN, etc.)
- [ ] Create QuarantineLambda with proper IAM role
- [ ] Create UnquarantineLambda with proper IAM role
- [ ] Create EventBridge rule for MoveAccount events
- [ ] Create IAM role for EventBridge Scheduler
- [ ] Configure cross-account event routing (if needed)

### IAM Permissions Required
- [ ] DynamoDB: GetItem, PutItem on Account table
- [ ] Organizations: MoveAccount (via cross-account role chain)
- [ ] STS: AssumeRole for Intermediate and Org Mgmt roles
- [ ] Scheduler: CreateSchedule, DeleteSchedule
- [ ] Lambda: InvokeFunction (for scheduler to invoke unquarantine)
- [ ] Logs: CreateLogGroup, CreateLogStream, PutLogEvents

### Testing
- [ ] Unit tests for Lambda handlers
- [ ] Integration test: trigger cleanup, verify quarantine
- [ ] Integration test: verify 72h unquarantine (use shorter time for testing)
- [ ] Test manual unquarantine doesn't get overridden
- [ ] Test idempotency (multiple events for same account)

### Deployment
- [ ] Deploy to test environment
- [ ] Verify CloudTrail events are received
- [ ] Monitor CloudWatch logs
- [ ] Test full flow with real account cleanup

---

## Open Questions for Implementation

1. **Cross-account event routing** - Confirm whether Organization trail events are already forwarded to Hub Account, or if we need to set up cross-account EventBridge rule.

2. **Scheduler group** - Should we use a dedicated scheduler group for easy management/cleanup?

3. **Error handling** - What should happen if quarantine or unquarantine fails? Retry? Alert? DLQ?

4. **Monitoring/Alerting** - Should we emit custom metrics or set up CloudWatch alarms?

5. **Removal strategy** - When upstream solution is available, what's the migration path? Disable rule first, then remove?

---

## Version History

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-27 | Cns | Initial research document |
| 2026-01-27 | Cns | Added race condition mitigation via CloudTrail MoveAccount event |
| 2026-01-27 | Cns | Added git submodule dependency strategy |
| 2026-01-27 | Cns | Added live environment configuration from AWS API exploration |
| 2026-01-27 | Cns | Added implementation checklist and open questions |
