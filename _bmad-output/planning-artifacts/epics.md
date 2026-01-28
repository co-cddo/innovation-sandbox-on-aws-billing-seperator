---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '../innovation-sandbox-on-aws (related codebase)'
---

# innovation-sandbox-on-aws-billing-seperator - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for innovation-sandbox-on-aws-billing-seperator, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

**Account Quarantine (6 requirements)**

| ID | Requirement | Priority |
|----|-------------|----------|
| FR1 | System SHALL intercept MoveAccount events where destination is Available OU | MVP |
| FR2 | System SHALL validate source OU is CleanUp before quarantining (fresh lookup each invocation) | MVP |
| FR3 | System SHALL move intercepted accounts from Available to Quarantine OU using `transactionalMoveAccount()` | MVP |
| FR4 | System SHALL update DynamoDB account status to "Quarantine" atomically with OU move | MVP |
| FR5 | System SHALL log account ID, source OU, and timestamp for each quarantine action | MVP |
| FR34 | System SHALL skip quarantine (log and exit success) if source OU is not CleanUp | MVP |

**Account Release (5 requirements)**

| ID | Requirement | Priority |
|----|-------------|----------|
| FR6 | System SHALL move accounts from Quarantine to Available OU after 72-hour period | MVP |
| FR7 | System SHALL update DynamoDB account status to "Available" atomically with OU move | MVP |
| FR8 | System SHALL verify account status is still "Quarantine" before releasing (skip if changed) | MVP |
| FR9 | System SHALL log account ID and timestamp for each unquarantine action | MVP |
| FR35 | System SHALL delete the EventBridge Scheduler after successful unquarantine | MVP |

**Scheduling (4 requirements)**

| ID | Requirement | Priority |
|----|-------------|----------|
| FR10 | System SHALL create EventBridge Scheduler with 72-hour delay after quarantine | MVP |
| FR11 | System SHALL name schedulers predictably: `isb-billing-sep-unquarantine-{accountId}-{timestamp}` | MVP |
| FR12 | System SHALL configure scheduler as one-time with precise timing (no flexible window) | MVP |
| FR36 | System SHALL include scheduler IAM role ARN in Lambda environment configuration | MVP |

**Event Processing (5 requirements)**

| ID | Requirement | Priority |
|----|-------------|----------|
| FR13 | System SHALL receive CloudTrail MoveAccount events via EventBridge rule | MVP |
| FR14 | System SHALL buffer events through SQS queue before Lambda processing | MVP |
| FR15 | System SHALL parse accountId, sourceParentId, and destinationParentId from event payload | MVP |
| FR16 | System SHALL process events idempotently (safe to retry without side effects) | MVP |
| FR38 | System SHALL configure EventBridge rule with DLQ for SQS delivery failures | MVP |

**Observability (5 requirements)**

| ID | Requirement | Priority |
|----|-------------|----------|
| FR17 | System SHALL emit CloudWatch alarm when any account remains in Quarantine status > 80 hours | MVP |
| FR18 | System SHALL emit CloudWatch alarm when SQS DLQ message count >= 3 | MVP |
| FR19 | System SHALL emit CloudWatch alarm when account moves CleanUp→Available without hitting Quarantine (bypass detection) | MVP |
| FR20 | System SHALL write structured JSON logs with account ID correlation | MVP |
| FR21 | System SHALL send alarm notifications to SNS topic for operator alerts | MVP |

**Operations (5 requirements)**

| ID | Requirement | Priority |
|----|-------------|----------|
| FR22 | System SHALL deploy via CDK as standalone CloudFormation stack | MVP |
| FR23 | System SHALL support deployment via CI/CD with OIDC/STS authentication | MVP |
| FR24 | System SHALL enable complete removal via single `cdk destroy` command | MVP |
| FR25 | System SHALL prefix all resources with `isb-billing-sep` for identification | MVP |
| FR26 | System SHALL configure all environment variables via CDK context/props | MVP |

**Error Handling (4 requirements)**

| ID | Requirement | Priority |
|----|-------------|----------|
| FR27 | System SHALL route failed Lambda invocations to DLQ after 5 SQS receive attempts | MVP |
| FR28 | System SHALL preserve failed event payload in DLQ for manual investigation | MVP |
| FR29 | System SHALL use Lambda async retry (2 automatic retries) before DLQ | MVP |
| FR30 | System SHALL log error details including stack trace for failed operations | MVP |

**Cross-Account Access (4 requirements)**

| ID | Requirement | Priority |
|----|-------------|----------|
| FR31 | System SHALL assume intermediate role in Hub account for cross-account access | MVP |
| FR32 | System SHALL chain role assumption to OrgManagement account for Organizations API | MVP |
| FR33 | System SHALL use ISB commons credential helper `fromTemporaryIsbOrgManagementCredentials()` | MVP |
| FR37 | System SHALL manage IAM trust policy entries via CloudFormation (auto-cleanup on stack destroy) | MVP |

