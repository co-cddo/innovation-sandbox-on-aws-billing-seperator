# Integration Testing Guide

This document describes how to manually test the ISB Billing Separator end-to-end.

## Prerequisites

1. **ISB Deployed**: Innovation Sandbox must be deployed and operational
2. **Test Account**: At least one sandbox account must be in the CleanUp OU
3. **CDK Context Configured**: `cdk.context.json` must have all required values
4. **AWS Credentials**: Must have permissions to deploy to Hub account

## Deployment

Deploy both stacks:

```bash
npm run deploy
```

This deploys:
1. `isb-billing-separator-hub-{env}` to Hub account (us-west-2)
2. `isb-billing-separator-org-mgmt-{env}` to Org Management account (us-east-1)

## Test Scenarios

### Scenario 1: Quarantine Flow (Happy Path)

**Trigger**: ISB moves an account from CleanUp to Available OU

**Expected Behavior**:
1. OrgMgmtStack's EventBridge rule captures the MoveAccount event
2. Event is forwarded to HubStack's custom event bus
3. HubStack's EventBridge rule routes event to SQS queue
4. QuarantineLambda processes the event:
   - Validates source is CleanUp OU
   - Moves account from Available to Quarantine OU
   - Updates DynamoDB status to "Quarantine"
   - Creates EventBridge Scheduler for 72-hour release
5. Account remains in Quarantine OU

**Verification**:
```bash
# Check account OU position (should be in Quarantine OU)
aws organizations list-parents --child-id <account-id>

# Check DynamoDB status (should be "Quarantine")
aws dynamodb get-item \
  --table-name <account-table-name> \
  --key '{"awsAccountId": {"S": "<account-id>"}}'

# Check scheduler exists
aws scheduler list-schedules \
  --group-name isb-billing-separator
```

### Scenario 2: Unquarantine Flow (Happy Path)

**Trigger**: EventBridge Scheduler fires after 72 hours (or manual invocation)

**Manual Trigger for Testing**:
```bash
# Invoke UnquarantineLambda directly with test payload
aws lambda invoke \
  --function-name isb-billing-sep-unquarantine-<env> \
  --payload '{"accountId":"<12-digit-account-id>","quarantinedAt":"2026-01-25T14:44:00.000Z","schedulerName":"<scheduler-name>"}' \
  --cli-binary-format raw-in-base64-out \
  response.json
```

**Expected Behavior**:
1. UnquarantineLambda processes the scheduler payload
2. Validates account is still in "Quarantine" status
3. Moves account from Quarantine to Available OU
4. Updates DynamoDB status to "Available"
5. Deletes the EventBridge Scheduler

**Verification**:
```bash
# Check account OU position (should be in Available OU)
aws organizations list-parents --child-id <account-id>

# Check DynamoDB status (should be "Available")
aws dynamodb get-item \
  --table-name <account-table-name> \
  --key '{"awsAccountId": {"S": "<account-id>"}}'

# Check scheduler deleted (should not exist)
aws scheduler get-schedule \
  --name <scheduler-name> \
  --group-name isb-billing-separator
# Should return ResourceNotFoundException
```

### Scenario 3: Skip Non-CleanUp Source

**Trigger**: Account moves from Active to Available (not CleanUp)

**Expected Behavior**:
1. QuarantineLambda processes the event
2. Validates source is NOT CleanUp OU
3. Logs "QUARANTINE_SKIP" with reason
4. Returns success (no quarantine)

**Verification**:
```bash
# Check CloudWatch Logs for QuarantineLambda
aws logs filter-log-events \
  --log-group-name /aws/lambda/isb-billing-sep-quarantine-<env> \
  --filter-pattern "QUARANTINE_SKIP"
```

### Scenario 4: Idempotent Retry

**Trigger**: Same event processed twice (e.g., SQS retry)

**Expected Behavior**:
1. First invocation: Account quarantined normally
2. Second invocation: QuarantineLambda detects account already in Quarantine
3. Logs "QUARANTINE_SKIP" with reason "Account already in Quarantine status"
4. Returns success (no duplicate action)

### Scenario 5: Error Handling & DLQ

**Trigger**: Simulate failure by revoking IAM permissions temporarily

**Expected Behavior**:
1. Lambda fails with AccessDenied error
2. Error logged with stack trace
3. SQS retries (up to 5 times)
4. After 5 failures, event moves to DLQ
5. DLQ contains original event payload

**Verification**:
```bash
# Check DLQ message count
aws sqs get-queue-attributes \
  --queue-url <dlq-url> \
  --attribute-names ApproximateNumberOfMessages

# Read DLQ message
aws sqs receive-message \
  --queue-url <dlq-url> \
  --max-number-of-messages 1
```

## CloudWatch Logs

### QuarantineLambda Log Actions

| Action | Description |
|--------|-------------|
| `QUARANTINE_START` | Event processing started |
| `QUARANTINE_COMPLETE` | Account moved to Quarantine OU |
| `QUARANTINE_SKIP` | Processing skipped (already quarantined, non-CleanUp source, etc.) |
| `SCHEDULER_CREATED` | EventBridge Scheduler created |
| `SCHEDULER_CREATE_FAILED` | Scheduler creation failed |
| `HANDLER_ERROR` | Handler error with stack trace |

