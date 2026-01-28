# Story 3.1: SNS Alert Topic & Subscription

Status: done

## Story

As an **ISB Platform Operator**,
I want **an SNS topic that receives all billing separator alerts**,
So that **I am notified when issues require my attention**.

## Acceptance Criteria

1. **AC1: SNS Topic Creation**
   - Given the CDK stack from Epic 2
   - When the SNS topic is created
   - Then it is named `isb-billing-separator-alerts`
   - And it follows the `isb-billing-sep-` resource prefix convention

2. **AC2: Email Subscription**
   - Given the SNS topic exists
   - When a subscription is configured
   - Then email subscription is created using `snsAlertEmail` from CDK context (FR21)
   - And the email address is configurable per environment

3. **AC3: IAM Permissions**
   - Given the SNS topic exists
   - When IAM permissions are configured
   - Then CloudWatch Alarms can publish to the topic
   - And no other principals can publish (least privilege)

4. **AC4: Notification Delivery**
   - Given the SNS topic is deployed
   - When an alarm triggers
   - Then the operator receives an email notification
   - And the notification includes alarm name, description, and timestamp

## Tasks / Subtasks

- [x] **Task 1: Create SNS Topic** (AC: #1)
  - [x] 1.1 Add SNS topic to HubStack
  - [x] 1.2 Use `isb-billing-sep-alerts-{env}` naming pattern
  - [x] 1.3 Default encryption provided by SNS

- [x] **Task 2: Configure Email Subscription** (AC: #2)
  - [x] 2.1 Add `snsAlertEmail` to HubStackProps
  - [x] 2.2 Add email context parameter to bin/billing-separator.ts
  - [x] 2.3 Create email subscription if email is provided
  - [x] 2.4 Make subscription optional (no email = no subscription)

- [x] **Task 3: Configure IAM Permissions** (AC: #3)
  - [x] 3.1 Add topic policy allowing CloudWatch alarms to publish
  - [x] 3.2 Restrict policy to only CloudWatch service principal
  - [x] 3.3 Add condition for same-account only

- [x] **Task 4: Update CDK Context Example** (AC: #2)
  - [x] 4.1 snsAlertEmail already in cdk.context.example.json
  - [x] 4.2 Parameter documented with description

- [x] **Task 5: Add CDK Assertion Tests** (AC: #1, #2, #3)
  - [x] 5.1 Test SNS topic creation with correct name
  - [x] 5.2 Test email subscription when email provided
  - [x] 5.3 Test no subscription when email not provided
  - [x] 5.4 Test topic policy allows CloudWatch

- [x] **Task 6: Final Validation** (AC: all)
  - [x] 6.1 Run `npm run validate`
  - [x] 6.2 All 81 tests pass
  - [x] 6.3 CDK synth generates valid template

## Dev Notes

### SNS Topic Configuration

```typescript
// lib/hub-stack.ts

// Add to HubStackProps
snsAlertEmail?: string; // Optional email for notifications

// Create SNS topic
this.alertTopic = new sns.Topic(this, 'AlertTopic', {
  topicName: `${this.resourcePrefix}-alerts-${props.environment}`,
  displayName: 'ISB Billing Separator Alerts',
});

// Add email subscription if configured
if (props.snsAlertEmail) {
  this.alertTopic.addSubscription(
    new snsSubscriptions.EmailSubscription(props.snsAlertEmail)
  );
}

// Topic policy for CloudWatch alarms
this.alertTopic.addToResourcePolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
  actions: ['sns:Publish'],
  resources: [this.alertTopic.topicArn],
  conditions: {
    StringEquals: {
      'AWS:SourceAccount': this.account,
    },
  },
}));
```

### CDK Context Example Update

```json
{
  "snsAlertEmail": "ops-team@example.com"
}
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1]
- [AWS CDK SNS Topic](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sns.Topic.html)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

No issues encountered during implementation.

### Completion Notes List

1. SNS topic created with proper naming convention
2. Email subscription is optional (only created when snsAlertEmail provided)
3. Topic policy allows only CloudWatch to publish (least privilege)
4. Same-account condition added to topic policy
5. 5 new CDK assertion tests added
6. All 81 tests pass

### File List

**Modified:**
- `lib/hub-stack.ts` - Add SNS topic, subscription, and topic policy
- `bin/billing-separator.ts` - Add snsAlertEmail context parameter
- `test/billing-separator.test.ts` - Add 5 SNS topic tests

### Change Log

- 2026-01-28: Story file created, status: ready-for-dev
- 2026-01-28: Implemented SNS topic with optional email subscription
- 2026-01-28: All 81 tests pass, story marked done
