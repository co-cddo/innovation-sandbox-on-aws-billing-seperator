---
stepsCompleted: ['step-01-init', 'step-02-discovery', 'step-03-success', 'step-04-journeys', 'step-05-domain', 'step-06-innovation', 'step-07-project-type', 'step-08-scoping', 'step-09-functional', 'step-10-nonfunctional', 'step-11-polish', 'step-12-complete']
inputDocuments:
  - '_bmad-output/planning-artifacts/research/technical-isb-quarantine-automation-research-2026-01-27.md'
workflowType: 'prd'
documentCounts:
  briefs: 0
  research: 1
  projectDocs: 1
  brainstorming: 0
projectType: 'brownfield'
relatedCodebase: '../innovation-sandbox-on-aws'
classification:
  projectType: 'Serverless Event-Driven Backend'
  domain: 'Cloud FinOps / Billing Governance'
  complexity: 'Medium-High'
  projectContext: 'brownfield'
  coreFraming: 'Billing isolation / Lease cost attribution'
designConstraints:
  - 'Removability critical - delete stack + manual account moves'
  - 'Zero shared runtime state with ISB'
  - '72-hour window tied to AWS Cost Explorer latency'
  - 'Success metric: Zero cost leakage between leases'
---

# Product Requirements Document - innovation-sandbox-on-aws-billing-seperator

**Author:** Cns
**Date:** 2026-01-27
**Version:** 1.0
**Status:** Complete

## Success Criteria

### User Success

**ISB Operators (Primary):**
- "Set and forget" deployment - zero ongoing intervention required
- Clear alerting only when something fails (no noise)
- Removal achievable in under 1 hour when upstream solution available

**ISB End Users (Indirect):**
- Accurate, isolated billing data per lease - no cost contamination from previous lease holders
- Invisible to end users - they simply get correct cost reports

### Business Success

- **Launch Blocker Resolved:** Deployed and operational before ISB production launch
- **Operational Cost:** Negligible - Lambda invocations and EventBridge Scheduler within free tier or minimal cost
- **Removal Ready:** Can be fully removed within same sprint when upstream solution ships

### Technical Success

| Metric | Target |
|--------|--------|
| Quarantine trigger reliability | 100% of CleanUp→Available moves intercepted |
| Unquarantine timing accuracy | Within minutes of 72-hour mark |
| Failed operation handling | CloudWatch alerts to operators, no silent failures |
| Removal complexity | Single `cdk destroy` + manual account moves |
| ISB coupling | Zero runtime dependencies beyond DynamoDB reads and Organizations API |

### Measurable Outcomes

- **Zero cost leakage:** No billing line items attributed to wrong lease after quarantine system deployed
- **Account pool availability:** Quarantine buffer does not cause account shortages (sufficient pool depth confirmed)
- **Operational overhead:** Zero operator interventions required in normal operation

## Product Scope

### MVP - Minimum Viable Product

1. **Quarantine Lambda** - Triggered by CloudTrail MoveAccount event (dest=Available OU)
   - Validates source is CleanUp OU
   - Moves account to Quarantine OU
   - Updates DynamoDB status
   - Creates 72-hour EventBridge Scheduler

2. **Unquarantine Lambda** - Triggered by EventBridge Scheduler
   - Validates account still in Quarantine status
   - Moves account to Available OU
   - Updates DynamoDB status
   - Cleans up scheduler

3. **CDK Stack** - Standalone, removable infrastructure
   - Both Lambdas with appropriate IAM roles
   - EventBridge rule on default bus for CloudTrail events
   - Cross-account role assumption for Organizations API

4. **Observability** - Minimum viable monitoring
   - CloudWatch alarms for Lambda errors
   - Log group for debugging

### Growth Features (Post-MVP)

- Configurable quarantine duration (environment variable)
- CloudWatch dashboard for quarantine metrics
- SNS notifications for quarantine/unquarantine events
- Manual quarantine extension API (for edge cases)

### Vision (Future)

- Native upstream support in ISB core (this solution becomes obsolete)
- Potential contribution back to ISB open source project

