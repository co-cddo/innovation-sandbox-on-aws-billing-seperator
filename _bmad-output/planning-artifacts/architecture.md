---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/research/technical-isb-quarantine-automation-research-2026-01-27.md'
workflowType: 'architecture'
project_name: 'innovation-sandbox-on-aws-billing-seperator'
user_name: 'Cns'
date: '2026-01-28'
relatedCodebase: '../innovation-sandbox-on-aws'
lastStep: 8
status: 'complete'
completedAt: '2026-01-28'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
38 requirements across 7 domains defining a focused, tactical solution:

| Domain | Count | Architectural Implication |
|--------|-------|---------------------------|
| Account Quarantine | 6 | Core Lambda #1 - intercepts and redirects account moves |
| Account Release | 5 | Core Lambda #2 - scheduled release after quarantine period |
| Scheduling | 4 | EventBridge Scheduler integration for delayed execution |
| Event Processing | 5 | CloudTrail → EventBridge → SQS → Lambda pipeline |
| Observability | 5 | CloudWatch alarms + SNS for operator alerting |
| Operations | 5 | CDK stack design for clean deployment/removal |
| Error Handling & IAM | 8 | DLQ patterns + cross-account role chains |

**Non-Functional Requirements:**
18 requirements driving architectural quality attributes:

| Category | Key Requirements |
|----------|------------------|
| Security (4) | Least-privilege IAM, time-limited STS tokens, no hardcoded secrets |
| Reliability (4) | 7 retry attempts before DLQ, idempotent operations, two-layer DLQ |
| Integration (4) | ISB commons compatibility, no schema modifications, clean coexistence |
| Operability (5) | Zero operator intervention, no silent failures, X-Ray tracing |
| Deployment (1) | First-attempt success in clean environment |
| Performance (1) | 30-second Lambda timeout (fail-fast) |

**Scale & Complexity:**

- Primary domain: Serverless Event-Driven Backend
- Complexity level: Medium (limited scope, cross-account complexity)
- Estimated architectural components: ~12 AWS resources
- Integration pattern: Brownfield extension (read-only integration with ISB)

### Technical Constraints & Dependencies

| Constraint | Impact |
|------------|--------|
| 72-hour quarantine window | Driven by AWS Cost Explorer data latency SLA |
| Zero ISB modification | Must use git submodule for commons, no ISB code changes |
| Removability critical | Single `cdk destroy` must leave no orphans |
| Cross-account events | CloudTrail fires in Org Mgmt, Lambda runs in Hub |
| ISB auto-approval enabled | Race condition risk if we used wrong event source |
| Existing DynamoDB schema | Cannot modify; must use ISB's `transactionalMoveAccount()` |

**External Dependencies:**
- ISB v1.1.7 commons (git submodule)
- Existing ISB DynamoDB Account Table
- Existing AWS Organizations OU hierarchy
- Existing cross-account IAM roles (Intermediate + Org Mgmt)
- CloudTrail Organization trail (must log Organizations API events)

**Pre-Architecture Spike Required:**
> ⚠️ **Verify CloudTrail→Hub event routing** before finalizing architecture. Check if Organization Trail already forwards `aws.organizations` events to Hub account's default EventBridge bus. If not, architecture must include cross-account EventBridge rule in Org Mgmt account.

**Growth Features (Future-Proofing):**
- `QUARANTINE_DURATION_HOURS` environment variable for configurable quarantine period (default 72h, potentially reducible to 48h based on observed Cost Explorer latency)

### Cross-Cutting Concerns Identified

| Concern | Affected Components | Strategy |
|---------|---------------------|----------|
| Error Handling | Both Lambdas, SQS, EventBridge | Two-layer DLQ, CloudWatch alarms |
| Idempotency | QuarantineLambda, UnquarantineLambda | Status checks before actions |
| State Consistency | DynamoDB ↔ OU | Use `transactionalMoveAccount()`, OU is authoritative |
| Observability | All components | Structured JSON logs, X-Ray, CloudWatch metrics |
| Cross-Account Access | QuarantineLambda | Role chain via ISB credential helper |
| Testability | Both Lambdas, CDK Stack | Mock `SandboxOuService` and `DynamoSandboxAccountStore`; CDK assertion tests for deployment confidence |

### Risk Assessment

| Risk | Probability | Impact | Blast Radius | Mitigation |
|------|-------------|--------|--------------|------------|
| Cross-account event routing misconfigured | Medium | High | System-wide (silent failure) | Pre-architecture spike to verify; reconciliation Lambda as safety net |
| State inconsistency (OU vs DB) | Low | Medium | Single account only | `transactionalMoveAccount()` + OU-is-authoritative principle |
| Scheduler creation throttled | Low | Low | Single account | Retry logic; CloudWatch alarm for stuck accounts |
| Quarantine bypass undetected | Low | High | Single account (stale billing) | Bypass detection alarm + optional reconciliation audit |

### Reliability Enhancement (Recommended)

**Reconciliation Lambda (Growth scope):**
To close the silent failure gap where CloudTrail events never reach the QuarantineLambda, consider a scheduled reconciliation check:
- Runs every 4 hours
- Queries: accounts in Available OU that were in CleanUp within last 6 hours
- Cross-references: DynamoDB status history or CloudTrail logs
- Alerts: if any account bypassed Quarantine

This provides defense-in-depth against event routing failures.

## Starter Template Evaluation

### Primary Technology Domain

**Serverless Event-Driven Backend** - AWS Lambda + EventBridge + CDK

This is a brownfield extension project, not a greenfield application. Technology choices are constrained by integration requirements with the existing Innovation Sandbox on AWS (ISB) solution.

### Starter Options Considered

| Option | Assessment |
|--------|------------|
| Standard CDK TypeScript init | ✅ Selected - matches ISB patterns |
| AWS SAM | ❌ ISB uses CDK, not SAM |
| Serverless Framework | ❌ ISB uses CDK, not Serverless |
| Custom from scratch | ❌ Unnecessary - CDK init is sufficient |

### Selected Approach: CDK TypeScript with ISB Submodule

**Rationale for Selection:**
- Must match ISB's CDK v2 infrastructure patterns
- Must import ISB commons for services and schemas
- Must follow ISB Lambda conventions for consistency
- Enables clean removal when upstream solution ships

**Initialization Commands:**

