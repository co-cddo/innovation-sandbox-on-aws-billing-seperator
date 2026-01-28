import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { HubStack } from '../lib/hub-stack.js';
import { OrgMgmtStack } from '../lib/org-mgmt-stack.js';
import { describe, it, expect, beforeEach } from '@jest/globals';

// Default props for HubStack tests
const defaultHubStackProps = {
  environment: 'test',
  accountTableName: 'isb-sandbox-accounts',
  sandboxOuId: 'ou-test-sandbox',
  availableOuId: 'ou-test-available',
  quarantineOuId: 'ou-test-quarantine',
  cleanupOuId: 'ou-test-cleanup',
  intermediateRoleArn: 'arn:aws:iam::123456789012:role/ISB-IntermediateRole',
  orgMgtRoleArn: 'arn:aws:iam::999888777666:role/ISB-OrgManagementRole',
  env: { account: '123456789012', region: 'us-west-2' },
};

describe('HubStack', () => {
  let app: cdk.App;
  let stack: HubStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new HubStack(app, 'TestHubStack', defaultHubStackProps);
    template = Template.fromStack(stack);
  });

  describe('given the stack is synthesized', () => {
    it('creates a CloudFormation stack', () => {
      const outputs = template.findOutputs('*');
      expect(Object.keys(outputs).length).toBeGreaterThan(0);
    });

    it('has the correct resource prefix output', () => {
      template.hasOutput('ResourcePrefix', {
        Value: 'isb-billing-sep',
      });
    });

    it('creates an EventBus for receiving forwarded events', () => {
      template.hasResourceProperties('AWS::Events::EventBus', {
        Name: 'isb-billing-sep-events-test',
      });
    });

    it('exports the EventBus ARN', () => {
      template.hasOutput('EventBusArn', {
        Export: {
          Name: 'isb-billing-sep-event-bus-arn-test',
        },
      });
    });
  });

  describe('given orgMgmtAccountId is provided in context', () => {
    beforeEach(() => {
      app = new cdk.App({
        context: {
          orgMgmtAccountId: '999888777666',
        },
      });
      stack = new HubStack(app, 'TestHubStackWithPolicy', defaultHubStackProps);
      template = Template.fromStack(stack);
    });

    it('creates an EventBus policy with specific event forwarder role principal', () => {
      // Uses specific role principal for least-privilege access
      // The role is created by OrgMgmtStack with predictable naming
      template.hasResourceProperties('AWS::Events::EventBusPolicy', {
        StatementId: 'AllowOrgMgmtEventForwarder',
        Statement: {
          Effect: 'Allow',
          Principal: {
            AWS: 'arn:aws:iam::999888777666:role/isb-billing-sep-event-forwarder-test',
          },
          Action: 'events:PutEvents',
        },
      });
    });

    it('restricts EventBus policy with condition keys for event source', () => {
      template.hasResourceProperties('AWS::Events::EventBusPolicy', {
        Statement: {
          Condition: {
            StringEquals: {
              'events:source': ['aws.organizations'],
              'events:detail-type': ['AWS API Call via CloudTrail'],
            },
          },
        },
      });
    });
  });

  describe('SQS Queues (FR14, FR27, FR28)', () => {
    it('creates an event queue with correct configuration', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'isb-billing-sep-event-queue-test',
      });
    });

    it('creates a dead letter queue for failed events', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'isb-billing-sep-event-dlq-test',
        MessageRetentionPeriod: 1209600, // 14 days in seconds
      });
    });

    it('configures SQS redrive policy with 5 receive attempts (FR27)', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'isb-billing-sep-event-queue-test',
        RedrivePolicy: Match.objectLike({
          maxReceiveCount: 5,
        }),
      });
    });
  });

  describe('Lambda Functions (FR3, FR6, NFR-P1, NFR-O5)', () => {
    it('creates QuarantineLambda with correct configuration', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'isb-billing-sep-quarantine-test',
        Runtime: 'nodejs22.x',
        Architectures: ['arm64'],
        MemorySize: 1024,
        Timeout: 30,
      });
    });

    it('creates UnquarantineLambda with correct configuration', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'isb-billing-sep-unquarantine-test',
        Runtime: 'nodejs22.x',
        Architectures: ['arm64'],
        MemorySize: 1024,
        Timeout: 30,
      });
    });

    it('enables X-Ray tracing on Lambda functions (NFR-O5)', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        TracingConfig: {
          Mode: 'Active',
        },
      });
    });

    it('configures QuarantineLambda with required environment variables', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'isb-billing-sep-quarantine-test',
        Environment: {
          Variables: Match.objectLike({
            ACCOUNT_TABLE_NAME: 'isb-sandbox-accounts',
            SANDBOX_OU_ID: 'ou-test-sandbox',
            AVAILABLE_OU_ID: 'ou-test-available',
            QUARANTINE_OU_ID: 'ou-test-quarantine',
            CLEANUP_OU_ID: 'ou-test-cleanup',
            INTERMEDIATE_ROLE_ARN: 'arn:aws:iam::123456789012:role/ISB-IntermediateRole',
            ORG_MGT_ROLE_ARN: 'arn:aws:iam::999888777666:role/ISB-OrgManagementRole',
            SCHEDULER_GROUP: 'isb-billing-separator',
          }),
        },
      });
    });
  });

  describe('EventBridge Scheduler (FR10, FR11)', () => {
    it('creates a scheduler group', () => {
      template.hasResourceProperties('AWS::Scheduler::ScheduleGroup', {
        Name: 'isb-billing-separator',
      });
    });

    it('creates a scheduler execution role', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        RoleName: 'isb-billing-sep-scheduler-role-test',
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: 'scheduler.amazonaws.com',
              },
            }),
          ]),
        },
      });
    });
  });

  describe('EventBridge Rule (FR1, FR13)', () => {
    it('creates an EventBridge rule on the custom event bus', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'isb-billing-sep-process-move-account-test',
        EventPattern: {
          source: ['aws.organizations'],
          'detail-type': ['AWS API Call via CloudTrail'],
          detail: {
            eventSource: ['organizations.amazonaws.com'],
            eventName: ['MoveAccount'],
            requestParameters: {
              destinationParentId: ['ou-test-available'],
            },
          },
        },
      });
    });

    it('creates a DLQ for EventBridge rule delivery failures (FR38)', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'isb-billing-sep-rule-dlq-test',
      });
    });
  });

  describe('IAM Permissions (NFR-S1, FR31)', () => {
    it('grants Lambda permission to assume intermediate role (FR31)', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Resource: 'arn:aws:iam::123456789012:role/ISB-IntermediateRole',
            }),
          ]),
        },
      });
    });

    it('grants Lambda permission to create schedules', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'scheduler:CreateSchedule',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    it('grants Lambda permission to delete schedules', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'scheduler:DeleteSchedule',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });
  });

  describe('SNS Alert Topic (FR21)', () => {
    it('creates an SNS alert topic with correct name', () => {
      template.hasResourceProperties('AWS::SNS::Topic', {
        TopicName: 'isb-billing-sep-alerts-test',
        DisplayName: 'ISB Billing Separator Alerts',
      });
    });

    it('creates SNS topic policy allowing CloudWatch to publish', () => {
      template.hasResourceProperties('AWS::SNS::TopicPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sns:Publish',
              Effect: 'Allow',
              Principal: {
                Service: 'cloudwatch.amazonaws.com',
              },
            }),
          ]),
        },
      });
    });

    it('outputs the alert topic ARN', () => {
      template.hasOutput('AlertTopicArn', Match.objectLike({}));
    });
  });

  describe('SNS Email Subscription', () => {
    it('creates email subscription when snsAlertEmail is provided', () => {
      const appWithEmail = new cdk.App();
      const stackWithEmail = new HubStack(appWithEmail, 'TestHubStackWithEmail', {
        ...defaultHubStackProps,
        snsAlertEmail: 'test@example.com',
      });
      const templateWithEmail = Template.fromStack(stackWithEmail);

      templateWithEmail.hasResourceProperties('AWS::SNS::Subscription', {
        Protocol: 'email',
        Endpoint: 'test@example.com',
      });
    });

    it('does not create email subscription when snsAlertEmail is not provided', () => {
      // The default test stack doesn't have snsAlertEmail
      const subscriptions = template.findResources('AWS::SNS::Subscription', {
        Properties: {
          Protocol: 'email',
        },
      });
      expect(Object.keys(subscriptions).length).toBe(0);
    });
  });

  describe('CloudWatch Alarms (FR18, FR30)', () => {
    it('creates DLQ alarm with correct threshold', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'isb-billing-sep-dlq-alarm-test',
        Threshold: 3,
        EvaluationPeriods: 1,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
        TreatMissingData: 'notBreaching',
      });
    });

    it('creates QuarantineLambda error alarm with correct threshold', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'isb-billing-sep-quarantine-errors-test',
        Threshold: 3,
        EvaluationPeriods: 1,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      });
    });

    it('creates UnquarantineLambda error alarm with correct threshold', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'isb-billing-sep-unquarantine-errors-test',
        Threshold: 3,
        EvaluationPeriods: 1,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      });
    });

    it('connects DLQ alarm to SNS topic', () => {
      // Verify at least one alarm has AlarmActions
      const alarms = template.findResources('AWS::CloudWatch::Alarm', {
        Properties: {
          AlarmName: 'isb-billing-sep-dlq-alarm-test',
        },
      });
      const alarmIds = Object.keys(alarms);
      expect(alarmIds.length).toBe(1);

      // Verify the alarm has actions configured
      const alarm = alarms[alarmIds[0]];
      expect(alarm.Properties.AlarmActions).toBeDefined();
      expect(alarm.Properties.AlarmActions.length).toBeGreaterThan(0);
    });
  });

  describe('Operational Anomaly Alarms (FR17, FR19)', () => {
    it('creates metric filter for quarantine success tracking', () => {
      template.hasResourceProperties('AWS::Logs::MetricFilter', {
        FilterPattern: '{ $.action = "QUARANTINE_COMPLETE" }',
        MetricTransformations: Match.arrayWith([
          Match.objectLike({
            MetricNamespace: 'ISB/BillingSeparator',
            MetricName: 'QuarantineSuccessCount',
            MetricValue: '1',
          }),
        ]),
      });
    });

    it('creates metric filter for unquarantine success tracking', () => {
      template.hasResourceProperties('AWS::Logs::MetricFilter', {
        FilterPattern: '{ $.action = "UNQUARANTINE_COMPLETE" }',
        MetricTransformations: Match.arrayWith([
          Match.objectLike({
            MetricNamespace: 'ISB/BillingSeparator',
            MetricName: 'UnquarantineSuccessCount',
            MetricValue: '1',
          }),
        ]),
      });
    });

    it('creates Rule DLQ alarm for event routing failures', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'isb-billing-sep-rule-dlq-alarm-test',
        Threshold: 1,
        EvaluationPeriods: 1,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      });
    });
  });
});