### NonFunctional Requirements

**Security (4 requirements)**

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-S1 | IAM roles SHALL follow least-privilege principle | Only permissions required for specific operations |
| NFR-S2 | Cross-account role chains SHALL use time-limited credentials | STS tokens with 1-hour max duration |
| NFR-S3 | Lambda execution role SHALL have write access limited to account status attribute | DynamoDB UpdateItem on status field only |
| NFR-S4 | Secrets, ARNs, and OU IDs SHALL be passed via environment variables, not hardcoded | Zero hardcoded values in source |

**Reliability (4 requirements)**

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-R1 | Event processing SHALL survive Lambda transient failures | 5 SQS retries + 2 Lambda async retries before DLQ |
| NFR-R2 | System SHALL detect and alert on missed quarantine events | Bypass detection alarm triggers within 1 hour |
| NFR-R3 | System SHALL not lose events due to component failure | Two-layer DLQ (EventBridge rule + SQS) |
| NFR-R4 | Operations SHALL be idempotent | Account already in target state → no-op |

**Integration (4 requirements)**

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-I1 | System SHALL be compatible with ISB commons | Git submodule pinned to specific stable tag (v1.1.7) |
| NFR-I2 | System SHALL use existing ISB DynamoDB table schema | No schema modifications required |
| NFR-I3 | System SHALL coexist with ISB without runtime interference | Zero shared state beyond DB reads and OU moves |
| NFR-I4 | System SHALL support removal without ISB modification | Clean `cdk destroy`, manual account moves only |

**Operability (5 requirements)**

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-O1 | Normal operation SHALL NOT require operator intervention | Measurable via incident count (< 1/quarter) |
| NFR-O2 | All failures SHALL be surfaced via CloudWatch alarms | No silent failure modes |
| NFR-O3 | Logs SHALL enable root cause analysis | Account ID, timestamps, error details in every log entry |
| NFR-O4 | System state SHALL be inspectable via AWS Console | Scheduler names, OU positions, DynamoDB status queryable |
| NFR-O5 | All Lambda invocations SHALL be traceable end-to-end | X-Ray tracing enabled |

**Deployment (1 requirement)**

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-D1 | Stack deployment SHALL complete successfully on first attempt in clean environment | No manual intervention during deploy |

**Performance (1 requirement)**

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-P1 | Quarantine Lambda SHALL complete within 30 seconds | Timeout configured, fail-fast on issues |

### Additional Requirements

**From Architecture Document:**

| Category | Requirement |
|----------|-------------|
| Starter Template | CDK TypeScript with ISB git submodule (pinned to v1.1.7) |
| Pre-Implementation | Event routing spike required: Verify CloudTrail→Hub event routing before implementation |
| Runtime | Node.js 22.x, arm64 architecture for Lambda |
| Module System | ESM modules with .js extensions in imports |
| Scheduler Group | EventBridge Scheduler group: `isb-billing-separator` |
| Scheduler Naming | Pattern: `isb-billing-sep-unquarantine-{accountId}-{timestamp}` |
| Error Handling | Two-layer DLQ coverage (EventBridge rule DLQ + SQS DLQ) |
| CI/CD | GitHub Actions + OIDC for deployment |
| Stack Design | Single CDK stack for clean removal |
| State Management | Use ISB's `transactionalMoveAccount()` for atomic OU + DB updates |
| Logging | AWS Lambda Powertools (Logger, Tracer, Metrics) |
| Validation | Zod for runtime schema validation |
| Testing | Jest for unit tests, CDK assertions for infrastructure tests |
| Code Organization | `/source/lambdas/` with co-located tests |

**From ISB Codebase Analysis:**