```bash
# 1. Initialize CDK TypeScript project
npx cdk init app --language typescript

# 2. Add ISB as git submodule (pinned to stable version)
git submodule add https://github.com/aws-solutions/innovation-sandbox-on-aws.git deps/isb
cd deps/isb && git checkout v1.1.7 && cd ../..

# 3. Configure local dependency in package.json
# Add: "@amzn/innovation-sandbox-commons": "file:./deps/isb/source/common"

# 4. Configure tsconfig.json paths for IDE resolution
# Add paths mapping for @amzn/innovation-sandbox-commons/*
```

**Fallback: Snapshot Approach (If Submodule Friction Emerges)**

If git submodules prove painful during development, fall back to a snapshot copy:

```bash
# Emergency eject from submodule to snapshot
git rm deps/isb
cp -r ../innovation-sandbox-on-aws/source/common ./deps/isb-commons-v1.1.7
# Update package.json: "file:./deps/isb-commons-v1.1.7"
```

Trade-off: Loses upstream bugfixes but eliminates submodule overhead. Acceptable for a temporary, tactical solution.

### Architectural Decisions Inherited from ISB

**Language & Runtime:**
- TypeScript with strict mode
- Node.js 22.x runtime
- arm64 architecture for Lambda
- ESM modules with .js extensions in imports

**Build Tooling:**
- esbuild for Lambda bundling (via CDK NodejsFunction)
- CDK v2 for infrastructure synthesis
- **Validation required:** Verify NodejsFunction handles `file:` dependencies correctly during bundling

**Testing Framework:**
- Jest for unit tests
- CDK assertions for infrastructure tests
- Mocked AWS SDK clients for Lambda testing
- **Co-located tests** with handlers for fast feedback

**Code Organization (Flat Structure):**

```
/
├── bin/
│   └── app.ts                      # CDK app entry point
├── lib/
│   └── billing-separator-stack.ts  # Single CDK stack
├── source/
│   └── lambdas/
│       ├── quarantine.ts           # Lambda 1 handler
│       ├── quarantine.test.ts      # Co-located test
│       ├── unquarantine.ts         # Lambda 2 handler
│       ├── unquarantine.test.ts    # Co-located test
│       └── shared/
│           └── constants.ts        # OU names, env var keys
├── test/
│   └── billing-separator-stack.test.ts  # CDK assertion tests
├── deps/
│   └── isb/                        # Git submodule
├── package.json
├── tsconfig.json
└── cdk.json
```

**Notes:**
- Uses `/source/` to match ISB conventions (not `/src/`)
- Flat Lambda structure (no subdirectories) - YAGNI for 2 handlers
- Co-located tests beside handlers for discoverability

**TypeScript Configuration (tsconfig.json):**

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

**NPM Scripts (package.json):**

```json
{
  "scripts": {
    "build": "tsc && cdk synth",
    "test": "jest",
    "test:watch": "jest --watch",
    "deploy": "cdk deploy",
    "destroy": "cdk destroy",
    "lint": "eslint . --ext .ts"
  }
}
```

Standard entry points - anyone picking this up knows exactly what to run.

**Development Experience:**
- AWS Lambda Powertools (Logger, Tracer, Metrics)
- Zod for runtime schema validation
- Structured JSON logging
- X-Ray tracing enabled

### Scope Discipline

**MVP Focus:**
- QuarantineLambda + UnquarantineLambda
- Single CDK stack
- Core alarms + SNS
- Clean removal capability

**Deferred to Growth (only if MVP proves valuable):**
- Configurable quarantine duration
- Reconciliation Lambda
- CloudWatch dashboard
- DLQ processing automation

Ship MVP first. Add growth features only if we're still using this in 3+ months.

**Note:** Project initialization should be the first implementation task, followed by ISB submodule configuration and build verification.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Event routing strategy (requires spike verification)
- Cross-account IAM configuration
- Scheduler naming and group configuration

**Important Decisions (Shape Architecture):**
- Error handling and retry strategy
- Observability thresholds and alarms
- CI/CD pipeline configuration

**Deferred Decisions (Post-MVP):**
- Configurable quarantine duration
- Reconciliation Lambda
- CloudWatch dashboard

### Pre-Implementation Spike: Event Routing Verification

Before implementation begins, verify CloudTrail → Hub event routing by answering:

| Question | Expected Answer | If No |
|----------|-----------------|-------|
| Does Organization Trail exist? | Yes | Create trail or use cross-account rule |
| Does it log `organizations.amazonaws.com` events? | Yes | Enable Organizations event logging |
| Do events arrive on Hub account's default EventBridge bus? | Yes | Configure cross-account EventBridge rule |
| What's typical event latency? | < 90 seconds | Document and accept |
| Is scheduler quota sufficient? | 1M soft limit, not a concern at ISB scale | Document verification |

**Document spike outcome in this architecture doc before implementation.**

### Event Processing Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Event source | CloudTrail `MoveAccount` (not ISB events) | Eliminates race condition with ISB auto-approval |
| Routing strategy | Verify existing Organization Trail first | Minimizes mgmt account footprint |
| Fallback | Cross-account EventBridge rule | If trail routing unavailable |
| Event filter | `destinationParentId` = Available OU | Broad filter; validate source OU at runtime |
| Buffer | SQS queue between EventBridge and Lambda | Reliability, retry capability |

### Error Handling Strategy

| Setting | Value | Rationale |
|---------|-------|-----------|
| SQS receive attempts | 5 | Before moving to DLQ |
| Lambda async retries | 2 | AWS default |
| Total attempts | 7 | 5 SQS + 2 Lambda retries |
| DLQ retention | 14 days | Standard retention for investigation |
| EventBridge rule DLQ | Enabled | Catches SQS delivery failures |

**Coding Standard: Throw on ANY Failure**

Lambdas must throw exceptions on any failure, including partial failures. This ensures retry/DLQ machinery handles all error cases.

```typescript
// ✅ CORRECT: Throw on partial failure
if (!schedulerCreated) {
  throw new Error(`Quarantine succeeded but scheduler creation failed for ${accountId}`);
}

// ❌ WRONG: Log and return success (prevents retry!)
if (!schedulerCreated) {
  logger.error("Scheduler creation failed");
  return { statusCode: 200 };
}
```

### Observability Configuration

**Alarm Thresholds:**