## User Journeys

### Journey 1: Operator Deployment (Happy Path)

**Persona:** Cns - ISB Platform Operator
**Context:** ISB is approaching production launch. Billing isolation is a launch requirement.

**Prerequisites Check:**
Before deployment, operator verifies:
- CloudTrail Organization trail is logging AWS Organizations API events
- MoveAccount events are visible on Hub account's default EventBridge bus (or cross-account rule exists)
- Failure to verify = silent failure mode (no events reach Lambda)

**Opening Scene:**
Operator has completed the technical research and needs to deploy the billing separator before ISB goes live. The ISB infrastructure is already running in the Hub Account, and the account pool has sufficient accounts ready.

**Rising Action:**
1. Clone the billing-separator repo and review the CDK stack
2. Verify CloudTrail events are flowing to Hub account EventBridge (prerequisite)
3. Configure environment variables (account table name, OU IDs, role ARNs)
4. Run `cdk deploy` via CI/CD pipeline with OIDC authentication
5. Pipeline assumes STS role, deploys CloudFormation stack to Hub Account
6. EventBridge rule activates on default bus, Lambdas deployed with correct IAM permissions

**Climax:**
First real cleanup completes in ISB. CloudTrail emits MoveAccount event. Quarantine Lambda fires, account moves to Quarantine OU, scheduler created for 72 hours later. Operator sees CloudWatch logs confirming successful interception.

**Resolution:**
System is live and invisible. Operator moves on to other launch tasks, confident that billing isolation is handled. No further interaction needed unless alerts fire.

**Requirements Revealed:**
- CDK stack with clear environment configuration
- CI/CD compatible (no interactive prompts)
- OIDC/STS authentication support
- CloudWatch logs for deployment verification
- Prerequisites documentation for CloudTrail/EventBridge setup
- No manual post-deployment steps required

### Journey 2: Operator Troubleshooting (Account Stuck)

**Persona:** ISB Platform Operator
**Context:** 3 months post-launch. Alert fires: account has been in Quarantine for 96 hours.

**Opening Scene:**
Operator receives CloudWatch alarm: "Account in Quarantine status for >80 hours." This shouldn't happen - unquarantine should fire at 72 hours.

**Rising Action:**
1. Check CloudWatch Logs for UnquarantineLambda - find no invocation at expected time
2. Check EventBridge Scheduler console - scheduler for this account doesn't exist
3. Hypothesis: Scheduler creation failed silently after quarantine succeeded
4. Check QuarantineLambda logs from 96 hours ago - find error: "Scheduler creation failed: rate limit exceeded"
5. Root cause identified: burst of cleanups caused scheduler API throttling

**Climax:**
Manual recovery required:
- Move account from Quarantine → Available OU (via AWS Console or CLI)
- Update DynamoDB status to "Available"
- No orphan scheduler to clean up (it never existed)

**Resolution:**
Account recovered manually. Verify: no lease requests failed during the overage period (pool had sufficient capacity). Add retry logic to scheduler creation as a code improvement.

**Success Criteria:**
- Account recovered to Available status
- OU and DynamoDB state are consistent
- No lease request failures occurred during incident
- Root cause identified and remediation planned

**Requirements Revealed:**
- CloudWatch alarm for accounts in Quarantine > threshold (e.g., 80 hours)
- Clear logging when scheduler creation fails
- Documented manual recovery procedure
- Consider: retry logic or DLQ for scheduler failures

### Journey 2b: Operator Troubleshooting (Partial Failure - Split Brain)

**Persona:** ISB Platform Operator
**Context:** Alert fires: DynamoDB shows account as "Available" but Organizations console shows it in Quarantine OU.

**Opening Scene:**
Operator notices discrepancy during routine check: Account is in Quarantine OU but DynamoDB status is "Available". ISB might try to lease this account, but the SCP on Quarantine OU would block user access.