| Category | Requirement |
|----------|-------------|
| ISB Integration | Must import `SandboxOuService`, `DynamoSandboxAccountStore`, `fromTemporaryIsbOrgManagementCredentials` from ISB commons |
| Account Status | Use existing ISB account statuses; add "Quarantine" status handling |
| OU Structure | Work with existing ISB OU hierarchy (CleanUp, Available, Quarantine OUs) |
| Credential Helper | Use ISB's cross-account credential helper for Organizations API access |
| Transactional Ops | Use ISB's `transactionalMoveAccount()` for atomic OU+DB consistency |

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1 | Epic 2 | Intercept MoveAccount events to Available OU |
| FR2 | Epic 2 | Validate source OU is CleanUp |
| FR3 | Epic 2 | Move accounts to Quarantine OU |
| FR4 | Epic 2 | Update DynamoDB status atomically |
| FR5 | Epic 2 | Log quarantine actions |
| FR6 | Epic 2 | Move accounts from Quarantine to Available |
| FR7 | Epic 2 | Update DynamoDB status on release |
| FR8 | Epic 2 | Verify status before releasing |
| FR9 | Epic 2 | Log unquarantine actions |
| FR10 | Epic 2 | Create 72-hour EventBridge Scheduler |
| FR11 | Epic 2 | Predictable scheduler naming |
| FR12 | Epic 2 | One-time scheduler with precise timing |
| FR13 | Epic 2 | Receive CloudTrail events via EventBridge |
| FR14 | Epic 2 | Buffer events through SQS |
| FR15 | Epic 2 | Parse event payload |
| FR16 | Epic 2 | Process events idempotently |
| FR17 | Epic 3 | Alarm for stuck accounts (>80h) |
| FR18 | Epic 3 | Alarm for DLQ message count |
| FR19 | Epic 3 | Alarm for bypass detection |
| FR20 | Epic 3 | Structured JSON logging |
| FR21 | Epic 3 | SNS notifications for alerts |
| FR22 | Epic 1 + 4 | Deploy via CDK standalone stack |
| FR23 | Epic 4 | CI/CD with OIDC/STS |
| FR24 | Epic 4 | Clean removal via cdk destroy |
| FR25 | Epic 1 | Resource prefix naming |
| FR26 | Epic 1 + 4 | Environment variables via CDK context |
| FR27 | Epic 2 | Route failed invocations to DLQ |
| FR28 | Epic 2 | Preserve failed events in DLQ |
| FR29 | Epic 2 | Lambda async retry before DLQ |
| FR30 | Epic 3 | Log error details with stack trace |
| FR31 | Epic 2 | Assume intermediate role |
| FR32 | Epic 2 | Chain role to OrgManagement |
| FR33 | Epic 2 | Use ISB credential helper |
| FR34 | Epic 2 | Skip non-CleanUp sources |
| FR35 | Epic 2 | Delete scheduler after unquarantine |
| FR36 | Epic 2 | Scheduler IAM role in env config |
| FR37 | Epic 4 | IAM trust policy via CloudFormation |
| FR38 | Epic 2 | EventBridge rule DLQ |

## Epic List

### Epic 1: Foundation & Validation
**User Outcome:** Development team has a validated approach and working project foundation.

**Goal:** Establish the project foundation and verify CloudTrail→Hub event routing.

**FRs covered:** FR22 (partial), FR25, FR26 (partial)

**What this enables:**
- Spike confirms event routing works (or identifies contingency needed)
- CDK TypeScript project initialized with ISB submodule
- Build and import verification complete
- Development can proceed with confidence

---

### Epic 2: Account Lifecycle Automation
**User Outcome:** Accounts transitioning from CleanUp are automatically quarantined for 72 hours then released back to the Available pool - complete billing isolation.

**Goal:** Implement the complete quarantine→release lifecycle including event pipeline, both Lambda handlers, and scheduler management.

**FRs covered:** FR1-16, FR27-29, FR31-36, FR38

**What this enables:**
- Accounts are intercepted when ISB moves them to Available OU
- Source validation ensures only CleanUp→Available moves are quarantined
- 72-hour scheduler is created for delayed release
- Accounts are released from Quarantine to Available OU after 72h
- Scheduler is cleaned up after successful release
- Event processing with SQS buffering and DLQ error handling
- Cross-account IAM for Organizations API access
- Complete quarantine lifecycle is operational

---

### Epic 3: Operational Monitoring
**User Outcome:** Operators have visibility into system health and are alerted to any issues requiring attention.

**Goal:** Implement observability that enables operators to monitor, troubleshoot, and respond to issues.

**FRs covered:** FR17-21, FR30

**What this enables:**
- CloudWatch alarm for stuck accounts (>80 hours in Quarantine)
- CloudWatch alarm for quarantine bypass detection
- CloudWatch alarm for DLQ threshold
- SNS topic for operator notifications
- Structured JSON logging with account ID correlation
- Error logging with stack traces for debugging

---

### Epic 4: Production Deployment
**User Outcome:** Solution can be deployed to production via CI/CD and cleanly removed when upstream ISB fix ships.

**Goal:** Enable production operations including deployment, configuration management, and clean removal.

**FRs covered:** FR22-24, FR26 (remaining), FR37

**What this enables:**
- GitHub Actions CI/CD pipeline with OIDC authentication
- Environment configuration via CDK context
- Clean removal via single `cdk destroy`
- IAM trust policy auto-cleanup on stack destroy
- Integration testing procedure documented

---

### Epic Summary

| Epic | Title | FRs | User Outcome |
|------|-------|-----|--------------|
| 1 | Foundation & Validation | 3 | Validated approach, working dev environment |
| 2 | Account Lifecycle Automation | 27 | Complete quarantine→release cycle operational |
| 3 | Operational Monitoring | 6 | Operators have visibility and alerting |
| 4 | Production Deployment | 5 | Production-ready with clean removal |