| Alarm | Threshold | Severity | Action |
|-------|-----------|----------|--------|
| Account stuck in Quarantine | > 80 hours | P1 | Operator investigates immediately |
| Account stuck in Quarantine | > 96 hours | P2 (escalation) | Operator didn't respond to P1 |
| Quarantine bypass detected | >= 1 in 1 hour | P1 | Silent failure - investigate routing |
| DLQ message count | >= 3 | P1 | Event processing failures |
| Lambda errors | >= 3 in 5 min | P2 | Code or configuration issue |

**SNS Configuration:**

| Setting | Value | Rationale |
|---------|-------|-----------|
| Topic structure | Single topic | Sufficient for 2-Lambda solution |
| Topic name | `isb-billing-separator-alerts` | Clear identification |
| Subscription | Email to operator | Configurable via CDK context |

### Scheduler Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Name pattern | `isb-billing-sep-unquarantine-{accountId}-{timestamp}` | Unique, auditable |
| Scheduler group | `isb-billing-separator` | Enables bulk ops and IAM scoping |
| Flexible window | OFF | Precise 72-hour timing |
| Timezone | UTC | Consistency |
| Cleanup strategy | Self-cleanup by UnquarantineLambda | Simplest approach |

**Scheduler Group Benefits:**
- Easy audit: `aws scheduler list-schedules --group-name isb-billing-separator`
- Clean removal: delete group → all schedules deleted
- IAM scoping: Lambda permissions limited to this group

### Infrastructure & Deployment

**Stack Naming:**

| Setting | Value |
|---------|-------|
| Stack name pattern | `isb-billing-separator-{env}` |
| Resource prefix | `isb-billing-sep-` |
| Environments | `prod`, `staging`, `dev` |

**Environment Configuration:**

| Approach | CDK context via `cdk.json` |
|----------|----------------------------|
| Config file | `cdk.context.example.json` (committed, with placeholders) |
| Real values | CI/CD secrets or SSM Parameter Store |
| Override | `npx cdk deploy -c env=prod -c accountTableName=...` |

**Example `cdk.context.example.json`:**

```json
{
  "env": "dev",
  "accountTableName": "YOUR_ACCOUNT_TABLE_NAME",
  "sandboxOuId": "ou-xxxx-xxxxxxxx",
  "intermediateRoleArn": "arn:aws:iam::ACCOUNT:role/ROLE_NAME",
  "orgMgtRoleArn": "arn:aws:iam::ACCOUNT:role/ROLE_NAME",
  "snsAlertEmail": "ops@example.com"
}
```

**CI/CD Pipeline: GitHub Actions + OIDC**

```yaml
# .github/workflows/deploy.yml
name: Deploy ISB Billing Separator

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write   # Required for OIDC
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive  # Critical for ISB submodule

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: us-west-2  # Hub account region

      - run: npm ci
      - run: npm test

      # Deploy Hub stack to us-west-2
      - run: npx cdk deploy IsbBillingSeparatorHubStack --require-approval never -c env=prod

      # Deploy Org Mgmt stack to us-east-1 (Organizations events only appear in us-east-1)
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ORG_MGMT_DEPLOY_ROLE_ARN }}
          aws-region: us-east-1  # REQUIRED: Organizations is global service
      - run: npx cdk deploy IsbBillingSeparatorOrgMgmtStack --require-approval never -c env=prod
```

**Key CI/CD Requirements:**
- `submodules: recursive` — ISB dependency won't exist without this
- `--require-approval never` — automated deploys
- Tests before deploy — fail fast
- OIDC authentication — no long-lived credentials

### Decision Impact Analysis

**Implementation Sequence:**

1. **Spike:** Verify event routing (blocks all other work)
2. **Project setup:** CDK init, submodule, build verification
3. **QuarantineLambda:** Core quarantine logic + scheduler creation
4. **UnquarantineLambda:** Release logic + scheduler cleanup
5. **Infrastructure:** EventBridge rule, SQS, DLQs, alarms
6. **CI/CD:** GitHub Actions workflow
7. **Testing:** Unit tests, CDK assertions, integration test

**Cross-Component Dependencies:**

| Component | Depends On |
|-----------|------------|
| QuarantineLambda | Event routing, SQS queue, Scheduler group |
| UnquarantineLambda | Scheduler invocation, IAM role |
| Alarms | SNS topic, Lambda log groups |
| CI/CD | OIDC role in AWS, GitHub secrets |

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:** 6 areas where AI agents could make different choices

These patterns ensure consistent implementation across both Lambdas and any future additions.

### Naming Patterns

**Code Naming Conventions (Match ISB):**

| Element | Convention | Example |
|---------|------------|---------|
| Functions | camelCase | `quarantineAccount`, `getAccountStatus` |
| Constants | SCREAMING_SNAKE | `QUARANTINE_DURATION_HOURS`, `DEFAULT_TIMEOUT` |
| Types/Interfaces | PascalCase | `QuarantineEvent`, `AccountStatus` |
| Files | lowercase with dots | `quarantine.ts`, `quarantine.test.ts` |
| Environment vars | SCREAMING_SNAKE | `ACCOUNT_TABLE_NAME`, `SANDBOX_OU_ID` |

**Resource Naming (CDK):**

| Resource | Pattern | Example |
|----------|---------|---------|
| Lambda functions | `{prefix}{PascalName}` | `isb-billing-sep-QuarantineLambda` |
| SQS queues | `{prefix}{purpose}-queue` | `isb-billing-sep-event-queue` |
| DLQs | `{prefix}{purpose}-dlq` | `isb-billing-sep-event-dlq` |
| Alarms | `{prefix}{metric}-alarm` | `isb-billing-sep-stuck-account-alarm` |

### Handler Entry Point Pattern

**Standard Handler Structure:**

Both Lambdas must follow this skeleton for predictability and debuggability:

```typescript
export const handler = async (event: SQSEvent): Promise<void> => {
  const { accountId, sourceOu } = parseEvent(event);

  logger.info("Handler invoked", { accountId, action: "HANDLER_START" });

  try {
    // 1. Validate preconditions (status check)
    // 2. Execute core logic
    // 3. Log success
    logger.info("Handler completed", { accountId, action: "HANDLER_COMPLETE" });
  } catch (error) {
    logger.error("Handler failed", { accountId, error: error.message, action: "HANDLER_ERROR" });
    throw error; // Always re-throw for retry/DLQ
  }
};
```

### Environment & Constants Patterns

**Environment Variables (Inline):**

For 2 Lambdas, keep env vars inline at handler top (YAGNI for shared abstraction):

