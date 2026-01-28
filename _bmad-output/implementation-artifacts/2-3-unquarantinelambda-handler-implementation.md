# Story 2.3: UnquarantineLambda Handler Implementation

Status: done

## Story

As an **ISB Platform Operator**,
I want **quarantined accounts to be automatically released after 72 hours**,
So that **accounts return to the Available pool with clean billing attribution**.

## Acceptance Criteria

1. **AC1: Scheduler Payload Parsing**
   - Given the EventBridge Scheduler fires after 72 hours
   - When the UnquarantineLambda is invoked
   - Then the handler parses the scheduler payload containing `accountId`, `quarantinedAt`, `schedulerName`

2. **AC2: Account Status Validation**
   - Given the payload is parsed
   - When the account status is validated
   - Then the handler reads the account from DynamoDB via `accountStore.get(accountId)`
   - And if status is NOT "Quarantine", the handler logs "Account not in expected state, skipping" and returns success (FR8)
   - And logs indicate the skip with action="UNQUARANTINE_SKIP"

3. **AC3: Release Execution**
   - Given the account status is "Quarantine"
   - When the release is executed
   - Then the account is moved from Quarantine to Available OU using `transactionalMoveAccount()` (FR6, FR7)
   - And the move and DynamoDB update happen atomically
   - And structured JSON logs record accountId, timestamp with action="UNQUARANTINE_START" (FR9)

4. **AC4: Scheduler Cleanup**
   - Given the account is released successfully
   - When cleanup is performed
   - Then the EventBridge Scheduler that triggered this invocation is deleted (FR35)
   - And logs record action="UNQUARANTINE_COMPLETE"
   - And scheduler deletion uses `schedulerName` from the payload

5. **AC5: Error Handling**
   - Given any operation fails (OU move or scheduler deletion)
   - When the error is caught
   - Then the handler throws an error to trigger retry
   - And error details including stack trace are logged with action="HANDLER_ERROR"

6. **AC6: Idempotency**
   - Given the handler is invoked multiple times for the same event
   - When the account is already in Available status
   - Then the handler skips the OU move and returns success (idempotent)
   - And the handler still attempts scheduler cleanup (idempotent delete)

7. **AC7: Unit Tests**
   - Given unit tests are run (`source/lambdas/unquarantine/handler.test.ts`)
   - When ISB services are mocked
   - Then happy path (Quarantine→Available) is tested
   - And skip path (not in Quarantine status) is tested
   - And skip path (account not found) is tested
   - And error handling (OU move failure) is tested
   - And scheduler cleanup is tested

## Tasks / Subtasks