**Total: 4 Epics covering all 38 FRs**

---

## Epic 1: Foundation & Validation

**Goal:** Establish the project foundation and verify CloudTrail→Hub event routing.

**FRs covered:** FR22 (partial), FR25, FR26 (partial)

---

### Story 1.1: Event Routing Validation Spike

As an **ISB Platform Operator**,
I want **to verify that CloudTrail MoveAccount events reach the Hub account's EventBridge bus**,
So that **I can confirm the architectural approach will work before investing in implementation**.

**Acceptance Criteria:**

**Given** an Organization Trail exists logging AWS Organizations API events
**When** an account is moved between OUs (manually or via ISB cleanup)
**Then** the MoveAccount event appears on the Hub account's default EventBridge bus within 90 seconds
**And** the event payload contains `accountId`, `sourceParentId`, and `destinationParentId` fields

**Given** the CloudTrail event routing is verified
**When** the spike is complete
**Then** findings are documented in the architecture document's "Spike Results" section
**And** any contingency actions are identified (e.g., cross-account EventBridge rule needed)

**Given** the spike reveals events do NOT reach the Hub account
**When** the contingency is assessed
**Then** the architecture is updated to include cross-account EventBridge rule in Org Management account
**And** the CDK structure is updated for multi-stack deployment

---

### Story 1.2: Project Initialization with ISB Submodule

As a **Developer**,
I want **a properly initialized CDK TypeScript project with ISB commons as a dependency**,
So that **I can import ISB services and begin implementing the billing separator**.

**Acceptance Criteria:**

**Given** an empty project directory
**When** the project is initialized
**Then** CDK TypeScript app is created with `npx cdk init app --language typescript`
**And** ISB is added as git submodule at `deps/isb` pinned to v1.1.7
**And** `package.json` includes `"@amzn/innovation-sandbox-commons": "file:./deps/isb/source/common"`

**Given** the project is initialized
**When** `tsconfig.json` is configured
**Then** path mappings exist for `@amzn/innovation-sandbox-commons/*`
**And** strict mode is enabled
**And** ESM module settings are configured

**Given** the project is initialized
**When** standard npm scripts are configured
**Then** `npm run build`, `npm test`, `npm run lint`, `npm run deploy`, `npm run destroy` all exist
**And** `npm run validate` runs lint + test + build in sequence

**Given** project files are created
**When** `.gitignore` is configured
**Then** `node_modules/`, `cdk.out/`, `cdk.context.json`, and `*.js` (compiled) are ignored
**And** `deps/isb/` submodule is NOT ignored

---

### Story 1.3: Build Verification & CDK Stack Shell

As a **Developer**,
I want **to verify ISB imports work and have a deployable CDK stack shell**,
So that **I can confirm the project foundation is solid before implementing Lambda handlers**.

**Acceptance Criteria:**

**Given** the project is initialized with ISB submodule
**When** ISB commons are imported in a test file
**Then** `import { SandboxOuService } from "@amzn/innovation-sandbox-commons/isb-services/sandbox-ou-service.js"` compiles without errors
**And** `import { DynamoSandboxAccountStore } from "@amzn/innovation-sandbox-commons/data/sandbox-account/dynamo-sandbox-account-store.js"` compiles without errors
**And** `import { fromTemporaryIsbOrgManagementCredentials } from "@amzn/innovation-sandbox-commons/utils/cross-account-roles.js"` compiles without errors

**Given** the CDK stack shell is created
**When** `lib/billing-separator-stack.ts` is implemented
**Then** stack is named with pattern `isb-billing-separator-{env}`
**And** all resources use `isb-billing-sep-` prefix (FR25)
**And** environment is configurable via CDK context (FR26)

**Given** `cdk.context.example.json` is created
**When** developers review it
**Then** it contains placeholder values for `accountTableName`, `sandboxOuId`, `intermediateRoleArn`, `orgMgtRoleArn`, `snsAlertEmail`
**And** it is committed to git (real values in `cdk.context.json` are gitignored)

**Given** the project is complete
**When** `npm run validate` is executed
**Then** linting passes with no errors
**And** tests pass (CDK assertion test for stack structure)
**And** `cdk synth` generates valid CloudFormation template

---

## Epic 2: Account Lifecycle Automation

**Goal:** Implement the complete quarantine→release lifecycle including event pipeline, both Lambda handlers, and scheduler management.

**FRs covered:** FR1-16, FR27-29, FR31-36, FR38

---

### Story 2.1: Shared Lambda Utilities & Types

As a **Developer**,
I want **shared utilities, types, and constants for the Lambda handlers**,
So that **both handlers use consistent code and the event parsing is tested independently**.