describe('OrgMgmtStack', () => {
  let app: cdk.App;
  let stack: OrgMgmtStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new OrgMgmtStack(app, 'TestOrgMgmtStack', {
      environment: 'test',
      hubAccountId: '123456789012',
      hubEventBusArn: 'arn:aws:events:us-west-2:123456789012:event-bus/isb-billing-sep-events-test',
      availableOuId: 'ou-test-available',
      env: { account: '999888777666', region: 'us-east-1' },
    });
    template = Template.fromStack(stack);
  });

  describe('given the stack is synthesized', () => {
    it('creates a CloudFormation stack', () => {
      const outputs = template.findOutputs('*');
      expect(Object.keys(outputs).length).toBeGreaterThan(0);
    });

    it('has the correct resource prefix output', () => {
      template.hasOutput('ResourcePrefix', {
        Value: 'isb-billing-sep',
      });
    });

    it('creates an EventBridge rule for MoveAccount events', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Name: 'isb-billing-sep-capture-move-to-available-test',
        Description: Match.stringLikeRegexp('MoveAccount'),
        EventPattern: {
          source: ['aws.organizations'],
          'detail-type': ['AWS API Call via CloudTrail'],
          detail: {
            eventSource: ['organizations.amazonaws.com'],
            eventName: ['MoveAccount'],
            requestParameters: {
              destinationParentId: ['ou-test-available'],
            },
          },
        },
      });
    });

    it('creates an IAM role for cross-account event forwarding', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        RoleName: 'isb-billing-sep-event-forwarder-test',
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: 'events.amazonaws.com',
              },
            }),
          ]),
        },
      });
    });

    it('grants the IAM role permission to put events on Hub bus', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'events:PutEvents',
              Effect: 'Allow',
              Resource: 'arn:aws:events:us-west-2:123456789012:event-bus/isb-billing-sep-events-test',
            }),
          ]),
        },
      });
    });
  });
});

