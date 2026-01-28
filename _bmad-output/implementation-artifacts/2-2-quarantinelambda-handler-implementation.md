# Story 2.2: QuarantineLambda Handler Implementation

Status: done

## Story

As an **ISB Platform Operator**,
I want **accounts moving from CleanUp to Available to be automatically intercepted and quarantined**,
So that **billing data has time to settle before the account is reused**.

## Acceptance Criteria

1. **AC1: Event Parsing**
   - Given a CloudTrail MoveAccount event is received via SQS
   - When the destination is the Available OU
   - Then the QuarantineLambda parses the event using the shared event parser (FR15)

2. **AC2: Source OU Validation**
   - Given the event is parsed successfully
   - When the source OU is validated
   - Then a fresh lookup resolves the CleanUp OU ID via `orgsService.getIsbOu("CleanUp")` (FR2)
   - And if source is NOT CleanUp, the handler logs "Skipping non-cleanup move" and returns success (FR34)

3. **AC3: Quarantine Execution**
   - Given the source OU is CleanUp
   - When the quarantine is executed
   - Then the account is moved from Available to Quarantine OU using `transactionalMoveAccount()` (FR3, FR4)
   - And the move and DynamoDB update happen atomically
   - And structured JSON logs record accountId, sourceOu, timestamp with action="QUARANTINE_START" (FR5)

4. **AC4: Scheduler Creation**
   - Given the account is quarantined successfully
   - When the scheduler is created
   - Then an EventBridge Scheduler is created with 72-hour delay (FR10)
   - And the scheduler name follows pattern `isb-billing-sep-unquarantine-{accountId}-{timestamp}` (FR11)
   - And the scheduler is one-time with precise timing (no flexible window) (FR12)
   - And the scheduler is in group `isb-billing-separator`

5. **AC5: Error Handling**
   - Given any operation fails (OU move or scheduler creation)
   - When the error is caught
   - Then the handler throws an error (not swallows it) to trigger retry/DLQ (FR27, FR29)
   - And error details including stack trace are logged (FR30)

6. **AC6: Idempotency**
   - Given the handler is invoked multiple times for the same event
   - When the account is already in Quarantine status
   - Then the handler skips processing and returns success (idempotent) (FR16)
   - And logs indicate the skip with action="QUARANTINE_SKIP"

7. **AC7: Unit Tests**
   - Given unit tests are run (`source/lambdas/quarantine/handler.test.ts`)
   - When ISB services are mocked
   - Then happy path (CleanUp→Quarantine) is tested
   - And skip path (non-CleanUp source) is tested
   - And idempotent skip (already quarantined) is tested
   - And error handling (OU move failure) is tested
   - And error handling (scheduler creation failure after successful OU move) is tested

## Tasks / Subtasks

