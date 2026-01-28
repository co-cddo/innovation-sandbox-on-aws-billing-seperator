# Story 3.2: CloudWatch Alarms - Failure Detection

Status: done

## Story

As an **ISB Platform Operator**,
I want **to be alerted when event processing fails**,
So that **I can investigate and resolve issues before they impact billing isolation**.

## Acceptance Criteria

1. **AC1: DLQ Alarm**
   - Given the SQS DLQ from Epic 2
   - When the DLQ alarm is created
   - Then it triggers when `ApproximateNumberOfMessagesVisible >= 3` (FR18)
   - And it evaluates over 5-minute periods
   - And it sends notification to SNS topic
   - And alarm description explains: "Event processing failures - investigate DLQ"

2. **AC2: Lambda Error Alarms**
   - Given the Lambda functions from Epic 2
   - When Lambda error alarms are created
   - Then QuarantineLambda error alarm triggers when `Errors >= 3` in 5 minutes
   - And UnquarantineLambda error alarm triggers when `Errors >= 3` in 5 minutes
   - And both alarms send notifications to SNS topic
   - And alarm descriptions include the Lambda function name

3. **AC3: Structured Logging**
   - Given structured logging is configured in handlers (Epic 2)
   - When errors occur
   - Then error details including stack trace are logged (FR30)
   - And logs include `action="HANDLER_ERROR"` for easy filtering
   - And logs include accountId for correlation

4. **AC4: CDK Assertion Tests**
   - Given alarms are deployed
   - When CDK assertion tests run
   - Then DLQ alarm with correct threshold is verified
   - And Lambda error alarms for both functions are verified
   - And All alarms have SNS topic as action

## Tasks / Subtasks

- [x] **Task 1: Create DLQ Alarm** (AC: #1)
  - [x] 1.1 Add CloudWatch alarm for event DLQ messages
  - [x] 1.2 Configure threshold >= 3 messages
  - [x] 1.3 Configure 5-minute evaluation period
  - [x] 1.4 Add SNS topic as alarm action

- [x] **Task 2: Create QuarantineLambda Error Alarm** (AC: #2)
  - [x] 2.1 Add CloudWatch alarm for QuarantineLambda errors
  - [x] 2.2 Configure threshold >= 3 errors
  - [x] 2.3 Configure 5-minute evaluation period
  - [x] 2.4 Add SNS topic as alarm action

- [x] **Task 3: Create UnquarantineLambda Error Alarm** (AC: #2)
  - [x] 3.1 Add CloudWatch alarm for UnquarantineLambda errors
  - [x] 3.2 Configure threshold >= 3 errors
  - [x] 3.3 Configure 5-minute evaluation period
  - [x] 3.4 Add SNS topic as alarm action

- [x] **Task 4: Verify Structured Logging** (AC: #3)
  - [x] 4.1 Handlers already log HANDLER_ERROR action (from Stories 2.2/2.3)
  - [x] 4.2 Stack traces already included in error logs
  - [x] 4.3 accountId already included in all logs

- [x] **Task 5: Add CDK Assertion Tests** (AC: #4)
  - [x] 5.1 Test DLQ alarm with correct threshold
  - [x] 5.2 Test QuarantineLambda error alarm
  - [x] 5.3 Test UnquarantineLambda error alarm
  - [x] 5.4 Test alarms have SNS action configured

- [x] **Task 6: Final Validation** (AC: all)
  - [x] 6.1 Run `npm run validate`
  - [x] 6.2 All 85 tests pass
  - [x] 6.3 CDK synth generates valid template

## Dev Notes

### CloudWatch Alarm Configuration

```typescript
// lib/hub-stack.ts

import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';

// DLQ alarm (FR18)
const dlqAlarm = new cloudwatch.Alarm(this, 'DLQAlarm', {
  alarmName: `${this.resourcePrefix}-dlq-alarm-${props.environment}`,
  alarmDescription: 'Event processing failures - investigate DLQ',
  metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
    period: cdk.Duration.minutes(5),
  }),
  threshold: 3,
  evaluationPeriods: 1,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});
dlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));

// QuarantineLambda error alarm
const quarantineErrorAlarm = new cloudwatch.Alarm(this, 'QuarantineErrorAlarm', {
  alarmName: `${this.resourcePrefix}-quarantine-errors-${props.environment}`,
  alarmDescription: 'QuarantineLambda experiencing errors - check logs',
  metric: this.quarantineLambda.metricErrors({
    period: cdk.Duration.minutes(5),
  }),
  threshold: 3,
  evaluationPeriods: 1,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});
quarantineErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));

// UnquarantineLambda error alarm
const unquarantineErrorAlarm = new cloudwatch.Alarm(this, 'UnquarantineErrorAlarm', {
  alarmName: `${this.resourcePrefix}-unquarantine-errors-${props.environment}`,
  alarmDescription: 'UnquarantineLambda experiencing errors - check logs',
  metric: this.unquarantineLambda.metricErrors({
    period: cdk.Duration.minutes(5),
  }),
  threshold: 3,
  evaluationPeriods: 1,
  comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
});
unquarantineErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));
```

### Structured Logging Verification

Handlers already implement structured logging with:
- `action="HANDLER_ERROR"` for errors
- `stack` property with stack trace
- `accountId` for correlation
- `timestamp` for timing

### References

- [Source: _bmad-output/planning-artifacts/architecture.md]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2]
- [AWS CDK CloudWatch Alarm](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_cloudwatch.Alarm.html)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

No issues encountered during implementation.

### Completion Notes List

1. Three CloudWatch alarms created: DLQ, QuarantineLambda errors, UnquarantineLambda errors
2. All alarms use 5-minute period with threshold >= 3
3. All alarms have SNS topic as alarm action
4. TreatMissingData set to NOT_BREACHING to avoid false positives
5. Structured logging already verified from Stories 2.2/2.3
6. 4 new CDK assertion tests added
7. All 85 tests pass

### File List

**Modified:**
- `lib/hub-stack.ts` - Add 3 CloudWatch alarms with SNS actions
- `test/billing-separator.test.ts` - Add 4 alarm tests

### Change Log

- 2026-01-28: Story file created, status: ready-for-dev
- 2026-01-28: Implemented CloudWatch alarms for DLQ and Lambda errors
- 2026-01-28: All 85 tests pass, story marked done