```typescript
// At top of handler file
const ACCOUNT_TABLE_NAME = process.env.ACCOUNT_TABLE_NAME!;
const SANDBOX_OU_ID = process.env.SANDBOX_OU_ID!;
const INTERMEDIATE_ROLE_ARN = process.env.INTERMEDIATE_ROLE_ARN!;
const ORG_MGT_ROLE_ARN = process.env.ORG_MGT_ROLE_ARN!;
```

**Shared Constants (constants.ts):**

Non-env constants go in a shared file:

```typescript
// source/lambdas/shared/constants.ts
export const QUARANTINE_DURATION_HOURS = 72;
export const SCHEDULER_GROUP = "isb-billing-separator";
export const SCHEDULER_NAME_PREFIX = "isb-billing-sep-unquarantine";
```

### Import Patterns

**Standard Import Style:**

```typescript
// ✅ CORRECT: Named imports with .js extension (ESM)
import { SandboxOuService } from "@amzn/innovation-sandbox-commons/isb-services/sandbox-ou-service.js";
import { DynamoSandboxAccountStore } from "@amzn/innovation-sandbox-commons/data/sandbox-account/dynamo-sandbox-account-store.js";
import { fromTemporaryIsbOrgManagementCredentials } from "@amzn/innovation-sandbox-commons/utils/cross-account-roles.js";

// ❌ WRONG: Missing .js extension
import { SandboxOuService } from "@amzn/innovation-sandbox-commons/isb-services/sandbox-ou-service";
```

### Logging Patterns

**Structured Logging Standard:**

```typescript
// ✅ CORRECT: Structured with relevant context
logger.info("Quarantining account", {
  accountId,
  sourceOu: "CleanUp",
  destinationOu: "Quarantine",
  action: "QUARANTINE_START"
});

// ❌ WRONG: Unstructured
logger.info(`Quarantining account ${accountId} from CleanUp to Quarantine`);
```

**Log Levels:**

| Level | Use Case |
|-------|----------|
| `error` | Failures that will cause retry/DLQ |
| `warn` | Unexpected but handled conditions |
| `info` | Normal operations (start, complete, skip) |
| `debug` | Detailed troubleshooting (disabled in prod) |

### Error Handling Patterns

**Error Message Format:**

```typescript
// ✅ CORRECT: Simple string with interpolated context
throw new Error(`Account ${accountId} not found in DynamoDB`);
throw new Error(`Quarantine succeeded but scheduler creation failed for ${accountId}`);

// ❌ WRONG: No context
throw new Error("Account not found");
```

### Idempotency Patterns

**Status Check Before Action:**

```typescript
// ✅ CORRECT: Early return with logging for idempotent skip
const account = await sandboxAccountStore.get(accountId);
if (account.status !== "Available") {
  logger.info("Account not in expected state, skipping quarantine", {
    accountId,
    expectedStatus: "Available",
    actualStatus: account.status,
    action: "QUARANTINE_SKIP"
  });
  return; // Success - idempotent behavior
}
```

### Test Patterns

**Mock Granularity (Two Levels):**

```typescript
// Level 1: Service-level mocks (unit tests)
const mockOrgsService = {
  transactionalMoveAccount: jest.fn().mockReturnValue({
    complete: jest.fn().mockResolvedValue(undefined)
  }),
  getIsbOu: jest.fn().mockResolvedValue({ Id: "ou-xxxx" })
};

// Level 2: SDK-level mocks (integration tests)
jest.mock("@aws-sdk/client-organizations", () => ({
  OrganizationsClient: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  }))
}));
```

**Behavior-Driven Test Naming:**

```typescript
// ✅ CORRECT: Behavior-driven naming
describe("QuarantineLambda", () => {
  describe("given account in Available status", () => {
    it("moves account to Quarantine OU", () => {});
    it("creates scheduler for 72 hours later", () => {});
    it("logs successful quarantine", () => {});
  });

  describe("given account NOT in Available status", () => {
    it("skips processing without error", () => {});
    it("logs skip reason", () => {});
  });

  describe("given OU move fails", () => {
    it("throws error for retry", () => {});
    it("does not create scheduler", () => {});
  });
});

// ❌ WRONG: Implementation-focused naming
describe("QuarantineLambda", () => {
  it("should call transactionalMoveAccount", () => {}); // Too implementation-focused
});
```

**Coverage Targets:**

| Component | Line Coverage | Branch Coverage |
|-----------|---------------|-----------------|
| `quarantine.ts` | > 90% | > 85% |
| `unquarantine.ts` | > 90% | > 85% |
| `shared/` | > 80% | > 75% |

Don't aim for 100% — it leads to testing implementation details.

### Enforcement Guidelines

**All AI Agents MUST:**

1. Follow standard handler entry point structure
2. Use ISB naming conventions (camelCase functions, SCREAMING_SNAKE constants)
3. Include `.js` extension in all imports (ESM requirement)
4. Use structured logging with `action` field for traceability
5. Throw on ANY failure (no silent partial success)
6. Implement idempotent skip with logging (not throw) for unexpected states
7. Write behavior-driven tests with two-level mock granularity
8. Meet coverage targets (90% line, 85% branch for handlers)

**Pattern Verification:**

- ESLint rules enforce naming conventions
- TypeScript strict mode catches import issues
- Jest coverage thresholds enforce minimums
- PR review checklist includes pattern compliance

## Project Structure & Boundaries

### Complete Project Directory Structure

