# Story 1.1: Event Routing Validation Spike

Status: done

## Story

As an **ISB Platform Operator**,
I want **to verify that CloudTrail MoveAccount events reach the Hub account's EventBridge bus**,
So that **I can confirm the architectural approach will work before investing in implementation**.

## Acceptance Criteria

1. **AC1: Organization Trail Verification**
   - Given an Organization Trail exists
   - When the trail configuration is reviewed
   - Then it MUST be logging AWS Organizations API events (`organizations.amazonaws.com`)
   - And the trail must be active and receiving events

2. **AC2: Event Propagation Verification**
   - Given an account is moved between OUs (manually or via ISB cleanup)
   - When the MoveAccount API is called
   - Then the MoveAccount event MUST appear on the Hub account's default EventBridge bus within 90 seconds
   - And the event source MUST be `aws.organizations`
   - And the detail-type MUST be `AWS API Call via CloudTrail`

3. **AC3: Event Payload Verification**
   - Given a MoveAccount event is captured on Hub EventBridge
   - When the event payload is inspected
   - Then it MUST contain `requestParameters.accountId` (the account being moved)
   - And it MUST contain `requestParameters.sourceParentId` (the source OU)
   - And it MUST contain `requestParameters.destinationParentId` (the destination OU)

4. **AC4: Documentation of Findings**
   - Given the spike is complete
   - When the findings are documented
   - Then the architecture document's "Spike Results" section MUST be updated with:
     - Confirmation of Organization Trail configuration
     - Event routing verification results (success/failure)
     - Observed event latency
     - Sample event payload structure
   - And any contingency actions MUST be identified if events do NOT reach Hub account

5. **AC5: Contingency Assessment (if required)**
   - Given the spike reveals events do NOT reach the Hub account
   - When the contingency is assessed
   - Then the architecture MUST be updated to include cross-account EventBridge rule in Org Management account
   - And the CDK structure MUST be updated for multi-stack deployment
   - And the contingency plan from architecture document section "Spike Contingency Plan" MUST be followed

## Tasks / Subtasks

