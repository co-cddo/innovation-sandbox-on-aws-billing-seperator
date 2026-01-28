import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Hub Stack Properties
 */
export interface HubStackProps extends cdk.StackProps {
  /** Environment name (dev/staging/prod) */
  environment: string;
  /** Name of the ISB DynamoDB table storing sandbox account records */
  accountTableName: string;
  /** ID of the parent Innovation Sandbox OU */
  sandboxOuId: string;
  /** ID of the Available OU - destination that triggers quarantine */
  availableOuId: string;
  /** ID of the Quarantine OU - where accounts are held for 72 hours */
  quarantineOuId: string;
  /** ID of the CleanUp OU - only accounts FROM this OU are quarantined */
  cleanupOuId: string;
  /** ARN of the ISB intermediate role in Hub account for role chaining */
  intermediateRoleArn: string;
  /** ARN of the ISB role in Org Management account */
  orgMgtRoleArn: string;
  /** Email address for SNS alert notifications (optional) */
  snsAlertEmail?: string;
  /** ARN of KMS key encrypting the DynamoDB table (optional - required if table uses CMK) */
  accountTableKmsKeyArn?: string;
}

/**
 * ISB Billing Separator Hub Stack
 *
 * Deploys to: Hub Account (us-west-2)
 *
 * This is the main compute stack for the billing separator. It contains:
 * - Custom event bus for receiving forwarded MoveAccount events
 * - EventBridge rule matching events destined for Available OU
 * - SQS queues for event buffering with DLQ
 * - Lambda functions (QuarantineLambda, UnquarantineLambda)
 * - EventBridge Scheduler group for delayed releases
 * - IAM roles with least-privilege permissions
 * - SNS topic for operational alerts
 */
export class HubStack extends cdk.Stack {
  /** Resource prefix for all resources (FR25) */
  public readonly resourcePrefix = 'isb-billing-sep';

  /** Event bus for receiving forwarded events from OrgMgmtStack */
  public readonly eventBus: events.IEventBus;

  /** SQS queue for buffering events */
  public readonly eventQueue: sqs.Queue;

  /** SQS DLQ for failed events */
  public readonly deadLetterQueue: sqs.Queue;

  /** QuarantineLambda function */
  public readonly quarantineLambda: lambda.Function;

  /** UnquarantineLambda function */
  public readonly unquarantineLambda: lambda.Function;

  /** Scheduler group for unquarantine schedules */
  public readonly schedulerGroup: scheduler.CfnScheduleGroup;