**Acceptance Criteria:**

**Given** the project structure from Epic 1
**When** `source/lambdas/shared/constants.ts` is created
**Then** it exports `QUARANTINE_DURATION_HOURS = 72`
**And** it exports `SCHEDULER_GROUP = "isb-billing-separator"`
**And** it exports `SCHEDULER_NAME_PREFIX = "isb-billing-sep-unquarantine"`
**And** it exports environment variable keys as constants

**Given** the shared utilities are created
**When** `source/lambdas/shared/types.ts` is created
**Then** it exports `CloudTrailMoveAccountEvent` type matching the expected event structure
**And** it exports `SchedulerPayload` type for the unquarantine scheduler invocation
**And** it exports `QuarantineResult` and `UnquarantineResult` types for handler responses

**Given** the shared utilities are created
**When** `source/lambdas/shared/event-parser.ts` is created
**Then** it exports `parseCloudTrailEvent(event: SQSEvent)` function
**And** the function extracts `accountId`, `sourceParentId`, `destinationParentId` from the CloudTrail event payload
**And** the function uses Zod for runtime validation
**And** the function throws descriptive errors for malformed events

**Given** the event parser is implemented
**When** unit tests are run (`source/lambdas/shared/event-parser.test.ts`)
**Then** valid CloudTrail events are parsed correctly
**And** malformed events throw appropriate errors
**And** missing required fields throw appropriate errors

**Given** test fixtures are created
**When** `source/lambdas/__fixtures__/cloudtrail-move-account-event.json` exists
**Then** it contains a realistic CloudTrail MoveAccount event payload
**And** it can be used for handler unit tests

---

### Story 2.2: QuarantineLambda Handler Implementation

As an **ISB Platform Operator**,
I want **accounts moving from CleanUp to Available to be automatically intercepted and quarantined**,
So that **billing data has time to settle before the account is reused**.

**Acceptance Criteria:**

**Given** a CloudTrail MoveAccount event is received via SQS
**When** the destination is the Available OU
**Then** the QuarantineLambda parses the event using the shared event parser (FR15)

**Given** the event is parsed successfully
**When** the source OU is validated
**Then** a fresh lookup resolves the CleanUp OU ID via `orgsService.getIsbOu("CleanUp")` (FR2)
**And** if source is NOT CleanUp, the handler logs "Skipping non-cleanup move" and returns success (FR34)

**Given** the source OU is CleanUp
**When** the quarantine is executed
**Then** the account is moved from Available to Quarantine OU using `transactionalMoveAccount()` (FR3, FR4)
**And** the move and DynamoDB update happen atomically
**And** structured JSON logs record accountId, sourceOu, timestamp with action="QUARANTINE_START" (FR5)

**Given** the account is quarantined successfully
**When** the scheduler is created
**Then** an EventBridge Scheduler is created with 72-hour delay (FR10)
**And** the scheduler name follows pattern `isb-billing-sep-unquarantine-{accountId}-{timestamp}` (FR11)
**And** the scheduler is one-time with precise timing (no flexible window) (FR12)
**And** the scheduler is in group `isb-billing-separator`

**Given** any operation fails (OU move or scheduler creation)
**When** the error is caught
**Then** the handler throws an error (not swallows it) to trigger retry/DLQ (FR27, FR29)
**And** error details including stack trace are logged (FR30)

**Given** the handler is invoked multiple times for the same event
**When** the account is already in Quarantine status
**Then** the handler skips processing and returns success (idempotent) (FR16)
**And** logs indicate the skip with action="QUARANTINE_SKIP"

**Given** unit tests are run (`source/lambdas/quarantine.test.ts`)
**When** ISB services are mocked
**Then** happy path (CleanUp→Quarantine) is tested
**And** skip path (non-CleanUp source) is tested
**And** idempotent skip (already quarantined) is tested
**And** error handling (OU move failure) is tested
**And** error handling (scheduler creation failure after successful OU move) is tested

---

### Story 2.3: UnquarantineLambda Handler Implementation

As an **ISB Platform Operator**,
I want **quarantined accounts to be automatically released after 72 hours**,
So that **accounts return to the Available pool with clean billing attribution**.

**Acceptance Criteria:**

**Given** the EventBridge Scheduler fires after 72 hours
**When** the UnquarantineLambda is invoked
**Then** the handler parses the scheduler payload containing `accountId`

**Given** the payload is parsed
**When** the account status is validated
**Then** the handler reads the account from DynamoDB
**And** if status is NOT "Quarantine", the handler logs "Account not in expected state, skipping" and returns success (FR8)

**Given** the account status is "Quarantine"
**When** the release is executed
**Then** the account is moved from Quarantine to Available OU using `transactionalMoveAccount()` (FR6, FR7)
**And** the move and DynamoDB update happen atomically
**And** structured JSON logs record accountId, timestamp with action="UNQUARANTINE_START" (FR9)