describe('Multi-Stack Integration', () => {
  it('OrgMgmtStack references HubStack eventBus ARN', () => {
    const app = new cdk.App();

    const hubStack = new HubStack(app, 'IntegrationHubStack', defaultHubStackProps);

    const orgMgmtStack = new OrgMgmtStack(app, 'IntegrationOrgMgmtStack', {
      environment: 'test',
      hubAccountId: '123456789012',
      hubEventBusArn: hubStack.eventBus.eventBusArn,
      availableOuId: 'ou-test-available',
      env: { account: '999888777666', region: 'us-east-1' },
    });

    // Verify both stacks are properly configured
    expect(hubStack.eventBus).toBeDefined();
    expect(orgMgmtStack).toBeDefined();
  });

  it('HubStack and OrgMgmtStack deploy to correct regions', () => {
    const app = new cdk.App();

    const hubStack = new HubStack(app, 'RegionHubStack', defaultHubStackProps);

    const orgMgmtStack = new OrgMgmtStack(app, 'RegionOrgMgmtStack', {
      environment: 'test',
      hubAccountId: '123456789012',
      hubEventBusArn: hubStack.eventBus.eventBusArn,
      availableOuId: 'ou-test-available',
      env: { account: '999888777666', region: 'us-east-1' },
    });

    // Verify region configuration
    expect(hubStack.region).toBe('us-west-2');
    expect(orgMgmtStack.region).toBe('us-east-1');
  });

  it('OrgMgmtStack has dependency on HubStack for deployment ordering', () => {
    const app = new cdk.App();

    const hubStack = new HubStack(app, 'DependencyHubStack', defaultHubStackProps);

    const orgMgmtStack = new OrgMgmtStack(app, 'DependencyOrgMgmtStack', {
      environment: 'test',
      hubAccountId: '123456789012',
      hubEventBusArn: hubStack.eventBus.eventBusArn,
      availableOuId: 'ou-test-available',
      env: { account: '999888777666', region: 'us-east-1' },
    });

    // Add dependency
    orgMgmtStack.addDependency(hubStack);

    // Verify the dependency is registered in CDK
    const assembly = app.synth();
    const orgMgmtTemplate = assembly.getStackByName('DependencyOrgMgmtStack');

    // Check that the stack has a dependency - dependencies is an array of stack artifacts
    interface StackDependency {
      id?: string;
      stackName?: string;
    }
    const dependencyNames = orgMgmtTemplate.dependencies.map(
      (dep: StackDependency) => dep.id || dep.stackName
    );
    expect(dependencyNames).toContain('DependencyHubStack');
  });
});
