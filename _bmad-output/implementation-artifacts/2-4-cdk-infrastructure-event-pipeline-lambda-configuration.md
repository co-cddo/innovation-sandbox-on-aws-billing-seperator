# Story 2.4: CDK Infrastructure - Event Pipeline & Lambda Configuration

Status: done

## Story

As a **Developer**,
I want **the complete CDK infrastructure for the billing separator**,
So that **the Lambda handlers can be deployed and invoked by events**.

## Acceptance Criteria

1. **AC1: EventBridge Rule Configuration**
   - Given the CDK stack from Epic 1
   - When the EventBridge rule is configured
   - Then it matches CloudTrail events with `source: aws.organizations`, `eventName: MoveAccount`, `destinationParentId: {Available OU ID}` (FR1, FR13)
   - And the rule has its own DLQ for delivery failures (FR38)

2. **AC2: SQS Queue Configuration**
   - Given the EventBridge rule is configured
   - When the SQS queue is created
   - Then it buffers events between EventBridge and QuarantineLambda (FR14)
   - And it has a DLQ configured with 5 receive attempts before DLQ (FR27)
   - And failed events are preserved in DLQ for investigation (FR28)

3. **AC3: QuarantineLambda Configuration**
   - Given Lambda functions are configured
   - When QuarantineLambda is created
   - Then runtime is Node.js 22.x, architecture is arm64, memory is 1024MB
   - And timeout is 30 seconds (NFR-P1)
   - And X-Ray tracing is enabled (NFR-O5)
   - And log format is JSON with 30-day retention
   - And environment variables include: `ACCOUNT_TABLE_NAME`, `SANDBOX_OU_ID`, `INTERMEDIATE_ROLE_ARN`, `ORG_MGT_ROLE_ARN`, `SCHEDULER_ROLE_ARN` (FR26, FR36)

4. **AC4: UnquarantineLambda Configuration**
   - Given Lambda functions are configured
   - When UnquarantineLambda is created
   - Then it has the same configuration as QuarantineLambda
   - And it additionally has `SCHEDULER_GROUP` environment variable

5. **AC5: EventBridge Scheduler Group**
   - Given the Scheduler group is created
   - When `isb-billing-separator` group exists
   - Then QuarantineLambda has permission to create schedules in this group
   - And UnquarantineLambda has permission to delete schedules in this group
   - And a Scheduler execution role exists that can invoke UnquarantineLambda

6. **AC6: IAM Roles Configuration**
   - Given IAM roles are configured
   - When Lambda execution roles are created
   - Then they follow least-privilege principle (NFR-S1)
   - And they can assume the intermediate role for cross-account access (FR31)
   - And they have DynamoDB read access for account table
   - And write access is limited to account status attribute only (NFR-S3)

7. **AC7: CDK Assertion Tests**
   - Given CDK assertion tests exist
   - When `test/billing-separator-stack.test.ts` is run
   - Then EventBridge rule with correct pattern is verified
   - And SQS queue with DLQ is verified
   - And Both Lambda functions with correct config are verified
   - And IAM roles with appropriate permissions are verified
   - And Scheduler group exists

## Tasks / Subtasks

