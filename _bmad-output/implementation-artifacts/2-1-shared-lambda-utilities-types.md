# Story 2.1: Shared Lambda Utilities & Types

Status: done

## Story

As a **Developer**,
I want **shared utilities, types, and constants for the Lambda handlers**,
So that **both handlers use consistent code and the event parsing is tested independently**.

## Acceptance Criteria

1. **AC1: Constants Configuration**
   - Given the project structure from Epic 1
   - When `source/lambdas/shared/constants.ts` is created
   - Then it exports `QUARANTINE_DURATION_HOURS = 72`
   - And it exports `SCHEDULER_GROUP = "isb-billing-separator"`
   - And it exports `SCHEDULER_NAME_PREFIX = "isb-billing-sep-unquarantine"`
   - And it exports environment variable keys as constants

2. **AC2: Type Definitions**
   - Given the shared utilities are created
   - When `source/lambdas/shared/types.ts` is created
   - Then it exports `CloudTrailMoveAccountEvent` type matching the expected event structure
   - And it exports `SchedulerPayload` type for the unquarantine scheduler invocation
   - And it exports `QuarantineResult` and `UnquarantineResult` types for handler responses

3. **AC3: Event Parser Implementation**
   - Given the shared utilities are created
   - When `source/lambdas/shared/event-parser.ts` is created
   - Then it exports `parseCloudTrailEvent(event: SQSEvent)` function
   - And the function extracts `accountId`, `sourceParentId`, `destinationParentId` from the CloudTrail event payload
   - And the function uses Zod for runtime validation
   - And the function throws descriptive errors for malformed events

4. **AC4: Event Parser Tests**
   - Given the event parser is implemented
   - When unit tests are run (`source/lambdas/shared/event-parser.test.ts`)
   - Then valid CloudTrail events are parsed correctly
   - And malformed events throw appropriate errors
   - And missing required fields throw appropriate errors

5. **AC5: Test Fixtures**
   - Given test fixtures are created
   - When `source/lambdas/__fixtures__/cloudtrail-move-account-event.json` exists
   - Then it contains a realistic CloudTrail MoveAccount event payload
   - And it can be used for handler unit tests

## Tasks / Subtasks