- [x] **Task 1: Create Handler Module Structure** (AC: #1)
  - [x] 1.1 Create `source/lambdas/quarantine/handler.ts`
  - [x] 1.2 Create handler entry point with SQS event signature
  - [x] 1.3 Import shared utilities (event-parser, constants, types)

- [x] **Task 2: Implement Source OU Validation** (AC: #2)
  - [x] 2.1 Initialize ISB services (SandboxOuService)
  - [x] 2.2 Use ISB credential helper for cross-account access (FR31-33)
  - [x] 2.3 Implement fresh CleanUp OU lookup via `orgsService.getIsbOu("CleanUp")`
  - [x] 2.4 Implement skip logic for non-CleanUp sources with logging

- [x] **Task 3: Implement Quarantine Execution** (AC: #3)
  - [x] 3.1 Get Quarantine OU ID via `orgsService.getIsbOu("Quarantine")`
  - [x] 3.2 Call `transactionalMoveAccount()` for atomic OU + DB update
  - [x] 3.3 Add structured logging with action="QUARANTINE_START"

- [x] **Task 4: Implement Scheduler Creation** (AC: #4)
  - [x] 4.1 Create EventBridge Scheduler client
  - [x] 4.2 Calculate schedule time (now + 72 hours)
  - [x] 4.3 Generate scheduler name: `isb-billing-sep-unquarantine-{accountId}-{timestamp}`
  - [x] 4.4 Create one-time schedule with FLEXIBLE_WINDOW disabled
  - [x] 4.5 Configure scheduler in group `isb-billing-separator`
  - [x] 4.6 Set scheduler target as UnquarantineLambda ARN

- [x] **Task 5: Implement Idempotency** (AC: #6)
  - [x] 5.1 Check account current status before processing
  - [x] 5.2 Skip if already "Quarantine" status
  - [x] 5.3 Log skip with action="QUARANTINE_SKIP"

- [x] **Task 6: Implement Error Handling** (AC: #5)
  - [x] 6.1 Wrap operations in try/catch
  - [x] 6.2 Log errors with stack trace
  - [x] 6.3 Re-throw errors to trigger retry/DLQ

- [x] **Task 7: Create Unit Tests** (AC: #7)
  - [x] 7.1 Create `source/lambdas/quarantine/handler.test.ts`
  - [x] 7.2 Create ISB service mocks
  - [x] 7.3 Test happy path (CleanUp→Quarantine)
  - [x] 7.4 Test skip path (non-CleanUp source)
  - [x] 7.5 Test idempotent skip (already quarantined)
  - [x] 7.6 Test OU move failure error handling
  - [x] 7.7 Test scheduler creation failure error handling

- [x] **Task 8: Final Validation** (AC: all)
  - [x] 8.1 Run `npm run lint` and fix any issues
  - [x] 8.2 Run `npm test` and ensure all tests pass
  - [x] 8.3 Run `npm run build` and verify compilation
  - [x] 8.4 Run `npm run validate` for full validation

## Dev Notes

### Critical Context

This handler is the entry point for the quarantine lifecycle. It must:
1. Parse CloudTrail events from SQS
2. Validate source OU is CleanUp (fresh lookup each time)
3. Atomically move account to Quarantine OU and update DynamoDB
4. Create EventBridge Scheduler for 72-hour delayed release
5. Handle errors by re-throwing (not swallowing) to enable retry

### Previous Story Intelligence

**From Story 2.1:**
- Event parser: `parseCloudTrailEvents(sqsEvent)` returns `ParsedMoveAccountEvent[]`
- Constants: `QUARANTINE_DURATION_HOURS`, `SCHEDULER_GROUP`, `SCHEDULER_NAME_PREFIX`
- Types: `ParsedMoveAccountEvent`, `QuarantineResult`
- Validation helpers: `isValidAccountId`, `isValidOuId`, `isValidParentId`

**From Story 1.1 (Spike):**
- Events originate from OrgMgmt account, forwarded to Hub EventBridge
- Event structure confirmed in cloudtrail-move-account-event.json fixture

### ISB Service Integration

```typescript
// Cross-account credentials
import { fromTemporaryIsbOrgManagementCredentials } from '@amzn/innovation-sandbox-commons/utils/cross-account-roles.js';

// OU service for lookups and moves
import { SandboxOuService } from '@amzn/innovation-sandbox-commons/isb-services/sandbox-ou-service.js';

// Account store for status lookups
import { DynamoSandboxAccountStore } from '@amzn/innovation-sandbox-commons/data/sandbox-account/dynamo-sandbox-account-store.js';
```

### Scheduler Configuration

```typescript
// Scheduler name pattern
const schedulerName = `${SCHEDULER_NAME_PREFIX}-${accountId}-${Date.now()}`;

// Schedule expression (72 hours from now)
const scheduleTime = new Date(Date.now() + QUARANTINE_DURATION_HOURS * 60 * 60 * 1000);
const scheduleExpression = `at(${scheduleTime.toISOString().replace(/\.\d{3}Z$/, '')})`;

// Scheduler config
{
  Name: schedulerName,
  GroupName: SCHEDULER_GROUP,
  ScheduleExpression: scheduleExpression,
  FlexibleTimeWindow: { Mode: 'OFF' },
  Target: {
    Arn: process.env.UNQUARANTINE_LAMBDA_ARN,
    RoleArn: process.env.SCHEDULER_ROLE_ARN,
    Input: JSON.stringify({
      accountId,
      quarantinedAt: new Date().toISOString(),
      schedulerName,
    }),
  },
}
```

### Environment Variables Required

```typescript
// From ENV_KEYS
ACCOUNT_TABLE_NAME    // ISB DynamoDB table
SANDBOX_OU_ID         // Parent ISB OU
AVAILABLE_OU_ID       // Destination that triggers quarantine
QUARANTINE_OU_ID      // Where accounts are held
CLEANUP_OU_ID         // Source OU that triggers quarantine
INTERMEDIATE_ROLE_ARN // ISB Hub role for role chaining
ORG_MGT_ROLE_ARN      // ISB Org Management role
SCHEDULER_ROLE_ARN    // IAM role for scheduler to invoke Lambda
SCHEDULER_GROUP       // EventBridge Scheduler group name
UNQUARANTINE_LAMBDA_ARN // Target Lambda for scheduler
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2]
- [Source: _bmad-output/implementation-artifacts/2-1-shared-lambda-utilities-types.md]
- [ISB SandboxOuService](deps/isb/source/common/isb-services/sandbox-ou-service.ts)
- [ISB cross-account-roles](deps/isb/source/common/utils/cross-account-roles.ts)
- [EventBridge Scheduler CreateSchedule API](https://docs.aws.amazon.com/scheduler/latest/APIReference/API_CreateSchedule.html)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- ISB TypeScript integration challenges required creating declaration files (types/isb-commons.d.ts)
- Jest module resolution required explicit moduleNameMapper entries for ISB mocks

### Completion Notes List

1. QuarantineLambda handler fully implements all 7 ACs
2. Uses ISB's `SandboxOuService` and `DynamoSandboxAccountStore` via mocked imports
3. Cross-account credentials via `fromTemporaryIsbOrgManagementCredentials()`
4. Scheduler uses `FlexibleTimeWindowMode.OFF` for precise 72-hour timing
5. Partial batch response pattern enables individual message retry
6. 7 test cases cover all scenarios including edge cases

### File List

**Created:**
- `source/lambdas/quarantine/handler.ts` - QuarantineLambda handler (338 lines)
- `source/lambdas/quarantine/handler.test.ts` - Unit tests (356 lines, 7 test cases)

**Modified:**
- `source/lambdas/shared/constants.ts` - Added SCHEDULER_CREATED, SCHEDULER_CREATE_FAILED LOG_ACTIONS
- `package.json` - Added @aws-sdk/client-scheduler dependency

**Supporting (created in prior session for ISB integration):**
- `types/isb-commons.d.ts` - TypeScript declarations for ISB commons
- `tsconfig.build.json` - Build-specific config using declarations
- `jest.config.js` - Module mappings for ISB in tests

### Change Log

- 2026-01-28 18:15: Story file created, status: ready-for-dev
- 2026-01-28: Handler implementation complete with all tests passing (51 total)
- 2026-01-28: Code review fixes applied (LOG_ACTIONS consistency, redundant check removal)
- 2026-01-28: Story marked done after successful validation