**Given** the account is released successfully
**When** cleanup is performed
**Then** the EventBridge Scheduler that triggered this invocation is deleted (FR35)
**And** logs record action="UNQUARANTINE_COMPLETE"

**Given** any operation fails
**When** the error is caught
**Then** the handler throws an error to trigger retry
**And** error details including stack trace are logged

**Given** the handler is invoked multiple times
**When** the account is already in Available status
**Then** the handler skips processing and returns success (idempotent)
**And** the handler still attempts scheduler cleanup (idempotent delete)

**Given** unit tests are run (`source/lambdas/unquarantine.test.ts`)
**When** ISB services are mocked
**Then** happy path (Quarantine→Available) is tested
**And** skip path (not in Quarantine status) is tested
**And** error handling (OU move failure) is tested
**And** scheduler cleanup is tested

---

### Story 2.4: CDK Infrastructure - Event Pipeline & Lambda Configuration

As a **Developer**,
I want **the complete CDK infrastructure for the billing separator**,
So that **the Lambda handlers can be deployed and invoked by events**.

**Acceptance Criteria:**

**Given** the CDK stack from Epic 1
**When** the EventBridge rule is configured
**Then** it matches CloudTrail events with `source: aws.organizations`, `eventName: MoveAccount`, `destinationParentId: {Available OU ID}` (FR1, FR13)
**And** the rule has its own DLQ for delivery failures (FR38)

**Given** the EventBridge rule is configured
**When** the SQS queue is created
**Then** it buffers events between EventBridge and QuarantineLambda (FR14)
**And** it has a DLQ configured with 5 receive attempts before DLQ (FR27)
**And** failed events are preserved in DLQ for investigation (FR28)

**Given** Lambda functions are configured
**When** QuarantineLambda is created
**Then** runtime is Node.js 22.x, architecture is arm64, memory is 1024MB
**And** timeout is 30 seconds (NFR-P1)
**And** X-Ray tracing is enabled (NFR-O5)
**And** log format is JSON with 30-day retention
**And** environment variables include: `ACCOUNT_TABLE_NAME`, `SANDBOX_OU_ID`, `INTERMEDIATE_ROLE_ARN`, `ORG_MGT_ROLE_ARN`, `SCHEDULER_ROLE_ARN` (FR26, FR36)

**Given** Lambda functions are configured
**When** UnquarantineLambda is created
**Then** it has the same configuration as QuarantineLambda
**And** it additionally has `SCHEDULER_GROUP` environment variable

**Given** the Scheduler group is created
**When** `isb-billing-separator` group exists
**Then** QuarantineLambda has permission to create schedules in this group
**And** UnquarantineLambda has permission to delete schedules in this group
**And** a Scheduler execution role exists that can invoke UnquarantineLambda

**Given** IAM roles are configured
**When** Lambda execution roles are created
**Then** they follow least-privilege principle (NFR-S1)
**And** they can assume the intermediate role for cross-account access (FR31)
**And** they have DynamoDB read access for account table
**And** write access is limited to account status attribute only (NFR-S3)

**Given** CDK assertion tests exist
**When** `test/billing-separator-stack.test.ts` is run
**Then** EventBridge rule with correct pattern is verified
**And** SQS queue with DLQ is verified
**And** Both Lambda functions with correct config are verified
**And** IAM roles with appropriate permissions are verified
**And** Scheduler group exists

---

### Story 2.5: Integration Wiring & End-to-End Verification

As an **ISB Platform Operator**,
I want **the complete quarantine→release cycle working end-to-end**,
So that **I can verify billing isolation works before production deployment**.

**Acceptance Criteria:**

**Given** all infrastructure and handlers are deployed
**When** Lambda handlers are wired to infrastructure
**Then** QuarantineLambda is triggered by SQS queue
**And** UnquarantineLambda is triggered by EventBridge Scheduler
**And** cross-account role chain works (`fromTemporaryIsbOrgManagementCredentials()`) (FR33)

**Given** the cross-account access is configured
**When** QuarantineLambda assumes the role chain
**Then** it can call Organizations API `MoveAccount` (FR32)
**And** credentials are time-limited (STS tokens) (NFR-S2)

**Given** a test account completes ISB cleanup
**When** ISB moves it from CleanUp to Available OU
**Then** QuarantineLambda intercepts the move within 90 seconds
**And** the account lands in Quarantine OU (not Available)
**And** DynamoDB status shows "Quarantine"
**And** an EventBridge Scheduler exists with correct 72-hour target

**Given** the scheduler fires (can be manually triggered for testing)
**When** UnquarantineLambda executes
**Then** the account moves from Quarantine to Available OU
**And** DynamoDB status shows "Available"
**And** the scheduler is deleted after successful release

