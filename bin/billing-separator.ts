#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { HubStack } from '../lib/hub-stack.js';
import { OrgMgmtStack } from '../lib/org-mgmt-stack.js';

const app = new cdk.App();

// Environment configuration from context
const environment = app.node.tryGetContext('environment') || 'dev';
const hubAccountId = app.node.tryGetContext('hubAccountId');
const orgMgmtAccountId = app.node.tryGetContext('orgMgmtAccountId');

// ISB Configuration
const accountTableName = app.node.tryGetContext('accountTableName');
const sandboxOuId = app.node.tryGetContext('sandboxOuId');
const availableOuId = app.node.tryGetContext('availableOuId');
const quarantineOuId = app.node.tryGetContext('quarantineOuId');
const cleanupOuId = app.node.tryGetContext('cleanupOuId');

// Cross-Account IAM
const intermediateRoleArn = app.node.tryGetContext('intermediateRoleArn');
const orgMgtRoleArn = app.node.tryGetContext('orgMgtRoleArn');

// Alerting (optional)
const snsAlertEmail = app.node.tryGetContext('snsAlertEmail');

/**
 * ISB Billing Separator - Multi-Stack Architecture
 *
 * Per spike results (Story 1.1), Organizations CloudTrail events appear only in
 * the Org Management account's EventBridge bus in us-east-1. This requires a
 * two-stack deployment:
 *
 * 1. HubStack (us-west-2): Main compute - Lambdas, SQS, Scheduler, Alarms
 * 2. OrgMgmtStack (us-east-1): Event forwarding - EventBridge rule to Hub
 *
 * Deployment order:
 * 1. Deploy HubStack first to create the event bus
 * 2. Deploy OrgMgmtStack with the Hub event bus ARN
 *
 * Use `cdk deploy --all` to deploy both stacks in the correct order.
 */

// Validate required context for HubStack
const missingHubContext: string[] = [];
if (!accountTableName) missingHubContext.push('accountTableName');
if (!sandboxOuId) missingHubContext.push('sandboxOuId');
if (!availableOuId) missingHubContext.push('availableOuId');
if (!quarantineOuId) missingHubContext.push('quarantineOuId');
if (!cleanupOuId) missingHubContext.push('cleanupOuId');
if (!intermediateRoleArn) missingHubContext.push('intermediateRoleArn');
if (!orgMgtRoleArn) missingHubContext.push('orgMgtRoleArn');

if (missingHubContext.length > 0) {
  throw new Error(
    `Missing required CDK context values: ${missingHubContext.join(', ')}.\n` +
      `Copy cdk.context.example.json to cdk.context.json and configure these values.\n` +
      `See cdk.context.example.json for documentation on each required value.`
  );
}

// Hub Stack - Main compute resources (deploys to Hub account, us-west-2)
const hubStack = new HubStack(app, `isb-billing-separator-hub-${environment}`, {
  environment,
  accountTableName,
  sandboxOuId,
  availableOuId,
  quarantineOuId,
  cleanupOuId,
  intermediateRoleArn,
  orgMgtRoleArn,
  snsAlertEmail, // Optional: omit for no email notifications
  env: {
    account: hubAccountId || process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-west-2',
  },
  description: 'ISB Billing Separator Hub - Main compute resources',
  crossRegionReferences: true,
});

// Validate required context for OrgMgmtStack
if (!orgMgmtAccountId) {
  throw new Error(
    `Missing required CDK context value: orgMgmtAccountId.\n` +
      `Copy cdk.context.example.json to cdk.context.json and configure this value.`
  );
}

// Org Management Stack - Event forwarding (deploys to Org Mgmt account, us-east-1)
const orgMgmtStack = new OrgMgmtStack(app, `isb-billing-separator-org-mgmt-${environment}`, {
  environment,
  hubAccountId: hubAccountId || process.env.CDK_DEFAULT_ACCOUNT!,
  hubEventBusArn: hubStack.eventBus.eventBusArn,
  availableOuId,
  env: {
    account: orgMgmtAccountId,
    region: 'us-east-1', // Organizations events appear in us-east-1
  },
  description: 'ISB Billing Separator Org Mgmt - Event forwarding to Hub',
  crossRegionReferences: true,
});

// Ensure Hub stack is deployed first
orgMgmtStack.addDependency(hubStack);