### UnquarantineLambda Log Actions

| Action | Description |
|--------|-------------|
| `UNQUARANTINE_START` | Event processing started |
| `UNQUARANTINE_COMPLETE` | Account moved to Available OU |
| `UNQUARANTINE_SKIP` | Processing skipped (already available, not in quarantine, etc.) |
| `SCHEDULER_DELETED` | EventBridge Scheduler deleted |
| `SCHEDULER_DELETE_FAILED` | Scheduler deletion failed |
| `HANDLER_ERROR` | Handler error with stack trace |

## X-Ray Tracing

Both Lambdas have X-Ray tracing enabled. To view traces:

1. Open AWS X-Ray console
2. Navigate to "Service Map" or "Traces"
3. Filter by service name containing "isb-billing-sep"
4. View trace details for cross-service visibility

## Troubleshooting

### Event Not Reaching QuarantineLambda

1. Check OrgMgmtStack EventBridge rule is enabled
2. Verify cross-account event bus policy allows OrgMgmt to PutEvents
3. Check EventBridge rule DLQ for delivery failures
4. Verify SQS queue is receiving messages

### Account Not Moving to Quarantine

1. Check QuarantineLambda logs for errors
2. Verify IAM role has STS:AssumeRole permission for intermediate role
3. Check cross-account role chain is configured correctly
4. Verify source OU is CleanUp (not Active, Available, etc.)

### Scheduler Not Firing

1. Check scheduler exists in correct group
2. Verify scheduler execution role has Lambda invoke permission
3. Check scheduler time expression is correct
4. Review EventBridge Scheduler execution history

### DynamoDB Update Failing

1. Check Lambda has DynamoDB permissions
2. Verify table name in environment variables
3. Check account exists in DynamoDB table

## Clean Stack Removal

The billing separator can be completely removed using CDK destroy:

```bash
# Destroy both stacks
cdk destroy --all

# Or destroy individually (OrgMgmt first since Hub has dependencies)
cdk destroy isb-billing-separator-org-mgmt-<env>
cdk destroy isb-billing-separator-hub-<env>
```

**What Gets Deleted**:
- Lambda functions and log groups
- SQS queues and DLQs
- EventBridge rules and event bus
- EventBridge Scheduler group (and all schedules in it)
- CloudWatch alarms and metric filters
- SNS topic and subscriptions
- IAM roles and policies

**What Remains**:
- Accounts in their current OU positions (no automatic moves)
- DynamoDB records (ISB's table, not modified)
- ISB continues operating normally

## Account Reconciliation

If you need to reconcile accounts after removing the billing separator or recovering from failures:

### Identifying Stuck Accounts

**Option 1: AWS Console**
1. Navigate to AWS Organizations
2. Open the Quarantine OU
3. List all accounts currently in Quarantine

**Option 2: AWS CLI**
```bash
# List all accounts in Quarantine OU
aws organizations list-children \
  --parent-id <quarantine-ou-id> \
  --child-type ACCOUNT
```

**Option 3: CloudWatch Insights Query**
```sql
-- Find accounts that were quarantined more than 80 hours ago
fields @timestamp, @message
| filter action = "QUARANTINE_COMPLETE"
| stats latest(@timestamp) as lastQuarantined by accountId
| filter lastQuarantined < ago(80h)
```

### Manual Account Recovery

To move stuck accounts from Quarantine to Available:

**Using AWS Console**:
1. Navigate to AWS Organizations
2. Select the account in Quarantine OU
3. Click "Actions" → "Move"
4. Select "Available" OU as destination
5. Confirm the move

**Using AWS CLI**:
```bash
# Move account from Quarantine to Available
aws organizations move-account \
  --account-id <12-digit-account-id> \
  --source-parent-id <quarantine-ou-id> \
  --destination-parent-id <available-ou-id>
```

**Update DynamoDB Status** (if needed):
```bash
# Update account status in ISB table
aws dynamodb update-item \
  --table-name <account-table-name> \
  --key '{"awsAccountId": {"S": "<account-id>"}}' \
  --update-expression 'SET #status = :status' \
  --expression-attribute-names '{"#status": "status"}' \
  --expression-attribute-values '{":status": {"S": "Available"}}'
```

### Cleaning Up Orphaned Schedulers

If schedulers remain after manual reconciliation:

```bash
# List all schedulers in the group
aws scheduler list-schedules \
  --group-name isb-billing-separator

# Delete a specific scheduler
aws scheduler delete-schedule \
  --name <scheduler-name> \
  --group-name isb-billing-separator
```

### Verify ISB Functionality

After reconciliation, verify ISB continues to work:

1. Request a new sandbox account
2. Verify account is created and moves through the expected OUs
3. Complete a sandbox lifecycle and verify cleanup works
4. Confirm no billing separator interference occurs