**Given** the end-to-end flow is verified
**When** CloudWatch Logs are reviewed
**Then** structured JSON logs show the complete flow with correlation
**And** X-Ray traces show cross-service visibility
**And** no errors appear in DLQs

**Given** error scenarios are tested
**When** a simulated failure occurs
**Then** events retry appropriately (up to 7 total attempts)
**And** failed events land in DLQ after exhausting retries
**And** DLQ contains the original event payload for investigation

---

## Epic 3: Operational Monitoring

**Goal:** Implement observability that enables operators to monitor, troubleshoot, and respond to issues.

**FRs covered:** FR17-21, FR30

---

### Story 3.1: SNS Alert Topic & Subscription

As an **ISB Platform Operator**,
I want **an SNS topic that receives all billing separator alerts**,
So that **I am notified when issues require my attention**.

**Acceptance Criteria:**

**Given** the CDK stack from Epic 2
**When** the SNS topic is created
**Then** it is named `isb-billing-separator-alerts`
**And** it follows the `isb-billing-sep-` resource prefix convention

**Given** the SNS topic exists
**When** a subscription is configured
**Then** email subscription is created using `snsAlertEmail` from CDK context (FR21)
**And** the email address is configurable per environment

**Given** the SNS topic exists
**When** IAM permissions are configured
**Then** CloudWatch Alarms can publish to the topic
**And** no other principals can publish (least privilege)

**Given** the SNS topic is deployed
**When** an alarm triggers
**Then** the operator receives an email notification
**And** the notification includes alarm name, description, and timestamp

---

### Story 3.2: CloudWatch Alarms - Failure Detection

As an **ISB Platform Operator**,
I want **to be alerted when event processing fails**,
So that **I can investigate and resolve issues before they impact billing isolation**.

**Acceptance Criteria:**

**Given** the SQS DLQ from Epic 2
**When** the DLQ alarm is created
**Then** it triggers when `ApproximateNumberOfMessagesVisible >= 3` (FR18)
**And** it evaluates over 5-minute periods
**And** it sends notification to SNS topic
**And** alarm description explains: "Event processing failures - investigate DLQ"

**Given** the Lambda functions from Epic 2
**When** Lambda error alarms are created
**Then** QuarantineLambda error alarm triggers when `Errors >= 3` in 5 minutes
**And** UnquarantineLambda error alarm triggers when `Errors >= 3` in 5 minutes
**And** both alarms send notifications to SNS topic
**And** alarm descriptions include the Lambda function name

**Given** structured logging is configured in handlers (Epic 2)
**When** errors occur
**Then** error details including stack trace are logged (FR30)
**And** logs include `action="HANDLER_ERROR"` for easy filtering
**And** logs include accountId for correlation

**Given** alarms are deployed
**When** CDK assertion tests run
**Then** DLQ alarm with correct threshold is verified
**And** Lambda error alarms for both functions are verified
**And** All alarms have SNS topic as action

---

### Story 3.3: CloudWatch Alarms - Operational Anomalies

As an **ISB Platform Operator**,
I want **to be alerted when accounts are stuck or the quarantine is bypassed**,
So that **I can identify silent failures and reconcile system state**.

**Acceptance Criteria:**

**Given** accounts can be stuck in Quarantine
**When** the stuck account alarm is created
**Then** it uses a custom CloudWatch metric `AccountsInQuarantineOverThreshold`
**And** the metric counts accounts in Quarantine status for >80 hours (FR17)
**And** the alarm triggers when metric value >= 1
**And** alarm description explains: "Account stuck in Quarantine >80 hours - scheduler may have failed"

**Given** the stuck account metric needs data
**When** metric publishing is implemented
**Then** a scheduled Lambda or CloudWatch metric filter publishes the metric
**And** the metric is published at least every 15 minutes
**And** the metric value is the count of accounts exceeding threshold

**Given** bypass detection is needed
**When** the bypass alarm is created
**Then** it detects accounts that moved CleanUp→Available without hitting Quarantine (FR19)
**And** it uses CloudWatch Logs metric filter on QuarantineLambda logs
**And** it looks for accounts in Available OU that were never quarantined
**And** the alarm triggers when bypass count >= 1 in 1 hour
**And** alarm description explains: "Quarantine bypassed - check event routing"

**Given** all operational alarms are deployed
**When** the operator reviews CloudWatch console
**Then** all alarms are visible with clear names (NFR-O4)
**And** alarm history shows state changes
**And** operators can acknowledge and track issues

**Given** CDK assertion tests run
**When** operational alarms are verified
**Then** stuck account alarm with correct metric is verified
**And** bypass detection alarm is verified
**And** metric filters or scheduled metrics are verified

---

## Epic 4: Production Deployment