- [x] **Task 1: Create Constants Module** (AC: #1)
  - [x] 1.1 Create `source/lambdas/shared/constants.ts`
  - [x] 1.2 Add `QUARANTINE_DURATION_HOURS = 72`
  - [x] 1.3 Add `SCHEDULER_GROUP = "isb-billing-separator"`
  - [x] 1.4 Add `SCHEDULER_NAME_PREFIX = "isb-billing-sep-unquarantine"`
  - [x] 1.5 Add environment variable key constants (ACCOUNT_TABLE_NAME, SANDBOX_OU_ID, etc.)

- [x] **Task 2: Create Type Definitions** (AC: #2)
  - [x] 2.1 Create `source/lambdas/shared/types.ts`
  - [x] 2.2 Define `CloudTrailMoveAccountEvent` type with nested structure
  - [x] 2.3 Define `ParsedMoveAccountEvent` type for parsed result
  - [x] 2.4 Define `SchedulerPayload` type for unquarantine invocation
  - [x] 2.5 Define `QuarantineResult` and `UnquarantineResult` handler response types

- [x] **Task 3: Create Event Parser** (AC: #3)
  - [x] 3.1 Create `source/lambdas/shared/event-parser.ts`
  - [x] 3.2 Install/configure Zod for validation
  - [x] 3.3 Define Zod schema for CloudTrail event structure
  - [x] 3.4 Implement `parseCloudTrailEvents(event: SQSEvent)` function
  - [x] 3.5 Extract accountId, sourceParentId, destinationParentId
  - [x] 3.6 Add descriptive error messages for validation failures

- [x] **Task 4: Create Test Fixtures** (AC: #5)
  - [x] 4.1 Create `source/lambdas/__fixtures__/cloudtrail-move-account-event.json`
  - [x] 4.2 Create fixture based on actual event structure from Story 1.1 spike
  - [x] 4.3 Include realistic account IDs and OU IDs
  - [x] 4.4 Create SQS wrapper fixture for testing

- [x] **Task 5: Create Event Parser Tests** (AC: #4)
  - [x] 5.1 Create `source/lambdas/shared/event-parser.test.ts`
  - [x] 5.2 Test valid CloudTrail event parsing
  - [x] 5.3 Test malformed event handling
  - [x] 5.4 Test missing required fields handling
  - [x] 5.5 Test SQS record unwrapping

- [x] **Task 6: Final Validation** (AC: #4)
  - [x] 6.1 Run `npm run lint` and fix any issues
  - [x] 6.2 Run `npm test` and ensure all tests pass
  - [x] 6.3 Run `npm run build` and verify compilation
  - [x] 6.4 Run `npm run validate` for full validation

## Dev Notes

### Critical Context

This story creates the foundation for the Lambda handlers in Stories 2.2 and 2.3. The event parser is crucial because:
- CloudTrail events come wrapped in SQS messages
- Event structure must be validated at runtime
- Errors should be descriptive to aid debugging

### Previous Story Intelligence

**From Story 1.1 (Spike):**
The actual CloudTrail MoveAccount event structure observed:
```json
{
  "version": "0",
  "id": "...",
  "detail-type": "AWS API Call via CloudTrail",
  "source": "aws.organizations",
  "account": "955063685555",
  "time": "2026-01-28T...",
  "region": "us-east-1",
  "detail": {
    "eventSource": "organizations.amazonaws.com",
    "eventName": "MoveAccount",
    "requestParameters": {
      "accountId": "417845783913",
      "sourceParentId": "ou-2laj-oihxgbtr",
      "destinationParentId": "ou-2laj-x3o8lbk8"
    }
  }
}
```

**From Story 1.3 (Stack Shell):**
- Environment variables configured via CDK context
- Zod already installed as peer dependency for ISB commons

### Environment Variable Keys

```typescript
export const ENV_KEYS = {
  ACCOUNT_TABLE_NAME: 'ACCOUNT_TABLE_NAME',
  SANDBOX_OU_ID: 'SANDBOX_OU_ID',
  AVAILABLE_OU_ID: 'AVAILABLE_OU_ID',
  QUARANTINE_OU_ID: 'QUARANTINE_OU_ID',
  CLEANUP_OU_ID: 'CLEANUP_OU_ID',
  INTERMEDIATE_ROLE_ARN: 'INTERMEDIATE_ROLE_ARN',
  ORG_MGT_ROLE_ARN: 'ORG_MGT_ROLE_ARN',
  SCHEDULER_ROLE_ARN: 'SCHEDULER_ROLE_ARN',
  SCHEDULER_GROUP: 'SCHEDULER_GROUP',
  USER_AGENT_EXTRA: 'USER_AGENT_EXTRA',
} as const;
```

### SQS Event Wrapper

CloudTrail events arrive via EventBridge → SQS, so the Lambda receives an SQS event:
```typescript
// SQS event structure
{
  Records: [{
    messageId: "...",
    body: JSON.stringify(cloudTrailEvent), // The actual CloudTrail event
    ...
  }]
}
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1]
- [Source: _bmad-output/implementation-artifacts/1-1-event-routing-validation-spike.md#Expected Event Structure]
- [Zod Documentation](https://zod.dev/)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- Fixed Zod v4 API change: `error.errors` → `error.issues`
- Added JSON import attributes for ESM TypeScript (`with { type: 'json' }`)

### Completion Notes List

1. Created constants.ts with quarantine configuration and environment variable keys
2. Created types.ts with full CloudTrail event types and handler response types
3. Created event-parser.ts with Zod validation for MoveAccount events
4. Added helper functions: isValidAccountId, isValidOuId
5. Created test fixtures matching actual CloudTrail event structure
6. Comprehensive test suite with 15 tests covering valid/invalid scenarios

### File List

- source/lambdas/shared/constants.ts - Constants and configuration
- source/lambdas/shared/types.ts - TypeScript type definitions
- source/lambdas/shared/event-parser.ts - CloudTrail event parser with Zod
- source/lambdas/shared/event-parser.test.ts - Unit tests (15 tests)
- source/lambdas/__fixtures__/cloudtrail-move-account-event.json - Test fixture
- source/lambdas/__fixtures__/sqs-event-wrapper.json - SQS wrapper fixture

### Change Log

- 2026-01-28 17:45: Story file created, status: ready-for-dev
- 2026-01-28 18:00: Implementation complete, all 36 tests passing
- 2026-01-28 18:05: Fixed Zod error.issues API, added JSON import attributes
- 2026-01-28 18:05: Validation passing, status: review
- 2026-01-28 18:10: Code review: Fixed H1 (batch size limit), H2 (account validation), M1 (sanitized error details), M2 (root ID support), L1 (unified validators)
- 2026-01-28 18:10: Added tests for batch size limit, root ID support, isValidParentId
- 2026-01-28 18:10: All 41 tests passing, status: done