- [x] **Task 1: Verify Organization Trail Configuration** (AC: #1)
  - [x] 1.1 Log into AWS Org Management account
  - [x] 1.2 Navigate to CloudTrail console
  - [x] 1.3 Identify the Organization Trail
  - [x] 1.4 Verify trail is logging `organizations.amazonaws.com` events
  - [x] 1.5 Document trail name and configuration

- [x] **Task 2: Set Up Event Capture in Hub Account** (AC: #2, #3)
  - [x] 2.1 Log into Hub account (where Billing Separator will deploy)
  - [x] 2.2 Navigate to EventBridge console
  - [x] 2.3 Create a temporary EventBridge rule with pattern
  - [x] 2.4 Configure rule target to CloudWatch Logs (for capture)
  - [x] 2.5 Enable the rule

- [x] **Task 3: Trigger Test MoveAccount Event** (AC: #2, #3)
  - [x] 3.1 Identify a test account that can be safely moved
  - [x] 3.2 Note the account's current OU
  - [x] 3.3 Move the account to a different OU (via Console or CLI)
  - [x] 3.4 Record the timestamp of the move
  - [x] 3.5 Wait up to 90 seconds for event propagation

- [x] **Task 4: Verify Event Capture** (AC: #2, #3)
  - [x] 4.1 Check CloudWatch Logs for the captured event
  - [x] 4.2 Verify event arrived within 90-second window
  - [x] 4.3 Extract and validate event payload fields
  - [x] 4.4 Save sample event payload for documentation

- [x] **Task 5: Document Spike Results** (AC: #4)
  - [x] 5.1 Update architecture.md "Spike Results" section
  - [x] 5.2 If SUCCESS: Confirm single-stack architecture is viable
  - [x] 5.3 If FAILURE: Document reason and proceed to Task 6

- [x] **Task 6: Implement Contingency (if required)** (AC: #5)
  - [x] 6.1 If events did NOT reach Hub, follow contingency plan
  - [x] 6.2 Update architecture document with contingency approach

- [x] **Task 7: Cleanup**
  - [x] 7.1 Delete temporary EventBridge rule in Hub account
  - [x] 7.2 Delete temporary CloudWatch Log group
  - [x] 7.3 Move test account back to original OU (if needed)

## Dev Notes

### Critical Context

This is a **validation spike** - the goal is to verify the architectural assumption that CloudTrail MoveAccount events automatically propagate to the Hub account's EventBridge default bus via Organization Trail. This assumption is CRITICAL because if it fails, the architecture requires a different approach (cross-account EventBridge rule in Org Management account).

**Why This Matters:**
- The entire Billing Separator architecture depends on intercepting `MoveAccount` events
- If events don't reach Hub account natively, we need cross-account EventBridge rules
- This would change from single-stack to multi-stack deployment
- Better to discover this BEFORE writing Lambda code

### Architectural Reference

From `architecture.md` - Pre-Architecture Spike section:

| Question | Expected Answer | If No |
|----------|-----------------|-------|
| Does Organization Trail exist? | Yes | Create trail or use cross-account rule |
| Does it log `organizations.amazonaws.com` events? | Yes | Enable Organizations event logging |
| Do events arrive on Hub account's default EventBridge bus? | Yes | Configure cross-account EventBridge rule |
| What's typical event latency? | < 90 seconds | Document and accept |

### Expected Event Structure

Based on CloudTrail documentation, the expected MoveAccount event structure:

```json
{
  "version": "0",
  "id": "example-event-id",
  "detail-type": "AWS API Call via CloudTrail",
  "source": "aws.organizations",
  "account": "123456789012",
  "time": "2026-01-28T12:00:00Z",
  "region": "us-east-1",
  "detail": {
    "eventSource": "organizations.amazonaws.com",
    "eventName": "MoveAccount",
    "requestParameters": {
      "accountId": "111122223333",
      "sourceParentId": "ou-xxxx-cleanupou",
      "destinationParentId": "ou-xxxx-availableou"
    }
  }
}
```

### ISB OU IDs Reference (Discovered During Spike)

From ISB deployment (NDX environment), the relevant OUs are:
- **Available OU**: `ou-2laj-oihxgbtr` - Pool of available accounts for new leases
- **CleanUp OU**: `ou-2laj-x3o8lbk8` - Where accounts go after lease cleanup
- **Quarantine OU**: `ou-2laj-mmagoake` - Where we intercept and hold accounts (has pool-001)
- **Active OU**: `ou-2laj-sre4rnjs` - Accounts with active leases
- **Frozen OU**: `ou-2laj-jpffue7g` - Accounts frozen due to budget/policy
- **Entry OU**: `ou-2laj-2by9v0sr` - New accounts entering the pool
- **Exit OU**: `ou-2laj-s1t02mrz` - Accounts being removed from pool

**Parent OUs:**
- **InnovationSandbox OU**: `ou-2laj-lha5vsam`
- **Account Pool OU**: `ou-2laj-4dyae1oa` (ndx_InnovationSandboxAccountPool)
- **Organization Root**: `r-2laj`

**Account IDs (for reference):**
- **Org Management**: `955063685555`
- **Hub Account**: `568672915267`

### Contingency Plan (if events don't reach Hub)

Per architecture document, if Organization Trail doesn't forward events:

| Impact Area | Current Design | Contingency Design |
|-------------|----------------|-------------------|
| Event routing | EventBridge rule in Hub only | Add cross-account EventBridge rule in Org Mgmt |
| CDK structure | Single stack in Hub | Two stacks: Hub + Org Mgmt |
| Deployment | `cdk deploy` (one stack) | `cdk deploy --all` (both stacks) |
| Removal | `cdk destroy` (one stack) | `cdk destroy --all` (both stacks) |
| CI/CD | Single account deploy role | Multi-account deploy roles |

### Project Structure Notes

This is a spike/investigation story - no code is written. Outputs are:
- Documentation updates to `architecture.md`
- Verification of architectural assumptions
- Clear go/no-go decision for single-stack vs multi-stack approach

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Pre-Implementation Spike]
- [Source: _bmad-output/planning-artifacts/architecture.md#Spike Contingency Plan]
- [Source: _bmad-output/planning-artifacts/architecture.md#Event Processing Architecture]
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 1: Operator Deployment]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1]

### Success Criteria

**Spike Success Indicators:**
1. Organization Trail confirmed logging Organizations API events
2. MoveAccount event captured on Hub EventBridge within 90 seconds
3. Event payload contains all required fields
4. Architecture document updated with spike results
5. Clear decision: Single-stack (event routing works) OR Multi-stack (contingency needed)

### AWS CLI Commands Reference

```bash
# Verify Organization Trail exists and configuration
aws cloudtrail describe-trails --include-shadow-trails

# List Organization Trails
aws cloudtrail list-trails

# Check trail event selectors
aws cloudtrail get-event-selectors --trail-name <trail-name>

# Move account (for testing)
aws organizations move-account \
  --account-id 111122223333 \
  --source-parent-id ou-xxxx-source \
  --destination-parent-id ou-xxxx-dest

# Create temporary EventBridge rule via CLI (alternative to console)
aws events put-rule \
  --name "isb-spike-moveaccount-capture" \
  --event-pattern '{"source":["aws.organizations"],"detail-type":["AWS API Call via CloudTrail"],"detail":{"eventSource":["organizations.amazonaws.com"],"eventName":["MoveAccount"]}}'

# Check CloudWatch Logs for captured events
aws logs filter-log-events \
  --log-group-name "/aws/events/isb-spike-moveaccount" \
  --start-time <timestamp>
```

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Implementation Plan

**SPIKE COMPLETED:** 2026-01-28

Executed spike using AWS SSO with profiles:
- NDX/orgManagement (Org Management account: 955063685555)
- NDX/InnovationSandboxHub (Hub account: 568672915267)

### Debug Log References

- 2026-01-28 14:34: AWS SSO login to orgManagement profile
- 2026-01-28 14:35: Verified Organization Trail `aws-controltower-BaselineCloudTrail` exists with IsOrganizationTrail: true
- 2026-01-28 14:36: Verified trail has IncludeManagementEvents: true (logs Organizations API)
- 2026-01-28 14:36: AWS SSO login to InnovationSandboxHub profile
- 2026-01-28 14:37: Created EventBridge rule in Hub account us-west-2
- 2026-01-28 14:37: Moved pool-007 (417845783913) from Available to CleanUp
- 2026-01-28 14:38: No events in Hub us-west-2 after 90 seconds
- 2026-01-28 14:39: Added CloudWatch Logs resource policy, retested
- 2026-01-28 14:40: Created EventBridge rule in Hub account us-east-1
- 2026-01-28 14:41: Moved pool-007 back to Available, no events in Hub us-east-1
- 2026-01-28 14:43: Created EventBridge rule in Org Management account us-east-1
- 2026-01-28 14:44: Moved pool-007 again - **EVENT CAPTURED** in Org Mgmt EventBridge
- 2026-01-28 14:45: Confirmed events appear in Org Mgmt account only, not Hub
- 2026-01-28 14:46: Cleanup completed - all temporary resources deleted

### Completion Notes List

1. **AC1 SATISFIED**: Organization Trail `aws-controltower-BaselineCloudTrail` verified with IncludeManagementEvents: true
2. **AC2 PARTIAL**: Events do NOT reach Hub account EventBridge (contingency required)
3. **AC3 SATISFIED**: Event payload verified with accountId, sourceParentId, destinationParentId
4. **AC4 SATISFIED**: Architecture document updated with spike results
5. **AC5 SATISFIED**: Contingency identified - multi-stack deployment required

**SPIKE OUTCOME: CONTINGENCY REQUIRED**

CloudTrail MoveAccount events are logged by the Organization Trail and appear on the **Org Management account's default EventBridge bus in us-east-1**, but do NOT automatically propagate to member accounts' EventBridge buses.

**Architecture must be updated to:**
1. Create `OrgMgmtStack` with cross-account EventBridge rule in us-east-1
2. Forward MoveAccount events to Hub account's EventBridge
3. Use `cdk deploy --all` for multi-stack deployment
4. Update removal instructions for multi-stack teardown

### File List

- `_bmad-output/planning-artifacts/architecture.md` (updated with spike results, contingency plan, multi-region strategy)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (story status: backlog → in-progress → review)
- `_bmad-output/implementation-artifacts/1-1-event-routing-validation-spike.md` (this story file - created)

### Change Log

- 2026-01-28 14:34: Story moved to in-progress
- 2026-01-28 14:34-14:46: Spike execution completed
- 2026-01-28 14:46: All tasks completed, spike outcome: CONTINGENCY REQUIRED
- 2026-01-28 14:47: Architecture document updated with findings
- 2026-01-28 14:48: Story moved to review
- 2026-01-28 14:55: Code review completed - 5 issues found (1 High, 2 Medium, 2 Low), all fixed

## Senior Developer Review (AI)

**Review Date:** 2026-01-28
**Review Outcome:** Approved (after fixes)
**Reviewer:** Claude Opus 4.5

### Issues Found & Resolved

| # | Severity | Issue | Resolution |
|---|----------|-------|------------|
| H1 | HIGH | Architecture CI/CD specifies us-west-2 but Org Mgmt stack must deploy to us-east-1 | Updated deploy.yml to deploy Hub to us-west-2, Org Mgmt to us-east-1 |
| M1 | MEDIUM | Story File List incomplete (missing sprint-status.yaml, story file) | Updated File List with all modified files |
| M2 | MEDIUM | Architecture Contingency Plan missing us-east-1 region requirement | Updated contingency plan with multi-region deployment strategy |
| L1 | LOW | Story Dev Notes had placeholder OU IDs | Updated with actual discovered OU IDs and account IDs |
| L2 | LOW | Architecture didn't explicitly state multi-region deployment | Added Multi-Region Deployment Strategy table |

### Action Items

All items resolved during review - no follow-up required.