- [x] **Task 1: Create Handler Module Structure** (AC: #1)
  - [x] 1.1 Create `source/lambdas/unquarantine/handler.ts`
  - [x] 1.2 Create handler entry point with scheduler event signature
  - [x] 1.3 Import shared utilities (constants, types)
  - [x] 1.4 Define SchedulerEvent type for parsing scheduler payload

- [x] **Task 2: Implement Payload Parsing** (AC: #1)
  - [x] 2.1 Parse `accountId`, `quarantinedAt`, `schedulerName` from event
  - [x] 2.2 Validate payload using Zod schema
  - [x] 2.3 Throw descriptive error for malformed payloads

- [x] **Task 3: Implement Account Status Validation** (AC: #2)
  - [x] 3.1 Initialize ISB services (SandboxOuService, DynamoSandboxAccountStore)
  - [x] 3.2 Use ISB credential helper for cross-account access
  - [x] 3.3 Fetch account from DynamoDB
  - [x] 3.4 Implement skip logic for non-Quarantine status with logging

- [x] **Task 4: Implement Release Execution** (AC: #3)
  - [x] 4.1 Get Available OU ID via `orgsService.getIsbOu("Available")`
  - [x] 4.2 Call `transactionalMoveAccount()` for atomic OU + DB update
  - [x] 4.3 Add structured logging with action="UNQUARANTINE_START"
  - [x] 4.4 Add structured logging with action="UNQUARANTINE_COMPLETE"

- [x] **Task 5: Implement Scheduler Cleanup** (AC: #4)
  - [x] 5.1 Create SchedulerClient
  - [x] 5.2 Delete scheduler using `schedulerName` from payload
  - [x] 5.3 Handle scheduler not found (already deleted) gracefully
  - [x] 5.4 Add structured logging with action="SCHEDULER_DELETED"

- [x] **Task 6: Implement Idempotency** (AC: #6)
  - [x] 6.1 Skip OU move if account already in Available status
  - [x] 6.2 Still attempt scheduler cleanup for idempotency
  - [x] 6.3 Log skip with action="UNQUARANTINE_SKIP"

- [x] **Task 7: Implement Error Handling** (AC: #5)
  - [x] 7.1 Wrap operations in try/catch
  - [x] 7.2 Log errors with stack trace
  - [x] 7.3 Re-throw errors to trigger retry

- [x] **Task 8: Create Unit Tests** (AC: #7)
  - [x] 8.1 Create `source/lambdas/unquarantine/handler.test.ts`
  - [x] 8.2 Create ISB service mocks (reuse from quarantine tests)
  - [x] 8.3 Test happy path (Quarantine→Available)
  - [x] 8.4 Test skip path (not in Quarantine status)
  - [x] 8.5 Test skip path (account not found)
  - [x] 8.6 Test OU move failure error handling
  - [x] 8.7 Test scheduler cleanup (success and not found scenarios)

- [x] **Task 9: Final Validation** (AC: all)
  - [x] 9.1 Run `npm run lint` and fix any issues
  - [x] 9.2 Run `npm test` and ensure all tests pass
  - [x] 9.3 Run `npm run build` and verify compilation
  - [x] 9.4 Run `npm run validate` for full validation

## Dev Notes

### Critical Context

This handler is the release endpoint of the quarantine lifecycle. It must:
1. Parse the scheduler payload (not SQS event - direct invocation)
2. Validate account is still in Quarantine status
3. Atomically move account to Available OU and update DynamoDB
4. Clean up the EventBridge Scheduler that triggered this invocation
5. Handle errors by re-throwing (not swallowing) to enable retry

### Previous Story Intelligence

**From Story 2.1:**
- Constants: `QUARANTINE_DURATION_HOURS`, `SCHEDULER_GROUP`, `SCHEDULER_NAME_PREFIX`
- Types: `SchedulerPayload` for the invocation payload
- LOG_ACTIONS: `UNQUARANTINE_START`, `UNQUARANTINE_SKIP`, `UNQUARANTINE_COMPLETE`, `SCHEDULER_DELETED`, `SCHEDULER_DELETE_FAILED`

**From Story 2.2:**
- ISB service initialization pattern (same pattern applies)
- Cross-account credential setup via `fromTemporaryIsbOrgManagementCredentials()`
- Structured logging helper function
- Error handling pattern (throw on failure)

### ISB Service Integration

```typescript
// Same imports as QuarantineLambda
import { SandboxOuService } from '@amzn/innovation-sandbox-commons/isb-services/sandbox-ou-service.js';
import { DynamoSandboxAccountStore } from '@amzn/innovation-sandbox-commons/data/sandbox-account/dynamo-sandbox-account-store.js';
import { fromTemporaryIsbOrgManagementCredentials } from '@amzn/innovation-sandbox-commons/utils/cross-account-roles.js';
```

### Scheduler Payload Structure

```typescript
// Payload created by QuarantineLambda when creating the scheduler
interface SchedulerPayload {
  accountId: string;
  quarantinedAt: string;  // ISO 8601 timestamp
  schedulerName: string;  // Used for cleanup
}
```

### Scheduler Deletion

```typescript
import { SchedulerClient, DeleteScheduleCommand } from '@aws-sdk/client-scheduler';

// Delete the scheduler that triggered this invocation
await schedulerClient.send(
  new DeleteScheduleCommand({
    Name: schedulerName,
    GroupName: SCHEDULER_GROUP,
  })
);

// Handle ResourceNotFoundException gracefully (idempotent)
```

### Environment Variables Required

```typescript
// From ENV_KEYS (same as QuarantineLambda)
ACCOUNT_TABLE_NAME    // ISB DynamoDB table
SANDBOX_OU_ID         // Parent ISB OU
INTERMEDIATE_ROLE_ARN // ISB Hub role for role chaining
ORG_MGT_ROLE_ARN      // ISB Org Management role
USER_AGENT_EXTRA      // Custom user agent
```

### Key Differences from QuarantineLambda

| Aspect | QuarantineLambda | UnquarantineLambda |
|--------|------------------|---------------------|
| Trigger | SQS (CloudTrail event) | EventBridge Scheduler (direct) |
| Input | SQSEvent | SchedulerPayload |
| Direction | Available → Quarantine | Quarantine → Available |
| Scheduler action | Create | Delete |
| Batch processing | Yes (SQS batch) | No (single account) |

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3]
- [Source: _bmad-output/implementation-artifacts/2-2-quarantinelambda-handler-implementation.md]
- [ISB SandboxOuService](deps/isb/source/common/isb-services/sandbox-ou-service.ts)
- [EventBridge Scheduler DeleteSchedule API](https://docs.aws.amazon.com/scheduler/latest/APIReference/API_DeleteSchedule.html)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- Payload parsing uses Zod v4 schema validation (`.issues` API)
- Scheduler cleanup handles `ResourceNotFoundException` for idempotent delete

### Completion Notes List

1. UnquarantineLambda handler fully implements all 7 ACs
2. Payload validation via Zod schema with clear error messages
3. Idempotent behavior: skips OU move if already Available but still deletes scheduler
4. Scheduler cleanup handles already-deleted gracefully (`ResourceNotFoundException`)
5. Error handling re-throws for retry mechanism
6. 11 test cases covering all scenarios including edge cases
7. All 62 tests pass across 5 test suites

### File List

**Created:**
- `source/lambdas/unquarantine/handler.ts` - UnquarantineLambda handler (296 lines)
- `source/lambdas/unquarantine/handler.test.ts` - Unit tests (317 lines, 11 test cases)

### Change Log

- 2026-01-28: Story file created, status: ready-for-dev
- 2026-01-28: Handler implementation complete with all tests passing (62 total)
- 2026-01-28: Story marked done after successful validation