**Goal:** Enable production operations including deployment, configuration management, and clean removal.

**FRs covered:** FR22-24, FR26 (remaining), FR37

---

### Story 4.1: GitHub Actions CI/CD Pipeline

As a **Developer**,
I want **a GitHub Actions pipeline that deploys the billing separator via OIDC**,
So that **deployments are automated, auditable, and don't require long-lived credentials**.

**Acceptance Criteria:**

**Given** the CDK stack from Epic 2
**When** `.github/workflows/deploy.yml` is created
**Then** it triggers on push to `main` branch
**And** it triggers on manual workflow dispatch with environment parameter

**Given** the workflow runs
**When** OIDC authentication is configured
**Then** the workflow assumes an IAM role via OIDC (FR23)
**And** no long-lived AWS credentials are stored in GitHub secrets
**And** the IAM role ARN is configurable per environment

**Given** the workflow authenticates successfully
**When** the deployment steps run
**Then** `npm ci` installs dependencies
**And** `npm run validate` passes (lint + test + build)
**And** `cdk deploy --require-approval never` deploys the stack
**And** deployment output shows stack ARN and resource names

**Given** the workflow completes
**When** deployment is successful
**Then** workflow exits with success status
**And** deployment summary is posted to workflow summary

**Given** validation or deployment fails
**When** the error is caught
**Then** workflow exits with failure status
**And** error logs are available in GitHub Actions console

**Given** a PR workflow is needed
**When** `.github/workflows/pr-check.yml` is created
**Then** it triggers on pull requests to `main`
**And** it runs `npm run validate` only (no deploy)
**And** it runs `cdk synth` to verify template generation

---

### Story 4.2: Environment Configuration & Clean Removal

As an **ISB Platform Operator**,
I want **clear environment configuration and verified clean removal**,
So that **I can deploy to different environments and remove the solution completely when no longer needed**.

**Acceptance Criteria:**

**Given** the CDK stack needs environment-specific configuration
**When** `cdk.context.example.json` is finalized
**Then** it documents all required configuration values (FR26)
**And** it includes: `environment`, `accountTableName`, `sandboxOuId`, `availableOuId`, `quarantineOuId`, `cleanupOuId`, `intermediateRoleArn`, `orgMgtRoleArn`, `snsAlertEmail`
**And** each value has a comment explaining its purpose

**Given** the CDK stack manages IAM trust policies
**When** the stack is deployed
**Then** IAM trust policy entries are created via CloudFormation (FR37)
**And** the Lambda execution roles can assume cross-account roles

**Given** the stack is deployed
**When** `cdk destroy` is executed (FR24)
**Then** all resources are deleted in correct order
**And** IAM trust policy entries are removed automatically
**And** EventBridge Schedulers in the group are deleted
**And** SQS queues and DLQs are deleted
**And** CloudWatch alarms are deleted
**And** SNS topic and subscriptions are deleted

**Given** the stack is destroyed
**When** the AWS Console is checked
**Then** no orphaned resources with `isb-billing-sep-` prefix remain
**And** accounts remain in their current OU positions (no automatic cleanup)
**And** ISB continues to function normally (NFR-I4)

**Given** manual account reconciliation is needed
**When** the operator follows the runbook
**Then** any accounts stuck in Quarantine OU can be manually moved to Available
**And** the runbook documents the AWS Console steps

---

### Story 4.3: Integration Test Procedure & Documentation

As an **ISB Platform Operator**,
I want **a documented integration test procedure and operational runbook**,
So that **I can verify the deployment works and troubleshoot issues in production**.

**Acceptance Criteria:**

**Given** the solution is deployed
**When** `INTEGRATION_TEST_PLAN.md` is created
**Then** it documents pre-requisites (ISB deployed, test account in CleanUp OU)
**And** it documents step-by-step test procedure
**And** it documents expected outcomes at each step
**And** it documents how to manually trigger scheduler for faster testing
**And** it documents verification queries (DynamoDB, CloudWatch Logs, Scheduler console)

**Given** the integration test is executed
**When** a test account completes cleanup
**Then** the test procedure verifies quarantine within 90 seconds
**And** the test procedure verifies scheduler creation
**And** the test procedure verifies (manual trigger) unquarantine
**And** the test procedure verifies scheduler deletion

**Given** operators need troubleshooting guidance
**When** `RUNBOOK.md` is created
**Then** it documents alarm response procedures
**And** it documents DLQ investigation steps
**And** it documents manual account reconciliation steps
**And** it documents common failure modes and resolutions
**And** it documents how to contact support if needed

**Given** the documentation is complete
**When** `README.md` is updated
**Then** it includes project overview and architecture diagram
**And** it includes deployment prerequisites
**And** it includes deployment steps
**And** it includes links to integration test plan and runbook
**And** it includes removal steps