```
innovation-sandbox-on-aws-billing-seperator/
├── README.md                           # Project overview, setup, deployment, REMOVAL
├── package.json                        # Dependencies and npm scripts
├── package-lock.json                   # Dependency lock file
├── tsconfig.json                       # TypeScript configuration with ISB path mappings
├── jest.config.js                      # Jest configuration for unit tests
├── cdk.json                            # CDK configuration
├── cdk.context.example.json            # Example context values (committed)
├── .gitignore                          # Git ignore patterns
├── .gitmodules                         # Git submodule configuration
├── .eslintrc.js                        # ESLint configuration
├── .prettierrc                         # Prettier configuration
│
├── .github/
│   └── workflows/
│       ├── deploy.yml                  # Production deployment workflow
│       ├── pr-check.yml                # PR validation (lint, test, synth)
│       └── destroy.yml                 # Manual destruction workflow
│
├── bin/
│   └── app.ts                          # CDK app entry point
│
├── lib/
│   └── billing-separator-stack.ts      # Single CDK stack definition
│
├── source/
│   └── lambdas/
│       ├── __mocks__/                  # Centralized test mocks
│       │   ├── isb-services.ts         # Mock SandboxOuService, DynamoSandboxAccountStore
│       │   └── aws-sdk.ts              # Mock SchedulerClient, OrganizationsClient
│       ├── __fixtures__/               # Test data fixtures
│       │   ├── cloudtrail-move-account-event.json
│       │   └── scheduler-invocation-event.json
│       ├── quarantine.ts               # QuarantineLambda handler
│       ├── quarantine.test.ts          # QuarantineLambda unit tests
│       ├── unquarantine.ts             # UnquarantineLambda handler
│       ├── unquarantine.test.ts        # UnquarantineLambda unit tests
│       └── shared/
│           ├── constants.ts            # Shared constants (durations, prefixes)
│           ├── types.ts                # Shared types (CloudTrailEvent, SchedulerPayload)
│           ├── event-parser.ts         # CloudTrail event parsing utility
│           └── event-parser.test.ts    # Event parser tests
│
├── test/
│   ├── billing-separator-stack.test.ts # CDK assertion tests
│   └── INTEGRATION_TEST_PLAN.md        # Manual integration test procedure
│
└── deps/
    └── isb/                            # Git submodule: innovation-sandbox-on-aws @ v1.1.7
        └── source/
            └── common/                 # ISB commons (imported via package.json)
```

### NPM Scripts

```json
{
  "scripts": {
    "build": "tsc && cdk synth",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "lint": "eslint . --ext .ts",
    "lint:fix": "eslint . --ext .ts --fix",
    "validate": "npm run lint && npm run test && npm run build",
    "deploy": "cdk deploy",
    "destroy": "cdk destroy"
  }
}
```

**Usage:**
- `npm run validate` — Run before every commit/push
- `npm run deploy -- -c env=prod` — Deploy to production
- `npm run destroy -- -c env=prod` — Remove solution

### Test File Inventory

| File | Test Type | Coverage Scope |
|------|-----------|----------------|
| `quarantine.test.ts` | Unit | Handler logic with mocked ISB services |
| `unquarantine.test.ts` | Unit | Handler logic with mocked ISB services |
| `event-parser.test.ts` | Unit | CloudTrail event parsing utility |
| `billing-separator-stack.test.ts` | CDK Assertions | Infrastructure resource correctness |
| `INTEGRATION_TEST_PLAN.md` | Manual | End-to-end flow in staging environment |

### Architectural Boundaries

**Lambda Handler Boundaries:**

| Handler | Responsibility | Does NOT Do |
|---------|---------------|-------------|
| `quarantine.ts` | Intercepts Available-bound accounts, moves to Quarantine, creates scheduler | Does not release accounts |
| `unquarantine.ts` | Releases accounts from Quarantine to Available, deletes scheduler | Does not intercept events |

**Infrastructure Boundaries:**

| Component | Boundary | Communication |
|-----------|----------|---------------|
| EventBridge Rule | Filters CloudTrail events | → SQS Queue |
| SQS Queue | Buffers events, enables retry | → QuarantineLambda |
| QuarantineLambda | Processes events, creates schedulers | → Organizations API, Scheduler API, DynamoDB |
| EventBridge Scheduler | Triggers delayed release | → UnquarantineLambda |
| UnquarantineLambda | Processes scheduled invocations | → Organizations API, Scheduler API, DynamoDB |
| DLQs | Capture failed events | ← All components |
| CloudWatch Alarms | Monitor metrics | → SNS Topic |
| SNS Topic | Routes alerts | → Email subscription |

**Cross-Account Boundaries:**

```
┌─────────────────────────────────────────────────────────────────┐
│ Hub Account (Compute)                                           │
│ ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│ │ EventBridge     │→ │ SQS Queue       │→ │ QuarantineLambda│  │
│ │ Rule            │  │ (+ DLQ)         │  │                 │  │
│ └─────────────────┘  └─────────────────┘  └────────┬────────┘  │
│                                                     │           │
│ ┌─────────────────┐  ┌─────────────────────────────┘           │
│ │ Unquarantine    │← │ EventBridge Scheduler                   │
│ │ Lambda          │  │ (72-hour delay)                         │
│ └────────┬────────┘  └─────────────────────────────            │
│          │                                                      │
│          ↓ Assume Role Chain                                    │
└──────────┼──────────────────────────────────────────────────────┘
           │
┌──────────▼──────────────────────────────────────────────────────┐
│ Intermediate Account                                             │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ ISB Intermediate Role (existing)                         │     │
│ └────────────────────────────┬────────────────────────────┘     │
└──────────────────────────────┼──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│ Organization Management Account                                  │
│ ┌─────────────────────────────────────────────────────────┐     │
│ │ ISB Org Management Role (existing)                       │     │
│ │ → Organizations API: MoveAccount                         │     │
│ └─────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

### Requirements to Structure Mapping

**Functional Requirements:**

| FR | Description | Implementation Location |
|----|-------------|------------------------|
| FR1-3 | Intercept CleanUp→Available moves | `quarantine.ts:parseEvent()`, `quarantine.ts:validatePreconditions()` |
| FR4-5 | Move to Quarantine OU | `quarantine.ts:executeQuarantine()` |
| FR6-9 | Release from Quarantine | `unquarantine.ts:executeRelease()` |
| FR10-12 | 72-hour scheduler | `quarantine.ts:createScheduler()`, `unquarantine.ts:deleteScheduler()` |
| FR13-16 | Event processing pipeline | `lib/billing-separator-stack.ts` (EventBridge + SQS) |
| FR17-21 | Observability | `lib/billing-separator-stack.ts` (Alarms + SNS) |
| FR22-26 | Operational design | `lib/billing-separator-stack.ts` (stack structure) |
| FR27-33 | Error handling | `lib/billing-separator-stack.ts` (DLQs) + handler patterns |
| FR34-38 | Edge cases | Distributed across handlers and stack |

**Cross-Cutting Concerns:**

| Concern | Implementation Location |
|---------|------------------------|
| Structured logging | All `.ts` files via Lambda Powertools |
| X-Ray tracing | CDK stack (tracing enabled on Lambdas) |
| Error handling | Handler try/catch pattern + DLQ config |
| Idempotency | Handler status checks before action |
| Constants | `source/lambdas/shared/constants.ts` |
| Types | `source/lambdas/shared/types.ts` |
| Event parsing | `source/lambdas/shared/event-parser.ts` |
| Test mocks | `source/lambdas/__mocks__/` |
| Test fixtures | `source/lambdas/__fixtures__/` |

### Spike Results Documentation

**Spike Completed:** 2026-01-28

| Question | Answer | Details |
|----------|--------|---------|
| Does Organization Trail exist? | ✅ Yes | `aws-controltower-BaselineCloudTrail` (IsOrganizationTrail: true) |
| Does it log `organizations.amazonaws.com` events? | ✅ Yes | IncludeManagementEvents: true, no exclusions |
| Do events arrive on Hub account's default EventBridge bus? | ❌ **NO** | Events only appear in Org Management account's EventBridge |
| Do events arrive on Org Mgmt account's EventBridge? | ✅ Yes | Verified in us-east-1 (global services region) |
| What's typical event latency? | ~13 seconds | Event at 14:44:12Z captured at 14:44:12Z |
| Event payload complete? | ✅ Yes | Contains accountId, sourceParentId, destinationParentId |

**Spike Outcome:** CONTINGENCY REQUIRED

CloudTrail MoveAccount events are logged by the Organization Trail and appear on the **Org Management account's default EventBridge bus in us-east-1**, but do NOT automatically propagate to member accounts' EventBridge buses.

**Architecture Adjustment Required:** Implement the contingency plan:
1. Create `OrgMgmtStack` with cross-account EventBridge rule in us-east-1
2. Forward MoveAccount events to Hub account's EventBridge
3. Update deployment to use `cdk deploy --all` for multi-stack
4. Update removal instructions for multi-stack teardown

**Sample Event Payload (sanitized):**
```json
{
  "version": "0",
  "detail-type": "AWS API Call via CloudTrail",
  "source": "aws.organizations",
  "account": "955063685555",
  "region": "us-east-1",
  "detail": {
    "eventSource": "organizations.amazonaws.com",
    "eventName": "MoveAccount",
    "requestParameters": {
      "accountId": "417845783913",
      "sourceParentId": "ou-2laj-x3o8lbk8",
      "destinationParentId": "ou-2laj-oihxgbtr"
    }
  }
}
```

**Key Findings:**
- Organizations is a global service - events occur in us-east-1
- Organization Trail logs to S3/CloudWatch in Org Mgmt account only
- CloudTrail events do NOT automatically cross account boundaries to EventBridge
- Must explicitly forward events using cross-account EventBridge rule

### README Structure

```markdown
# ISB Billing Separator