**Rising Action:**
1. Check QuarantineLambda logs - find partial execution
2. Log shows: "OU move succeeded" then "DynamoDB update failed: ConditionalCheckFailedException"
3. Root cause: ISB's account-lifecycle-manager updated status between our OU move and DB update (race condition)
4. Current state: Account in Quarantine OU, DB says "Active", but no actual lease exists (ISB lease failed due to OU mismatch)

**Climax:**
Reconcile state:
- Check if account has active lease (it doesn't - ISB lease failed)
- Decide authoritative state: Quarantine OU is physical reality
- Update DynamoDB to "Quarantine" to match OU
- Create scheduler manually for 72h unquarantine

**Resolution:**
State reconciled. Note: `transactionalMoveAccount()` from ISB commons should prevent this, but race with ISB's own handlers can still cause edge cases. Consider adding reconciliation check to UnquarantineLambda.

**Requirements Revealed:**
- Use ISB's `transactionalMoveAccount()` for atomic OU + DB updates
- Reconciliation logic: OU state is authoritative over DB state
- Manual scheduler creation procedure documented
- Consider: periodic reconciliation check (OU vs DB audit)

### Journey 3: Operator Removal (Upstream Solution Available)

**Persona:** ISB Platform Operator
**Context:** 6 months post-launch. ISB v2.0 releases with native quarantine support.

**Opening Scene:**
AWS Solutions releases ISB update with built-in quarantine feature. Operator needs to remove the billing-separator without disrupting active quarantines.

**Rising Action:**
1. Check current state: accounts in Quarantine with active schedulers
2. Decision: wait for all to unquarantine naturally (max 72 hours) or handle manually
3. Choose to wait - monitor until all accounts return to Available
4. Verify: no accounts in Quarantine, no pending schedulers
5. Run `cdk destroy` via CI/CD pipeline
6. Stack deletes cleanly: Lambdas, EventBridge rule, IAM roles removed

**Climax:**
CloudFormation stack deleted. ISB continues operating normally - cleanup events now handled by native ISB quarantine feature.

**Resolution:**
Billing separator fully removed. No orphaned resources, no manual cleanup needed beyond the initial account check. Total removal time: < 1 hour active work.

**Requirements Revealed:**
- Ability to check "safe to remove" state (no pending quarantines)
- Clean `cdk destroy` with no orphaned resources
- Schedulers should be named predictably for easy audit
- Documentation for removal procedure

### Journey 4: System Flow (Automated Happy Path)

**Actors:** EventBridge, QuarantineLambda, Scheduler, UnquarantineLambda, DynamoDB, AWS Organizations

**Trigger:** ISB completes account cleanup, moves account from CleanUp → Available OU

**Flow:**
```
1. [ISB] Account cleanup completes
   └─> MoveAccount API: CleanUp OU → Available OU

2. [CloudTrail] Logs MoveAccount event
   └─> EventBridge (default bus) receives event

3. [EventBridge Rule] Matches pattern:
   - source: aws.organizations
   - eventName: MoveAccount
   - destinationParentId: Available OU
   └─> Triggers QuarantineLambda via SQS

4. [QuarantineLambda] Executes:
   a. Parse accountId from event
   b. Get account from DynamoDB (verify status = "Available")
   c. Move account: Available → Quarantine OU (atomic with DB update)
   d. Create EventBridge Scheduler (72h, one-time)
   └─> Account now quarantined, scheduler pending

   ON FAILURE:
   - Event sent to DLQ
   - CloudWatch alarm fires
   - Operator investigates via Journey 2/2b

5. [72 hours pass]

6. [EventBridge Scheduler] Fires one-time schedule
   └─> Triggers UnquarantineLambda

7. [UnquarantineLambda] Executes:
   a. Get account from DynamoDB
   b. Verify status still "Quarantine" (skip if changed)
   c. Move account: Quarantine → Available OU (atomic with DB update)
   d. Delete scheduler (cleanup)
   └─> Account returned to pool, scheduler removed

   ON FAILURE:
   - Scheduler persists (can retry manually)
   - CloudWatch alarm fires (account stuck >80h)
   - Operator investigates via Journey 2
```

**Failure Boundary:**
- If QuarantineLambda fails entirely: account remains in Available (ISB normal behavior, no billing isolation for that cycle)
- If UnquarantineLambda fails: account stuck in Quarantine (capacity reduction, but no data corruption)
- Blast radius: single account affected, not system-wide

**Requirements Revealed:**
- Idempotent operations (safe to retry)
- Status checks before actions (don't override manual interventions)
- Scheduler self-cleanup after firing
- SQS buffer between EventBridge and Lambda (reliability)
- DLQ for failed Lambda invocations
- Atomic OU + DB updates via `transactionalMoveAccount()`

### Journey Requirements Traceability

*Maps user journeys to functional requirements. See Functional Requirements section for implementation details.*

| FR Reference | Capability | Source Journey |
|--------------|------------|----------------|
| FR22, FR26 | CDK stack with env config | Deployment |
| FR23 | CI/CD compatible deployment | Deployment |
| FR23 | OIDC/STS auth support | Deployment |
| FR20, FR30 | CloudWatch logs | Deployment, Troubleshooting |
| FR17 | Quarantine > threshold alarm | Troubleshooting |
| FR11 | Predictable scheduler naming | Troubleshooting, Removal |
| FR3, FR7 | Use `transactionalMoveAccount()` | Partial Failure |
| FR27, FR28, FR38 | DLQ for failed invocations | System Flow |
| FR24 | Clean cdk destroy | Removal |
| FR16 | Idempotent Lambda operations | System Flow |
| FR8, FR34 | Status validation before actions | System Flow |
| FR14 | SQS buffer for reliability | System Flow |

*Note: Prerequisites documentation and manual recovery procedures are operational artifacts, not functional requirements.*

## Domain-Specific Requirements

### AWS API Constraints

| Constraint | Requirement | Priority |
|------------|-------------|----------|
| Cost Explorer latency | 72-hour quarantine window (conservative, tunable) | MVP |
| Organizations API rate limit | CloudWatch alarm for throttling | MVP |
| EventBridge Scheduler limits | Note: 1M schedule limit - not a concern at current scale | Noted |

### Data Consistency

| Constraint | Requirement | Priority |
|------------|-------------|----------|
| DynamoDB eventual consistency | CloudWatch alarm for OU/DB state mismatch (>threshold duration) | MVP |
| Optimistic locking | Use `transactionalMoveAccount()` - handles version checks internally | MVP |
| Split-brain recovery | OU state is authoritative; manual reconciliation documented | MVP |

### Cross-Account IAM

| Constraint | Requirement | Priority |
|------------|-------------|----------|
| Role chain credentials | Fresh credentials per Lambda invocation - no issues with 72h delay | Validated |
| Trust policy management | CloudFormation-managed: Stack creates trust policy entries on deploy, removes on destroy | MVP |
| Credential helper validation | Verify `fromTemporaryIsbOrgManagementCredentials()` works in standalone Lambda context (spike) | MVP |

### Monitoring & Alerting

| Alarm | Purpose | Priority |
|-------|---------|----------|
| Quarantine > 80 hours | Account stuck, scheduler failed | MVP |
| OU/DB state mismatch | Split-brain detection | MVP |
| Organizations API throttling | Rate limit hit during burst | MVP |
| Quarantine bypass detection | Accounts moved CleanUp→Available without hitting Quarantine (silent failure) | MVP |

### Operational Risks & Mitigations

| Risk | Mitigation | Priority |
|------|------------|----------|
| Burst cleanups causing API throttling | Monitoring alarm; Future: queue-based smoothing | MVP (alarm) / Vision (queue) |
| OU/DB state drift | Monitoring alarm + documented recovery | MVP |
| ISB commons credential helper incompatibility | Validation spike before implementation | MVP |
| Silent quarantine failure | Reconciliation alarm detects bypass | MVP |

### Domain Knowledge (Future Reference)

**Why 72 hours?**
- AWS Cost Explorer data latency is typically 24 hours, but can extend to 72 hours for some cost metrics and tag propagation
- 72 hours is a conservative buffer to ensure complete billing data separation between leases
- Can potentially reduce to 48 hours after observing actual Cost Explorer latency in production
- Configuration: Environment variable `QUARANTINE_DURATION_HOURS` (Growth feature)

**Source:** AWS Cost Explorer documentation - cost data availability SLA

## Serverless Event-Driven Backend Requirements

### Project-Type Overview

This is a **serverless event-driven backend** built on AWS Lambda, triggered by CloudTrail events via EventBridge. It follows the established ISB patterns for Lambda configuration, IAM, and observability.

### Lambda Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Runtime | Node.js 22.x | Match ISB for consistency |
| Architecture | arm64 | Cost optimization |
| Memory | 1024 MB | Match ISB baseline |
| Timeout | 30 seconds | Fail fast - actual operation <5 seconds |
| Tracing | X-Ray Active | Match ISB observability |
| Log Format | JSON | Structured logging for CloudWatch Insights |
| Log Retention | 30 days | Configurable via CDK prop |

### Event Pattern & Filtering

**EventBridge Rule (Broad Filter):**
```json
{
  "source": ["aws.organizations"],
  "detail-type": ["AWS API Call via CloudTrail"],
  "detail": {
    "eventSource": ["organizations.amazonaws.com"],
    "eventName": ["MoveAccount"],
    "requestParameters": {
      "destinationParentId": ["{Available OU ID}"]
    }
  }
}
```

**EventBridge Rule DLQ:**
- Rule has its own DLQ for SQS delivery failures
- Two-layer DLQ coverage: Rule DLQ → SQS DLQ → Lambda

**Runtime Validation (Narrow Logic):**
- Extract `sourceParentId` from event
- Fresh lookup: Resolve CleanUp OU ID via `orgsService.getIsbOu("CleanUp")` on every invocation
- Only proceed if source === CleanUp OU
- Otherwise: log "Skipping non-cleanup move" and exit successfully

**Rationale:** Fresh OU lookup ensures accuracy. Low invocation volume makes caching unnecessary.

### Scheduler Configuration

| Setting | Value |
|---------|-------|
| Naming Convention | `isb-billing-sep-unquarantine-{accountId}-{timestamp}` |
| Schedule Type | One-time (`at()` expression) |
| Flexible Time Window | OFF (precise timing) |
| Timezone | UTC |

### Error Handling Strategy

| Component | Strategy | Configuration |
|-----------|----------|---------------|
| EventBridge Rule | DLQ enabled | Catches SQS delivery failures |
| SQS Queue | DLQ enabled | After 5 receive attempts |
| Lambda Retries | Automatic | 2 async retries (AWS default) |
| DLQ | Yes | Separate DLQ for failed events |
| Alert Threshold | After 3 failures | CloudWatch alarm on DLQ message count >= 3 |
| Alarm Action | SNS Topic | Operator notification |

**Two-Layer DLQ Coverage:**
```
EventBridge Rule → [Rule DLQ] → SQS → [SQS DLQ] → Lambda
                      ↓                    ↓
                 (delivery fail)    (processing fail)
```

### Alarm Configuration

| Alarm | Metric | Threshold | Action |
|-------|--------|-----------|--------|
| DLQ Message Count | ApproximateNumberOfMessagesVisible | >= 3 | SNS → Operator |
| Quarantine Stuck | Custom metric (account in quarantine > 80h) | >= 1 | SNS → Operator |
| Quarantine Bypass | Custom metric (cleanup without quarantine) | >= 1 | SNS → Operator |

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `ACCOUNT_TABLE_NAME` | ISB DynamoDB account table | `ndx-try-isb-data-SandboxAccountTable...` |
| `SANDBOX_OU_ID` | Parent sandbox OU ID | `ou-2laj-4dyae1oa` |
| `INTERMEDIATE_ROLE_ARN` | Hub account intermediate role | `arn:aws:iam::568672915267:role/...` |
| `ORG_MGT_ROLE_ARN` | Org management account role | `arn:aws:iam::955063685555:role/...` |
| `UNQUARANTINE_LAMBDA_ARN` | Target for scheduler | (self-reference for Unquarantine Lambda) |
| `SCHEDULER_ROLE_ARN` | Role for scheduler to invoke Lambda | `arn:aws:iam::568672915267:role/...` |
| `QUARANTINE_DURATION_HOURS` | Quarantine period (Growth) | `72` |
| `SNS_ALERT_TOPIC_ARN` | Alarm notification target | `arn:aws:sns:...` |

### Infrastructure as Code (CDK)

| Aspect | Approach |
|--------|----------|
| Stack Independence | Standalone stack, no nested stacks |
| Resource Naming | Include `isb-billing-sep` prefix for identification |
| Parameter Strategy | Environment variables from CDK context/props |
| Cross-Account | IAM trust policy managed in CloudFormation |
| Removal | Clean `cdk destroy` with no orphans |

### Implementation Considerations

**ISB Commons Integration:**
- Git submodule reference to ISB repository
- Import `SandboxOuService`, `DynamoSandboxAccountStore`, `fromTemporaryIsbOrgManagementCredentials`
- Pin to stable ISB version tag

**Idempotency:**
- Check account status before acting (skip if not expected state)
- Scheduler creation is naturally idempotent (same name = update)
- OU moves are idempotent (move to current OU = no-op)

**Observability:**
- Structured JSON logs with correlation IDs
- X-Ray tracing for cross-service visibility
- CloudWatch metrics for quarantine/unquarantine counts

### Growth Scope Additions

| Feature | Description |
|---------|-------------|
| DLQ Processing Lambda | Periodic processing of failed events with detailed reporting |
| Configurable Duration | `QUARANTINE_DURATION_HOURS` environment variable |

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Problem-Solving MVP
- Minimum functionality to solve billing isolation problem
- Not a platform, not an experience play - tactical functionality
- Designed for obsolescence when upstream solution ships

**Resource Requirements:**
- Team: 1 developer
- Timeline: Sprint-sized effort
- Dependencies: ISB commons submodule, existing ISB infrastructure

### MVP Feature Set (Phase 1)

**Core User Journeys Supported:**
- Journey 1: Operator Deployment (Happy Path)
- Journey 2: Operator Troubleshooting (Account Stuck)
- Journey 2b: Operator Troubleshooting (Partial Failure)
- Journey 3: Operator Removal
- Journey 4: System Flow (Automated)

**Must-Have Capabilities:**

| Component | Capability |
|-----------|------------|
| QuarantineLambda | Intercept CleanUp→Available, move to Quarantine, create scheduler |
| UnquarantineLambda | Release from Quarantine after 72h, cleanup scheduler |
| EventBridge Rule | CloudTrail MoveAccount trigger with DLQ |
| SQS Queue | Buffered delivery with DLQ |
| Alarms | Stuck account, bypass detection, DLQ threshold |
| SNS Topic | Operator notifications |
| CDK Stack | Standalone, removable infrastructure |
| IAM Trust Policy | CloudFormation-managed for clean removal |

**Explicitly NOT in MVP:**
- Configurable quarantine duration (hardcoded 72h)
- CloudWatch dashboard
- DLQ processing automation
- Manual quarantine extension API

### Post-MVP Features

**Phase 2 (Growth):**

| Feature | Value | Trigger |
|---------|-------|---------|
| Configurable duration | Tune based on observed Cost Explorer latency | Post-launch observation |
| DLQ Processing Lambda | Automated failed event handling | If DLQ volume warrants |
| CloudWatch Dashboard | Visual monitoring | If operational need arises |
| SNS notifications for events | Visibility into quarantine/unquarantine | Nice-to-have |

**Phase 3 (Vision):**

| Feature | Value | Trigger |
|---------|-------|---------|
| Native ISB support | Upstream solution | ISB v2.0+ release |
| Solution removal | Planned obsolescence | When upstream available |
| Contribution to ISB | Open source contribution | If solution proves valuable |

### Risk Mitigation Strategy

**Technical Risks:**

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| ISB commons incompatibility | Low | High | Validation spike before implementation |
| Cross-account event routing gap | Medium | High | Verify CloudTrail→EventBridge flow as prerequisite |
| OU ID changes | Low | Medium | Runtime lookup, not hardcoded |

**Market Risks:**

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Upstream solution ships quickly | Medium | Low | Easy removal by design - this is a feature, not a bug |
| ISB pivot/deprecation | Low | Medium | Solution is standalone, can adapt |

**Resource Risks:**

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Time pressure | Medium | Medium | MVP is already minimal |
| Knowledge loss | Low | Medium | PRD + research doc provide complete context |

### Scope Boundaries Summary

**IN SCOPE:**
- Quarantine automation (72h fixed)
- Unquarantine automation
- Event-driven trigger (CloudTrail → EventBridge → Lambda)
- Core alarms and SNS notifications
- Standalone CDK stack with clean removal
- IAM trust policy management

**OUT OF SCOPE:**
- UI/Dashboard (use AWS Console)
- API endpoints (event-driven only)
- Multi-region support
- Custom quarantine durations (Growth)
- Automated DLQ processing (Growth)
- Integration with ISB API (direct DB/OU only)

## Functional Requirements

### Account Quarantine

| ID | Requirement | Priority |
|----|-------------|----------|
| FR1 | System SHALL intercept MoveAccount events where destination is Available OU | MVP |
| FR2 | System SHALL validate source OU is CleanUp before quarantining (fresh lookup each invocation) | MVP |
| FR3 | System SHALL move intercepted accounts from Available to Quarantine OU using `transactionalMoveAccount()` | MVP |
| FR4 | System SHALL update DynamoDB account status to "Quarantine" atomically with OU move | MVP |
| FR5 | System SHALL log account ID, source OU, and timestamp for each quarantine action | MVP |
| FR34 | System SHALL skip quarantine (log and exit success) if source OU is not CleanUp | MVP |

### Account Release

| ID | Requirement | Priority |
|----|-------------|----------|
| FR6 | System SHALL move accounts from Quarantine to Available OU after 72-hour period | MVP |
| FR7 | System SHALL update DynamoDB account status to "Available" atomically with OU move | MVP |
| FR8 | System SHALL verify account status is still "Quarantine" before releasing (skip if changed) | MVP |
| FR9 | System SHALL log account ID and timestamp for each unquarantine action | MVP |
| FR35 | System SHALL delete the EventBridge Scheduler after successful unquarantine | MVP |

### Scheduling

| ID | Requirement | Priority |
|----|-------------|----------|
| FR10 | System SHALL create EventBridge Scheduler with 72-hour delay after quarantine | MVP |
| FR11 | System SHALL name schedulers predictably: `isb-billing-sep-unquarantine-{accountId}-{timestamp}` | MVP |
| FR12 | System SHALL configure scheduler as one-time with precise timing (no flexible window) | MVP |
| FR36 | System SHALL include scheduler IAM role ARN in Lambda environment configuration | MVP |

### Event Processing

| ID | Requirement | Priority |
|----|-------------|----------|
| FR13 | System SHALL receive CloudTrail MoveAccount events via EventBridge rule | MVP |
| FR14 | System SHALL buffer events through SQS queue before Lambda processing | MVP |
| FR15 | System SHALL parse accountId, sourceParentId, and destinationParentId from event payload | MVP |
| FR16 | System SHALL process events idempotently (safe to retry without side effects) | MVP |
| FR38 | System SHALL configure EventBridge rule with DLQ for SQS delivery failures | MVP |

### Observability

| ID | Requirement | Priority |
|----|-------------|----------|
| FR17 | System SHALL emit CloudWatch alarm when any account remains in Quarantine status > 80 hours | MVP |
| FR18 | System SHALL emit CloudWatch alarm when SQS DLQ message count >= 3 | MVP |
| FR19 | System SHALL emit CloudWatch alarm when account moves CleanUp→Available without hitting Quarantine (bypass detection) | MVP |
| FR20 | System SHALL write structured JSON logs with account ID correlation | MVP |
| FR21 | System SHALL send alarm notifications to SNS topic for operator alerts | MVP |

### Operations

| ID | Requirement | Priority |
|----|-------------|----------|
| FR22 | System SHALL deploy via CDK as standalone CloudFormation stack | MVP |
| FR23 | System SHALL support deployment via CI/CD with OIDC/STS authentication | MVP |
| FR24 | System SHALL enable complete removal via single `cdk destroy` command | MVP |
| FR25 | System SHALL prefix all resources with `isb-billing-sep` for identification | MVP |
| FR26 | System SHALL configure all environment variables via CDK context/props | MVP |

### Error Handling

| ID | Requirement | Priority |
|----|-------------|----------|
| FR27 | System SHALL route failed Lambda invocations to DLQ after 5 SQS receive attempts | MVP |
| FR28 | System SHALL preserve failed event payload in DLQ for manual investigation | MVP |
| FR29 | System SHALL use Lambda async retry (2 automatic retries) before DLQ | MVP |
| FR30 | System SHALL log error details including stack trace for failed operations | MVP |

### Cross-Account Access

| ID | Requirement | Priority |
|----|-------------|----------|
| FR31 | System SHALL assume intermediate role in Hub account for cross-account access | MVP |
| FR32 | System SHALL chain role assumption to OrgManagement account for Organizations API | MVP |
| FR33 | System SHALL use ISB commons credential helper `fromTemporaryIsbOrgManagementCredentials()` | MVP |
| FR37 | System SHALL manage IAM trust policy entries via CloudFormation (auto-cleanup on stack destroy) | MVP |

## Non-Functional Requirements

### Security

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-S1 | IAM roles SHALL follow least-privilege principle | Only permissions required for specific operations |
| NFR-S2 | Cross-account role chains SHALL use time-limited credentials | STS tokens with 1-hour max duration |
| NFR-S3 | Lambda execution role SHALL have write access limited to account status attribute; no access to other ISB infrastructure | DynamoDB UpdateItem on status field only |
| NFR-S4 | Secrets, ARNs, and OU IDs SHALL be passed via environment variables, not hardcoded | Zero hardcoded values in source |

### Reliability

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-R1 | Event processing SHALL survive Lambda transient failures | 5 SQS retries + 2 Lambda async retries before DLQ |
| NFR-R2 | System SHALL detect and alert on missed quarantine events | Bypass detection alarm triggers within 1 hour |
| NFR-R3 | System SHALL not lose events due to component failure | Two-layer DLQ (EventBridge rule + SQS) |
| NFR-R4 | Operations SHALL be idempotent | Account already in target state → no-op, no corruption |

### Integration

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-I1 | System SHALL be compatible with ISB commons | Git submodule pinned to specific stable tag |
| NFR-I2 | System SHALL use existing ISB DynamoDB table schema | No schema modifications required |
| NFR-I3 | System SHALL coexist with ISB without runtime interference | Zero shared state beyond DB reads and OU moves |
| NFR-I4 | System SHALL support removal without ISB modification | Clean `cdk destroy`, manual account moves only |

### Operability

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-O1 | Normal operation SHALL NOT require operator intervention more than once per quarter | Measurable via incident count |
| NFR-O2 | All failures SHALL be surfaced via CloudWatch alarms | No silent failure modes |
| NFR-O3 | Logs SHALL enable root cause analysis | Account ID, timestamps, error details in every log entry |
| NFR-O4 | System state SHALL be inspectable via AWS Console | Scheduler names, OU positions, DynamoDB status queryable |
| NFR-O5 | All Lambda invocations SHALL be traceable end-to-end | X-Ray tracing enabled |

### Deployment

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-D1 | Stack deployment SHALL complete successfully on first attempt in clean environment | No manual intervention during deploy |

### Performance

| ID | Requirement | Measure |
|----|-------------|---------|
| NFR-P1 | Quarantine Lambda SHALL complete within 30 seconds | Timeout configured, fail-fast on issues |