  /** SNS topic for operational alerts (FR21) */
  public readonly alertTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: HubStackProps) {
    super(scope, id, props);

    // Stack tags
    cdk.Tags.of(this).add('Project', 'isb-billing-separator');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    cdk.Tags.of(this).add('Environment', props.environment);

    // ========================================
    // Event Bus for Cross-Account Events
    // ========================================

    // Create a custom event bus for receiving forwarded MoveAccount events
    this.eventBus = new events.EventBus(this, 'BillingSeparatorEventBus', {
      eventBusName: `${this.resourcePrefix}-events-${props.environment}`,
    });

    // Allow only the specific OrgMgmt event forwarder role to put events on this bus
    // This follows least-privilege by restricting to the exact role created in OrgMgmtStack
    const orgMgmtAccountId = this.node.tryGetContext('orgMgmtAccountId');
    if (orgMgmtAccountId) {
      // Construct the specific role ARN using the known naming convention from OrgMgmtStack
      const eventForwarderRoleArn = `arn:aws:iam::${orgMgmtAccountId}:role/${this.resourcePrefix}-event-forwarder-${props.environment}`;

      new events.CfnEventBusPolicy(this, 'AllowOrgMgmtPutEvents', {
        eventBusName: this.eventBus.eventBusName,
        statementId: 'AllowOrgMgmtEventForwarder',
        statement: {
          Effect: 'Allow',
          Principal: {
            AWS: eventForwarderRoleArn,
          },
          Action: 'events:PutEvents',
          Resource: this.eventBus.eventBusArn,
          Condition: {
            StringEquals: {
              'events:source': ['aws.organizations'],
              'events:detail-type': ['AWS API Call via CloudTrail'],
            },
          },
        },
      });
    }

    // ========================================
    // SQS Queues (FR14, FR27, FR28)
    // ========================================

    // Dead Letter Queue for failed events (FR28)
    this.deadLetterQueue = new sqs.Queue(this, 'EventDLQ', {
      queueName: `${this.resourcePrefix}-event-dlq-${props.environment}`,
      retentionPeriod: cdk.Duration.days(14), // 14 days for investigation
      enforceSSL: true,
    });

    // Main event queue with DLQ (FR14, FR27)
    this.eventQueue = new sqs.Queue(this, 'EventQueue', {
      queueName: `${this.resourcePrefix}-event-queue-${props.environment}`,
      visibilityTimeout: cdk.Duration.seconds(60), // 2x Lambda timeout
      retentionPeriod: cdk.Duration.days(7),
      enforceSSL: true,
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount: 5, // FR27: 5 SQS receive attempts before DLQ
      },
    });

    // ========================================
    // EventBridge Scheduler Group (FR10, FR11)
    // ========================================

    this.schedulerGroup = new scheduler.CfnScheduleGroup(this, 'SchedulerGroup', {
      name: 'isb-billing-separator',
    });

    // ========================================
    // SNS Alert Topic (FR21)
    // ========================================

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

    // Topic policy: Allow CloudWatch alarms to publish (least privilege)
    this.alertTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.alertTopic.topicArn],
        conditions: {
          StringEquals: {
            'AWS:SourceAccount': this.account,
          },
        },
      })
    );

    // ========================================
    // IAM Roles
    // ========================================

    // Scheduler execution role - can invoke UnquarantineLambda
    const schedulerExecutionRole = new iam.Role(this, 'SchedulerExecutionRole', {
      roleName: `${this.resourcePrefix}-scheduler-role-${props.environment}`,
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: 'IAM role for EventBridge Scheduler to invoke UnquarantineLambda',
    });

    // ========================================
    // Lambda Functions (FR3, FR6, NFR-P1, NFR-O5)
    // ========================================

    // Common Lambda configuration
    const lambdaConfig = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30), // NFR-P1: 30-second timeout
      tracing: lambda.Tracing.ACTIVE, // NFR-O5: X-Ray tracing
      logFormat: lambda.LogFormat.JSON,
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'], // Use Lambda's built-in SDK
        // Resolve ISB commons imports from the submodule
        esbuildArgs: {
          '--alias:@amzn/innovation-sandbox-commons': './deps/isb/source/common',
        },
      },
    };

    // Environment variables shared by both Lambdas (FR26)
    const commonEnvVars = {
      ACCOUNT_TABLE_NAME: props.accountTableName,
      SANDBOX_OU_ID: props.sandboxOuId,
      AVAILABLE_OU_ID: props.availableOuId,
      QUARANTINE_OU_ID: props.quarantineOuId,
      CLEANUP_OU_ID: props.cleanupOuId,
      INTERMEDIATE_ROLE_ARN: props.intermediateRoleArn,
      ORG_MGT_ROLE_ARN: props.orgMgtRoleArn,
      USER_AGENT_EXTRA: 'isb-billing-separator/1.0.0',
    };

    // QuarantineLambda (FR1-5, FR10-12, FR34)
    this.quarantineLambda = new NodejsFunction(this, 'QuarantineLambda', {
      ...lambdaConfig,
      functionName: `${this.resourcePrefix}-quarantine-${props.environment}`,
      description: 'Intercepts accounts moving to Available OU and quarantines them for 72 hours',
      entry: path.join(__dirname, '../source/lambdas/quarantine/handler.ts'),
      handler: 'handler',
      environment: {
        ...commonEnvVars,
        SCHEDULER_GROUP: this.schedulerGroup.name!,
        SCHEDULER_ROLE_ARN: schedulerExecutionRole.roleArn,
        UNQUARANTINE_LAMBDA_ARN: '', // Will be updated after UnquarantineLambda is created
      },
    });

    // UnquarantineLambda (FR6-9, FR35)
    this.unquarantineLambda = new NodejsFunction(this, 'UnquarantineLambda', {
      ...lambdaConfig,
      functionName: `${this.resourcePrefix}-unquarantine-${props.environment}`,
      description: 'Releases accounts from Quarantine to Available OU after 72-hour delay',
      entry: path.join(__dirname, '../source/lambdas/unquarantine/handler.ts'),
      handler: 'handler',
      environment: {
        ...commonEnvVars,
        SCHEDULER_GROUP: this.schedulerGroup.name!,
      },
    });

    // Update QuarantineLambda environment with UnquarantineLambda ARN
    const cfnQuarantineLambda = this.quarantineLambda.node.defaultChild as lambda.CfnFunction;
    cfnQuarantineLambda.addPropertyOverride(
      'Environment.Variables.UNQUARANTINE_LAMBDA_ARN',
      this.unquarantineLambda.functionArn
    );

    // ========================================
    // IAM Permissions (NFR-S1, NFR-S3, FR31-33)
    // ========================================

    // Grant STS:AssumeRole for cross-account access (FR31)
    const assumeRolePolicy = new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [props.intermediateRoleArn],
    });
    this.quarantineLambda.addToRolePolicy(assumeRolePolicy);
    this.unquarantineLambda.addToRolePolicy(assumeRolePolicy);

    // Grant DynamoDB read/write access for account table (to update quarantine status)
    const dynamoDbPolicy = new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resources: [
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.accountTableName}`,
        `arn:aws:dynamodb:${this.region}:${this.account}:table/${props.accountTableName}/index/*`,
      ],
    });
    this.quarantineLambda.addToRolePolicy(dynamoDbPolicy);
    this.unquarantineLambda.addToRolePolicy(dynamoDbPolicy);

    // Grant KMS decrypt if table uses customer-managed key (required for encrypted DynamoDB tables)
    if (props.accountTableKmsKeyArn) {
      const kmsDecryptPolicy = new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: [props.accountTableKmsKeyArn],
      });
      this.quarantineLambda.addToRolePolicy(kmsDecryptPolicy);
      this.unquarantineLambda.addToRolePolicy(kmsDecryptPolicy);
    }

    // Grant Scheduler permissions to QuarantineLambda (create schedules)
    const schedulerCreatePolicy = new iam.PolicyStatement({
      actions: ['scheduler:CreateSchedule'],
      resources: [
        `arn:aws:scheduler:${this.region}:${this.account}:schedule/isb-billing-separator/*`,
      ],
    });
    this.quarantineLambda.addToRolePolicy(schedulerCreatePolicy);

    // Grant IAM:PassRole for scheduler execution role
    const passRolePolicy = new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [schedulerExecutionRole.roleArn],
      conditions: {
        StringEquals: {
          'iam:PassedToService': 'scheduler.amazonaws.com',
        },
      },
    });
    this.quarantineLambda.addToRolePolicy(passRolePolicy);

    // Grant Scheduler permissions to UnquarantineLambda (delete schedules)
    const schedulerDeletePolicy = new iam.PolicyStatement({
      actions: ['scheduler:DeleteSchedule'],
      resources: [
        `arn:aws:scheduler:${this.region}:${this.account}:schedule/isb-billing-separator/*`,
      ],
    });
    this.unquarantineLambda.addToRolePolicy(schedulerDeletePolicy);

    // Grant scheduler role permission to invoke UnquarantineLambda
    this.unquarantineLambda.grantInvoke(schedulerExecutionRole);

    // ========================================
    // EventBridge Rule (FR1, FR13)
    // ========================================

    // Rule to capture MoveAccount events on the custom event bus
    const moveAccountRule = new events.Rule(this, 'MoveAccountRule', {
      eventBus: this.eventBus,
      ruleName: `${this.resourcePrefix}-process-move-account-${props.environment}`,
      description: 'Routes MoveAccount events to SQS queue for processing',
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

    // DLQ for EventBridge rule delivery failures (FR38)
    const ruleDlq = new sqs.Queue(this, 'RuleDLQ', {
      queueName: `${this.resourcePrefix}-rule-dlq-${props.environment}`,
      retentionPeriod: cdk.Duration.days(14),
      enforceSSL: true,
    });

    // Add SQS target with DLQ
    moveAccountRule.addTarget(
      new targets.SqsQueue(this.eventQueue, {
        deadLetterQueue: ruleDlq,
      })
    );

    // ========================================
    // Event Source Mapping (SQS → Lambda)
    // ========================================

    // Add SQS trigger for QuarantineLambda
    this.quarantineLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(this.eventQueue, {
        batchSize: 10, // Process up to 10 events per invocation
        reportBatchItemFailures: true, // Partial batch response pattern
      })
    );

    // ========================================
    // CloudWatch Alarms (FR18, FR30)
    // ========================================

    // DLQ alarm - triggers when messages accumulate in DLQ (FR18)
    const dlqAlarm = new cloudwatch.Alarm(this, 'DLQAlarm', {
      alarmName: `${this.resourcePrefix}-dlq-alarm-${props.environment}`,
      alarmDescription: 'Event processing failures - investigate DLQ. Messages have failed 5 SQS retries.',
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
      alarmDescription: 'QuarantineLambda experiencing errors - check CloudWatch Logs for HANDLER_ERROR entries.',
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
      alarmDescription: 'UnquarantineLambda experiencing errors - check CloudWatch Logs for HANDLER_ERROR entries.',
      metric: this.unquarantineLambda.metricErrors({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    unquarantineErrorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));

    // ========================================
    // Operational Anomaly Alarms (FR17, FR19)
    // ========================================

    // Metric filter for successful quarantine operations (FR17 baseline)
    // Counts QUARANTINE_COMPLETE log entries to track normal operations
    new logs.MetricFilter(this, 'QuarantineSuccessMetricFilter', {
      logGroup: this.quarantineLambda.logGroup,
      metricNamespace: 'ISB/BillingSeparator',
      metricName: 'QuarantineSuccessCount',
      filterPattern: logs.FilterPattern.literal('{ $.action = "QUARANTINE_COMPLETE" }'),
      metricValue: '1',
    });

    // Metric filter for successful unquarantine operations
    // Counts UNQUARANTINE_COMPLETE log entries to track releases
    new logs.MetricFilter(this, 'UnquarantineSuccessMetricFilter', {
      logGroup: this.unquarantineLambda.logGroup,
      metricNamespace: 'ISB/BillingSeparator',
      metricName: 'UnquarantineSuccessCount',
      filterPattern: logs.FilterPattern.literal('{ $.action = "UNQUARANTINE_COMPLETE" }'),
      metricValue: '1',
    });

    // Rule DLQ alarm - monitors EventBridge rule delivery failures (FR38)
    const ruleDlqAlarm = new cloudwatch.Alarm(this, 'RuleDLQAlarm', {
      alarmName: `${this.resourcePrefix}-rule-dlq-alarm-${props.environment}`,
      alarmDescription: 'EventBridge rule delivery failures - check event routing from OrgMgmt account.',
      metric: ruleDlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    ruleDlqAlarm.addAlarmAction(new cloudwatchActions.SnsAction(this.alertTopic));

    // Note: Stuck account detection (FR17 - accounts in Quarantine >80 hours) requires
    // either a scheduled Lambda to query DynamoDB or manual CloudWatch Insights query.
    // For MVP, operators can use this CloudWatch Insights query in the console:
    //
    // fields @timestamp, @message
    // | filter action = "QUARANTINE_COMPLETE"
    // | stats latest(@timestamp) as lastQuarantined by accountId
    // | filter lastQuarantined < (now() - 80h)
    //
    // Or query DynamoDB directly for accounts with status="Quarantine".

    // ========================================
    // Outputs
    // ========================================

    new cdk.CfnOutput(this, 'StackName', {
      value: this.stackName,
      description: 'The name of this CloudFormation stack',
    });

    new cdk.CfnOutput(this, 'ResourcePrefix', {
      value: this.resourcePrefix,
      description: 'Prefix used for all resources in this stack',
    });

    new cdk.CfnOutput(this, 'EventBusArn', {
      value: this.eventBus.eventBusArn,
      description: 'ARN of the event bus for receiving MoveAccount events',
      exportName: `${this.resourcePrefix}-event-bus-arn-${props.environment}`,
    });

    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      description: 'Name of the event bus for receiving MoveAccount events',
    });

    new cdk.CfnOutput(this, 'EventQueueUrl', {
      value: this.eventQueue.queueUrl,
      description: 'URL of the SQS queue for event processing',
    });

    new cdk.CfnOutput(this, 'DLQUrl', {
      value: this.deadLetterQueue.queueUrl,
      description: 'URL of the dead letter queue for failed events',
    });

    new cdk.CfnOutput(this, 'QuarantineLambdaArn', {
      value: this.quarantineLambda.functionArn,
      description: 'ARN of the QuarantineLambda function',
    });

    new cdk.CfnOutput(this, 'UnquarantineLambdaArn', {
      value: this.unquarantineLambda.functionArn,
      description: 'ARN of the UnquarantineLambda function',
    });

    new cdk.CfnOutput(this, 'SchedulerGroupName', {
      value: this.schedulerGroup.name!,
      description: 'Name of the EventBridge Scheduler group',
    });

    new cdk.CfnOutput(this, 'AlertTopicArn', {
      value: this.alertTopic.topicArn,
      description: 'ARN of the SNS topic for operational alerts',
    });
  }
}