- [x] **Task 1: Update CDK Stack Shell** (AC: #1, #2)
  - [x] 1.1 Enhance `lib/hub-stack.ts` with full infrastructure
  - [x] 1.2 Add props interface for stack configuration
  - [x] 1.3 Configure CDK context reading for environment variables

- [x] **Task 2: Configure SQS Queues** (AC: #2)
  - [x] 2.1 Create main event queue with appropriate visibility timeout
  - [x] 2.2 Create DLQ with 14-day message retention
  - [x] 2.3 Configure maxReceiveCount = 5 for retry before DLQ
  - [x] 2.4 Add queue policy for EventBridge delivery

- [x] **Task 3: Configure EventBridge Rule** (AC: #1)
  - [x] 3.1 Create EventBridge rule matching CloudTrail MoveAccount events
  - [x] 3.2 Add filter for destinationParentId = Available OU ID
  - [x] 3.3 Create DLQ for EventBridge rule delivery failures
  - [x] 3.4 Configure SQS as rule target with DLQ

- [x] **Task 4: Configure QuarantineLambda** (AC: #3)
  - [x] 4.1 Create NodejsFunction with esbuild bundling
  - [x] 4.2 Configure runtime: Node.js 22.x, architecture: arm64
  - [x] 4.3 Configure memory: 1024MB, timeout: 30 seconds
  - [x] 4.4 Enable X-Ray tracing
  - [x] 4.5 Configure JSON log format with 30-day retention
  - [x] 4.6 Set environment variables from stack props/context

- [x] **Task 5: Configure UnquarantineLambda** (AC: #4)
  - [x] 5.1 Create NodejsFunction with same config as QuarantineLambda
  - [x] 5.2 Add SCHEDULER_GROUP environment variable
  - [x] 5.3 Configure direct invocation (no SQS trigger)

- [x] **Task 6: Configure EventBridge Scheduler** (AC: #5)
  - [x] 6.1 Create Scheduler group `isb-billing-separator`
  - [x] 6.2 Create Scheduler execution IAM role
  - [x] 6.3 Grant role permission to invoke UnquarantineLambda
  - [x] 6.4 Grant QuarantineLambda permission to create schedules
  - [x] 6.5 Grant UnquarantineLambda permission to delete schedules

- [x] **Task 7: Configure IAM Roles** (AC: #6)
  - [x] 7.1 Lambda execution roles created automatically by NodejsFunction
  - [x] 7.2 Lambda execution role for UnquarantineLambda created
  - [x] 7.3 Grant STS:AssumeRole for intermediate role
  - [x] 7.4 Grant DynamoDB:GetItem for account table
  - [x] 7.5 DynamoDB access granted (read-only for status checks)
  - [x] 7.6 Follow least-privilege principle

- [x] **Task 8: Connect Event Sources** (AC: #1, #2, #3)
  - [x] 8.1 Add SQS trigger for QuarantineLambda
  - [x] 8.2 Configure batch size and partial batch response
  - [x] 8.3 Configure Lambda via SqsEventSource

- [x] **Task 9: Create CDK Assertion Tests** (AC: #7)
  - [x] 9.1 Update `test/billing-separator-stack.test.ts`
  - [x] 9.2 Test EventBridge rule pattern
  - [x] 9.3 Test SQS queue configuration
  - [x] 9.4 Test Lambda function configuration
  - [x] 9.5 Test IAM role permissions
  - [x] 9.6 Test Scheduler group existence

- [x] **Task 10: Final Validation** (AC: all)
  - [x] 10.1 Run `npm run validate` for full validation
  - [x] 10.2 All 76 tests pass
  - [x] 10.3 Build completes successfully

## Dev Notes

### Critical Context

This story creates the complete CDK infrastructure connecting the Lambdas from Stories 2.2 and 2.3. Key requirements:
1. EventBridge rule filters CloudTrail MoveAccount events destined for Available OU
2. SQS buffers events for retry capability
3. Two-layer DLQ: EventBridge rule DLQ + SQS DLQ
4. EventBridge Scheduler group for delayed Lambda invocation
5. Cross-account IAM for Organizations API access

### Architecture Reference

```
CloudTrail MoveAccount Event
    ↓
EventBridge Rule (filter: destinationParentId = Available OU)
    ↓ (with DLQ for delivery failures)
SQS Queue (with DLQ, maxReceiveCount = 5)
    ↓
QuarantineLambda
    ├── Read: DynamoDB (account status)
    ├── Write: Organizations API (move to Quarantine)
    └── Write: EventBridge Scheduler (create schedule)
    ↓
[72 hours later]
    ↓
EventBridge Scheduler
    ↓
UnquarantineLambda
    ├── Read: DynamoDB (account status)
    ├── Write: Organizations API (move to Available)
    └── Write: EventBridge Scheduler (delete schedule)
```

### Stack Props Interface

```typescript
interface BillingSeparatorStackProps extends StackProps {
  // ISB Configuration
  accountTableName: string;
  sandboxOuId: string;
  availableOuId: string;
  cleanupOuId: string;
  quarantineOuId: string;

  // Cross-Account IAM
  intermediateRoleArn: string;
  orgMgtRoleArn: string;

  // Alerting
  snsAlertEmail?: string;

  // Environment
  environment: 'dev' | 'staging' | 'prod';
}
```

### EventBridge Rule Pattern

```typescript
const rule = new events.Rule(this, 'MoveAccountRule', {
  eventPattern: {
    source: ['aws.organizations'],
    detailType: ['AWS API Call via CloudTrail'],
    detail: {
      eventSource: ['organizations.amazonaws.com'],
      eventName: ['MoveAccount'],
      requestParameters: {
        destinationParentId: [props.availableOuId],
      },
    },
  },
});
```

### Lambda Configuration

```typescript
const quarantineLambda = new NodejsFunction(this, 'QuarantineLambda', {
  runtime: Runtime.NODEJS_22_X,
  architecture: Architecture.ARM_64,
  memorySize: 1024,
  timeout: Duration.seconds(30),
  tracing: Tracing.ACTIVE,
  logFormat: LogFormat.JSON,
  logRetention: RetentionDays.ONE_MONTH,
  entry: path.join(__dirname, '../source/lambdas/quarantine/handler.ts'),
  handler: 'handler',
  environment: {
    ACCOUNT_TABLE_NAME: props.accountTableName,
    SANDBOX_OU_ID: props.sandboxOuId,
    INTERMEDIATE_ROLE_ARN: props.intermediateRoleArn,
    ORG_MGT_ROLE_ARN: props.orgMgtRoleArn,
    SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
  },
  bundling: {
    externalModules: ['@aws-sdk/*'],
  },
});
```

### Scheduler IAM Role

```typescript
const schedulerRole = new iam.Role(this, 'SchedulerRole', {
  assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
  description: 'IAM role for EventBridge Scheduler to invoke UnquarantineLambda',
});

unquarantineLambda.grantInvoke(schedulerRole);
```

### Cross-Account IAM Configuration

```typescript
// Grant Lambda permission to assume intermediate role
lambdaRole.addToPolicy(new iam.PolicyStatement({
  actions: ['sts:AssumeRole'],
  resources: [props.intermediateRoleArn],
}));

// Grant DynamoDB access (read-only for status checks)
accountTable.grantReadData(lambdaRole);

// Grant DynamoDB UpdateItem with condition (status field only)
lambdaRole.addToPolicy(new iam.PolicyStatement({
  actions: ['dynamodb:UpdateItem'],
  resources: [accountTable.tableArn],
  conditions: {
    'ForAllValues:StringEquals': {
      'dynamodb:Attributes': ['status', 'awsAccountId'],
    },
  },
}));
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4]
- [AWS CDK NodejsFunction](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_lambda_nodejs.NodejsFunction.html)
- [AWS CDK EventBridge](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_events.Rule.html)
- [AWS CDK Scheduler](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_scheduler.CfnScheduleGroup.html)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- Fixed ESM __dirname issue using `import.meta.url` and `fileURLToPath`
- Fixed CDK construct naming collision (SchedulerGroup output → SchedulerGroupName)

### Completion Notes List

1. Complete CDK infrastructure with all 7 ACs implemented
2. Custom event bus receives forwarded events from OrgMgmtStack
3. Two-layer DLQ: EventBridge rule DLQ + SQS DLQ
4. NodejsFunction uses esbuild for fast bundling
5. IAM follows least-privilege (STS:AssumeRole, DynamoDB read, Scheduler create/delete)
6. 23 new CDK assertion tests added
7. All 76 tests pass across 5 test suites

### File List

**Modified:**
- `lib/hub-stack.ts` - Enhanced with full infrastructure (380+ lines)
- `bin/billing-separator.ts` - Updated to pass new HubStack props
- `test/billing-separator.test.ts` - Added CDK assertion tests (370+ lines)

### Change Log

- 2026-01-28: Story file created, status: ready-for-dev
- 2026-01-28: Complete CDK infrastructure implemented
- 2026-01-28: All 76 tests pass, build successful
- 2026-01-28: Story marked done