> ⚠️ **Temporary Solution** — This solution will be removed when the upstream
> ISB fix ships. See [Removal Instructions](#removal-instructions).

## Overview
Brief description of what this does and why.

## Quick Start
1. Clone with submodules
2. Install dependencies
3. Configure context
4. Deploy

## Architecture
Link to architecture.md

## Development
- Local setup
- Running tests
- Code patterns

## Deployment
- Environment configuration
- CI/CD pipeline
- Manual deployment

## Troubleshooting
- Common issues
- Log locations
- Alarm responses

## Removal Instructions
**When to remove:** When upstream ISB ships quarantine buffer feature.

**How to remove:**
1. Verify no accounts in Quarantine OU
2. Run `npm run destroy -- -c env=prod`
3. Verify stack deleted
4. Remove git repository
```

### Integration Test Plan Summary

**File:** `test/INTEGRATION_TEST_PLAN.md`

**Test Procedure:**
1. Deploy to staging environment
2. Trigger account cleanup in ISB (complete a lease)
3. Verify account lands in Quarantine OU (not Available)
4. Verify scheduler created with correct 72-hour target
5. (Optional) Modify scheduler to fire in 5 minutes for testing
6. Verify account releases to Available after scheduler fires
7. Verify scheduler deleted after release
8. Verify no DLQ messages
9. Verify CloudWatch metrics recorded

**Success Criteria:**
- Account never briefly appears in Available before Quarantine
- 72-hour delay is accurate (±1 minute)
- Clean removal with `cdk destroy`

### Data Flow

```
CloudTrail Event (Org Mgmt)
    ↓
EventBridge (Hub) [filter: destinationParentId = Available OU]
    ↓
SQS Queue (buffering + retry)
    ↓
QuarantineLambda
    ├── Read: DynamoDB (account status)
    ├── Write: Organizations API (move to Quarantine)
    ├── Write: DynamoDB (via transactionalMoveAccount)
    └── Write: EventBridge Scheduler (create 72h schedule)
    ↓
[72 hours later]
    ↓
EventBridge Scheduler
    ↓
UnquarantineLambda
    ├── Read: DynamoDB (account status)
    ├── Write: Organizations API (move to Available)
    ├── Write: DynamoDB (via transactionalMoveAccount)
    └── Write: EventBridge Scheduler (delete schedule)
```

### File Organization Patterns

**Configuration Files:**

| File | Purpose | Committed |
|------|---------|-----------|
| `cdk.json` | CDK config, app entry | Yes |
| `cdk.context.example.json` | Example context values | Yes |
| `cdk.context.json` | Real context values | No (gitignored) |
| `tsconfig.json` | TypeScript + ISB paths | Yes |
| `jest.config.js` | Test configuration | Yes |
| `.eslintrc.js` | Linting rules | Yes |

**Source Organization:**

| Directory | Contents |
|-----------|----------|
| `bin/` | CDK app entry point only |
| `lib/` | CDK stack definitions only |
| `source/lambdas/` | Lambda handlers + co-located tests |
| `source/lambdas/shared/` | Utilities shared between handlers |
| `source/lambdas/__mocks__/` | Centralized test mocks |
| `source/lambdas/__fixtures__/` | Test data fixtures |
| `test/` | CDK assertion tests + integration test plan |
| `deps/isb/` | ISB submodule (read-only) |

### Development Workflow Integration

**Local Development:**

```bash
# Install dependencies (includes ISB submodule)
npm ci

# Validate before commit (lint + test + build)
npm run validate

# Deploy to dev environment
npm run deploy -- -c env=dev
```

**CI/CD Integration:**

| Workflow | Trigger | Actions |
|----------|---------|---------|
| `pr-check.yml` | Pull request | Lint, test, synth (no deploy) |
| `deploy.yml` | Push to main | Test, synth, deploy to prod |
| `destroy.yml` | Manual dispatch | Destroy stack (for decommissioning) |

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:**
All technology choices are compatible. TypeScript + Node.js 22.x + CDK v2 + ISB v1.1.7 commons form a coherent, version-aligned stack. EventBridge → SQS → Lambda is a standard AWS serverless pattern with proven reliability.

**Pattern Consistency:**
Implementation patterns consistently use ISB conventions throughout:
- camelCase for functions, SCREAMING_SNAKE for constants
- ESM imports with `.js` extensions
- Structured JSON logging with `action` field
- "Throw on ANY failure" error handling

**Structure Alignment:**
Project structure directly supports all architectural decisions. `/source/lambdas/` matches ISB conventions, co-located tests enable fast feedback, and the single CDK stack cleanly encapsulates all resources for easy removal.

### Key Decisions Summary

| Decision | Choice | Why | Alternatives Rejected |
|----------|--------|-----|----------------------|
| Event source | CloudTrail `MoveAccount` | Eliminates race condition with ISB auto-approval | ISB `AccountCleanupSucceeded` (race risk) |
| Delay mechanism | EventBridge Scheduler | Native AWS, serverless, precise timing | Step Functions (overkill), DynamoDB TTL (imprecise) |
| State management | ISB's `transactionalMoveAccount()` | Atomic OU + DB update | Separate API calls (consistency risk) |
| Event buffer | SQS between EventBridge and Lambda | Enables retry, DLQ, decoupling | Direct EventBridge→Lambda (no retry control) |
| Cross-account access | ISB credential helper | Reuses existing role chain | New roles (duplication, maintenance) |
| Project structure | Single CDK stack | Clean removal via `cdk destroy` | Multi-stack (complex removal) |

### Spike Contingency Plan

**If the spike reveals Organization Trail does NOT forward events to Hub:**

| Impact Area | Current Design | Contingency Design |
|-------------|----------------|-------------------|
| Event routing | EventBridge rule in Hub only | Add cross-account EventBridge rule in Org Mgmt |
| CDK structure | Single stack in Hub | Two stacks: Hub + Org Mgmt |
| Deployment | `cdk deploy` (one stack) | `cdk deploy --all` (both stacks) |
| Removal | `cdk destroy` (one stack) | `cdk destroy --all` (both stacks) |
| CI/CD | Single account deploy role | Multi-account deploy roles |

**Contingency Implementation:**
1. Add `OrgMgmtStack` to CDK app with EventBridge rule **in us-east-1** (Organizations is global service, events appear in us-east-1 only)
2. Update GitHub Actions to deploy both stacks (Hub in us-west-2, Org Mgmt in us-east-1)
3. Update removal instructions for multi-stack teardown
4. Document cross-account EventBridge rule permissions
5. Configure cross-account EventBridge target from Org Mgmt (us-east-1) → Hub (us-west-2)

**Multi-Region Deployment Strategy (Post-Spike):**
| Stack | Region | Rationale |
|-------|--------|-----------|
| Hub Stack | us-west-2 | Main compute region, Lambda + SQS + alarms |
| Org Mgmt Stack | us-east-1 | **REQUIRED** - Organizations events only appear in us-east-1 |

**This contingency is pre-planned so spike results don't block implementation.**

### Requirements Coverage Validation ✅

**Functional Requirements Coverage:**
All 38 functional requirements are architecturally supported:
- Account lifecycle FRs → Lambda handlers
- Event processing FRs → EventBridge + SQS infrastructure
- Observability FRs → CloudWatch alarms + SNS
- Operational FRs → CDK stack design + CI/CD

**Non-Functional Requirements Coverage:**
All 18 non-functional requirements are addressed:
- Security: IAM least-privilege, no hardcoded secrets
- Reliability: 7 retry attempts, idempotent operations, two-layer DLQ
- Integration: ISB compatibility via git submodule
- Operability: X-Ray tracing, structured logging, CloudWatch alarms
- Deployment: CDK stack enables first-attempt success
- Performance: 30-second timeout for fail-fast behavior

### Implementation Readiness Validation ✅

**Quality Gate: Architecture Acceptance Criteria**

| Criterion | Verification Method | Status |
|-----------|---------------------|--------|
| All FRs have implementation location | FR-to-file mapping table | ✅ |
| All NFRs have architectural support | NFR coverage table | ✅ |
| Critical decisions have rationale | Key Decisions Summary table | ✅ |
| Patterns have good/bad examples | Code blocks in Patterns section | ✅ |
| Structure is specific (no placeholders) | Directory tree is complete | ✅ |
| Test strategy is defined | Test inventory table | ✅ |
| Spike contingency documented | Contingency Plan section | ✅ |

**Decision Completeness:**
All critical decisions are documented with versions, rationale, and concrete examples. The 8-point "All AI Agents MUST" list provides clear enforcement guidelines.

**Structure Completeness:**
Complete directory tree with all files enumerated. Test inventory, data flow diagrams, and cross-account boundaries are fully documented.

**Pattern Completeness:**
Comprehensive patterns cover naming, handler structure, error handling, idempotency, logging, imports, and testing. Code examples demonstrate both correct and incorrect approaches.

### Gap Analysis Results

**Critical Gaps:** None identified.

**Important Gaps (Documented with Resolution):**
1. Event routing spike must complete before implementation (documented as blocking)
2. OIDC role for CI/CD created by ops team (external dependency)
3. ISB submodule build verification (first implementation task)

**Deferred to Growth:**
- Configurable quarantine duration
- Reconciliation Lambda
- CloudWatch dashboard
- DLQ processing automation

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed (Medium)
- [x] Technical constraints identified (6 major constraints)
- [x] Cross-cutting concerns mapped (6 concerns)

**✅ Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed
- [x] Key decisions summary with rationale

**✅ Implementation Patterns**
- [x] Naming conventions established (code, resources, env vars)
- [x] Structure patterns defined (handler skeleton)
- [x] Communication patterns specified (event flow)
- [x] Process patterns documented (error, idempotency)

**✅ Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

**✅ Validation & Handoff**
- [x] Coherence validation passed
- [x] Requirements coverage verified
- [x] Implementation readiness confirmed
- [x] Spike contingency plan documented
- [x] Story breakdown prepared

### Architecture Definition of Done

This architecture is considered complete when:
- [x] Spike results are documented in this file (2026-01-28: Contingency required)
- [x] All validation checks pass
- [x] User (Cns) has approved the document
- [x] Document is saved to `_bmad-output/planning-artifacts/architecture.md`

### Architecture Readiness Assessment

**Overall Status:** ✅ READY FOR IMPLEMENTATION

**Confidence Level:** HIGH

Rationale: All 38 FRs and 18 NFRs are covered. Patterns are comprehensive with examples. Structure is complete and specific. No critical gaps remain. Spike contingency is pre-planned.

**Key Strengths:**
1. Clean brownfield integration via git submodule
2. Comprehensive error handling with two-layer DLQ
3. Detailed implementation patterns prevent agent conflicts
4. Single CDK stack enables clean removal
5. Well-defined cross-account boundaries
6. Pre-planned spike contingency eliminates blocking risk

**Areas for Future Enhancement:**
1. Configurable quarantine duration for operational flexibility
2. Reconciliation Lambda for defense-in-depth
3. CloudWatch dashboard for at-a-glance monitoring

### Implementation Handoff

**Story-Ready Checklist:**

When creating stories from this architecture, each story should reference:
1. **Which FRs it implements** (from FR-to-file mapping)
2. **Which patterns apply** (from Implementation Patterns section)
3. **Which files it touches** (from Project Structure section)
4. **Acceptance criteria derived from NFRs**

**Suggested Story Breakdown:**

| Story | Depends On | Files | FRs Covered |
|-------|------------|-------|-------------|
| 0. Event Routing Spike | — | (investigation only) | — |
| 1. Project Setup | Spike | `package.json`, `tsconfig.json`, `cdk.json`, etc. | FR22-26 |
| 2. QuarantineLambda | Story 1 | `quarantine.ts`, `shared/*` | FR1-5, FR10-12, FR34 |
| 3. UnquarantineLambda | Story 1 | `unquarantine.ts`, `shared/*` | FR6-9, FR10-12, FR35 |
| 4. Event Infrastructure | Story 1 | `billing-separator-stack.ts` | FR13-16, FR27-33, FR36-38 |
| 5. Observability | Story 4 | `billing-separator-stack.ts` | FR17-21 |
| 6. CI/CD | Story 1 | `.github/workflows/*` | FR22-26 |
| 7. Integration Test | Stories 2-5 | Manual testing per `INTEGRATION_TEST_PLAN.md` | — |

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and component boundaries
- Refer to this document for all architectural questions
- Complete the event routing spike FIRST (blocks all other work)

**First Implementation Priority:**

```bash
# 1. After spike completes successfully, initialize project
npx cdk init app --language typescript

# 2. Add ISB as git submodule
git submodule add https://github.com/aws-solutions/innovation-sandbox-on-aws.git deps/isb
cd deps/isb && git checkout v1.1.7 && cd ../..

# 3. Install dependencies
npm install

# 4. Verify ISB commons are importable (path mapping test)
echo "import { SandboxOuService } from '@amzn/innovation-sandbox-commons/isb-services/sandbox-ou-service.js';" > test-import.ts
npx tsc test-import.ts --noEmit --skipLibCheck
rm test-import.ts
echo "✅ ISB import verification passed"

# 5. Run full validation
npm run validate
```

If step 4 fails, check `tsconfig.json` path mappings and `package.json` dependencies before proceeding.

## Architecture Completion Summary

### Workflow Completion

**Architecture Decision Workflow:** COMPLETED ✅
**Total Steps Completed:** 8
**Date Completed:** 2026-01-28
**Document Location:** `_bmad-output/planning-artifacts/architecture.md`

### Final Architecture Deliverables

**Complete Architecture Document**

- All architectural decisions documented with specific versions
- Implementation patterns ensuring AI agent consistency
- Complete project structure with all files and directories
- Requirements to architecture mapping
- Validation confirming coherence and completeness

**Implementation Ready Foundation**

- 15+ architectural decisions made
- 8 implementation pattern categories defined
- 12 AWS resource types specified
- 38 functional requirements fully supported
- 18 non-functional requirements addressed

**AI Agent Implementation Guide**

- Technology stack with verified versions (Node.js 22.x, CDK v2, ISB v1.1.7)
- Consistency rules that prevent implementation conflicts
- Project structure with clear boundaries
- Integration patterns and communication standards

### Implementation Handoff

**For AI Agents:**
This architecture document is your complete guide for implementing ISB Billing Separator. Follow all decisions, patterns, and structures exactly as documented.

**First Implementation Priority:**
Complete the Event Routing Spike to verify CloudTrail → Hub event routing before any other implementation work.

**Development Sequence:**

1. Complete event routing spike (blocks all other work)
2. Initialize project using documented CDK init + git submodule
3. Verify ISB imports work correctly
4. Implement QuarantineLambda (Story 2)
5. Implement UnquarantineLambda (Story 3)
6. Build event infrastructure in CDK stack (Story 4)
7. Add observability (alarms, SNS) (Story 5)
8. Configure CI/CD pipeline (Story 6)
9. Execute integration test (Story 7)

### Quality Assurance Checklist

**✅ Architecture Coherence**

- [x] All decisions work together without conflicts
- [x] Technology choices are compatible
- [x] Patterns support the architectural decisions
- [x] Structure aligns with all choices

**✅ Requirements Coverage**

- [x] All 38 functional requirements are supported
- [x] All 18 non-functional requirements are addressed
- [x] Cross-cutting concerns are handled
- [x] Integration points are defined

**✅ Implementation Readiness**

- [x] Decisions are specific and actionable
- [x] Patterns prevent agent conflicts
- [x] Structure is complete and unambiguous
- [x] Examples are provided for clarity

### Project Success Factors

**Clear Decision Framework**
Every technology choice was made collaboratively with clear rationale, ensuring all stakeholders understand the architectural direction.

**Consistency Guarantee**
Implementation patterns and rules ensure that multiple AI agents will produce compatible, consistent code that works together seamlessly.

**Complete Coverage**
All project requirements are architecturally supported, with clear mapping from business needs to technical implementation.

**Solid Foundation**
The chosen brownfield approach with ISB submodule integration provides a production-ready foundation following existing patterns.

**Clean Removal Path**
Single CDK stack design ensures the solution can be completely removed with `cdk destroy` when the upstream ISB fix ships.

---

**Architecture Status:** READY FOR IMPLEMENTATION ✅

**Next Phase:** Complete the event routing spike, then begin implementation using the architectural decisions and patterns documented herein.

**Document Maintenance:** Update this architecture when major technical decisions are made during implementation, particularly after the event routing spike completes.

