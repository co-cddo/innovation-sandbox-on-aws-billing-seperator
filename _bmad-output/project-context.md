---
project_name: 'innovation-sandbox-on-aws-billing-seperator'
user_name: 'Cns'
date: '2026-01-28'
source: 'architecture.md'
---

# Project Context for AI Agents

_Critical rules and patterns for implementing code in the ISB Billing Separator project. Read this before writing any code._

---

## Technology Stack & Versions

| Technology | Version | Notes |
|------------|---------|-------|
| Node.js | 22.x | Lambda runtime, arm64 architecture |
| TypeScript | Strict mode | ESM modules required |
| AWS CDK | v2 | Infrastructure as Code |
| ISB Commons | v1.1.7 | Git submodule at `deps/isb/` |
| Jest | Latest | Co-located tests (`*.test.ts`) |
| Lambda Powertools | Latest | Logger, Tracer, Metrics |
| Zod | Latest | Runtime schema validation |

---

## Critical Implementation Rules

### ESM Import Rules (MUST FOLLOW)

```typescript
// ✅ CORRECT: Include .js extension (ESM requirement)
import { SandboxOuService } from "@amzn/innovation-sandbox-commons/isb-services/sandbox-ou-service.js";

// ❌ WRONG: Missing .js extension - WILL FAIL
import { SandboxOuService } from "@amzn/innovation-sandbox-commons/isb-services/sandbox-ou-service";
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Functions | camelCase | `quarantineAccount`, `parseEvent` |
| Constants | SCREAMING_SNAKE | `QUARANTINE_DURATION_HOURS` |
| Types/Interfaces | PascalCase | `QuarantineEvent`, `AccountStatus` |
| Files | lowercase with dots | `quarantine.ts`, `quarantine.test.ts` |
| Environment vars | SCREAMING_SNAKE | `ACCOUNT_TABLE_NAME` |
| CDK resources | `isb-billing-sep-{Name}` | `isb-billing-sep-QuarantineLambda` |

### Handler Entry Point Pattern

ALL Lambda handlers must follow this structure:

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
    throw error; // ALWAYS re-throw for retry/DLQ
  }
};
```

### Error Handling: Throw on ANY Failure

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

### Idempotency Pattern

```typescript
// ✅ CORRECT: Early return with logging for idempotent skip
const account = await sandboxAccountStore.get(accountId);
if (account.status !== "Available") {
  logger.info("Account not in expected state, skipping", {
    accountId,
    expectedStatus: "Available",
    actualStatus: account.status,
    action: "QUARANTINE_SKIP"
  });
  return; // Success - idempotent behavior
}
```

### Structured Logging

```typescript
// ✅ CORRECT: Structured with action field
logger.info("Quarantining account", {
  accountId,
  sourceOu: "CleanUp",
  destinationOu: "Quarantine",
  action: "QUARANTINE_START"
});

// ❌ WRONG: Unstructured string interpolation
logger.info(`Quarantining account ${accountId} from CleanUp to Quarantine`);
```

**Log Levels:**
- `error` — Failures causing retry/DLQ
- `warn` — Unexpected but handled conditions
- `info` — Normal operations (start, complete, skip)
- `debug` — Detailed troubleshooting (disabled in prod)

---

## Testing Rules

### Test File Location

Co-located with handlers:
```
source/lambdas/
├── quarantine.ts
├── quarantine.test.ts      # ← Same directory
├── unquarantine.ts
└── unquarantine.test.ts    # ← Same directory
```

### Behavior-Driven Test Naming

```typescript
// ✅ CORRECT: Behavior-driven
describe("QuarantineLambda", () => {
  describe("given account in Available status", () => {
    it("moves account to Quarantine OU", () => {});
    it("creates scheduler for 72 hours later", () => {});
  });

  describe("given account NOT in Available status", () => {
    it("skips processing without error", () => {});
  });
});

// ❌ WRONG: Implementation-focused
it("should call transactionalMoveAccount", () => {});
```

### Mock Granularity

```typescript
// Level 1: Service-level mocks (unit tests)
const mockOrgsService = {
  transactionalMoveAccount: jest.fn().mockReturnValue({
    complete: jest.fn().mockResolvedValue(undefined)
  })
};

// Level 2: SDK-level mocks (integration tests)
jest.mock("@aws-sdk/client-organizations");
```

### Coverage Targets

| Component | Line | Branch |
|-----------|------|--------|
| Handlers (`*.ts`) | > 90% | > 85% |
| Shared utilities | > 80% | > 75% |

---

## Project Structure Rules

### Directory Layout

```
source/lambdas/           # Lambda handlers + tests
source/lambdas/shared/    # Constants, types, utilities
source/lambdas/__mocks__/ # Centralized test mocks
source/lambdas/__fixtures__/ # Test data
lib/                      # CDK stack definitions
bin/                      # CDK app entry point
deps/isb/                 # ISB submodule (READ-ONLY)
```

### File Naming

- Use `/source/` (not `/src/`) to match ISB conventions
- Flat Lambda structure (no subdirectories for 2 handlers)
- Co-locate tests beside handlers

---

## ISB Integration Rules

### Submodule Import Pattern

```typescript
// Import from ISB commons via package.json alias
import { SandboxOuService } from "@amzn/innovation-sandbox-commons/isb-services/sandbox-ou-service.js";
import { DynamoSandboxAccountStore } from "@amzn/innovation-sandbox-commons/data/sandbox-account/dynamo-sandbox-account-store.js";
import { fromTemporaryIsbOrgManagementCredentials } from "@amzn/innovation-sandbox-commons/utils/cross-account-roles.js";
```

### State Management

- Use `transactionalMoveAccount()` for atomic OU + DynamoDB updates
- Never modify DynamoDB directly — always use ISB services
- OU is authoritative source of truth

### Cross-Account Access

Use ISB's credential helper for role chain:
```
Hub Lambda → Intermediate Role → Org Management Role → Organizations API
```

---

## Critical Don't-Miss Rules

### Anti-Patterns to AVOID

1. **Never return success on partial failure** — Always throw for retry/DLQ
2. **Never use string interpolation in logs** — Use structured JSON
3. **Never skip `.js` extension in imports** — ESM requires it
4. **Never modify ISB submodule files** — Read-only dependency
5. **Never create separate DynamoDB operations** — Use `transactionalMoveAccount()`

### Edge Cases to Handle

1. **Account already in Quarantine** — Skip idempotently, log with `action: "SKIP"`
2. **Account not found in DynamoDB** — Throw error for investigation
3. **Scheduler already exists** — Check before creating, handle gracefully
4. **Cross-account role assumption fails** — Throw for retry with full context

### Security Rules

- No hardcoded ARNs, account IDs, or secrets
- All sensitive values from environment variables
- Time-limited STS tokens via ISB credential helper
- IAM follows least-privilege principle

---

## NPM Scripts

```bash
npm run validate  # lint + test + build (run before commit)
npm run deploy -- -c env=prod  # Deploy to production
npm run destroy -- -c env=prod  # Remove solution
```

---

## Quick Reference

**This is a TEMPORARY solution.** When upstream ISB ships quarantine buffer:
1. Verify no accounts in Quarantine OU
2. Run `npm run destroy -- -c env=prod`
3. Delete repository

**Architecture document:** `_bmad-output/planning-artifacts/architecture.md`
