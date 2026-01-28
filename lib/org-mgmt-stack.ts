import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * Org Management Stack Properties
 */
export interface OrgMgmtStackProps extends cdk.StackProps {
  /** Environment name (dev/staging/prod) */
  environment: string;
  /** Hub account ID for cross-account event forwarding */
  hubAccountId: string;
  /** Hub event bus ARN to forward events to */
  hubEventBusArn: string;
  /** Available OU ID - events destined for this OU trigger quarantine */
  availableOuId: string;
}

/**
 * ISB Billing Separator Org Management Stack
 *
 * Deploys to: Organization Management Account (us-east-1)
 *
 * This stack captures CloudTrail MoveAccount events from the Organization Trail
 * and forwards them to the Hub account's EventBridge bus for processing.
 *
 * Per spike results (Story 1.1):
 * - Organizations is a global service, but CloudTrail events appear in us-east-1
 * - MoveAccount events appear on the Org Management account's default EventBridge bus
 * - Events do NOT automatically propagate to member accounts
 * - Cross-account EventBridge forwarding is required
 *
 * This stack creates:
 * - EventBridge rule matching MoveAccount events to Available OU
 * - Cross-account event bus target pointing to Hub account
 * - IAM role for EventBridge to assume when forwarding events
 */
export class OrgMgmtStack extends cdk.Stack {
  /** Resource prefix for all resources (FR25) */
  public readonly resourcePrefix = 'isb-billing-sep';

  constructor(scope: Construct, id: string, props: OrgMgmtStackProps) {
    super(scope, id, props);

    // Stack tags
    cdk.Tags.of(this).add('Project', 'isb-billing-separator');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
    cdk.Tags.of(this).add('Environment', props.environment);

    // IAM role for EventBridge to assume when forwarding events to Hub account
    const eventBridgeRole = new iam.Role(this, 'CrossAccountEventRole', {
      roleName: `${this.resourcePrefix}-event-forwarder-${props.environment}`,
      assumedBy: new iam.ServicePrincipal('events.amazonaws.com'),
      description: 'Role for EventBridge to forward MoveAccount events to Hub account',
    });

    // Allow EventBridge to put events on the Hub account's event bus
    eventBridgeRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [props.hubEventBusArn],
      })
    );

    // Reference the Hub account's event bus
    const hubEventBus = events.EventBus.fromEventBusArn(
      this,
      'HubEventBus',
      props.hubEventBusArn
    );

    // EventBridge rule to capture MoveAccount events destined for Available OU
    // This intercepts accounts that ISB is trying to move back to Available
    const moveAccountRule = new events.Rule(this, 'MoveAccountToAvailableRule', {
      ruleName: `${this.resourcePrefix}-capture-move-to-available-${props.environment}`,
      description: 'Captures CloudTrail MoveAccount events where destination is Available OU',
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

    // Forward matching events to the Hub account's event bus
    moveAccountRule.addTarget(
      new targets.EventBus(hubEventBus, {
        role: eventBridgeRole,
      })
    );

    // Outputs
    new cdk.CfnOutput(this, 'StackName', {
      value: this.stackName,
      description: 'The name of this CloudFormation stack',
    });

    new cdk.CfnOutput(this, 'ResourcePrefix', {
      value: this.resourcePrefix,
      description: 'Prefix used for all resources in this stack',
    });

    new cdk.CfnOutput(this, 'EventRuleName', {
      value: moveAccountRule.ruleName,
      description: 'Name of the EventBridge rule capturing MoveAccount events',
    });

    new cdk.CfnOutput(this, 'EventForwarderRoleArn', {
      value: eventBridgeRole.roleArn,
      description: 'ARN of the IAM role used for cross-account event forwarding',
    });

    new cdk.CfnOutput(this, 'TargetEventBusArn', {
      value: props.hubEventBusArn,
      description: 'ARN of the Hub event bus receiving forwarded events',
    });
  }
}
