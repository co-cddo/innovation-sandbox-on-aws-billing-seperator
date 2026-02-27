# ISB Billing Separator

> **This is a temporary workaround.** This entire repository should be archived and the infrastructure destroyed once [aws-solutions/innovation-sandbox-on-aws#70](https://github.com/aws-solutions/innovation-sandbox-on-aws/issues/70) is resolved with native cooldown support in ISB. We look forward to deleting all of this.

A stop-gap solution that enforces billing and quota period boundaries for Innovation Sandbox (ISB) accounts by quarantining them for 91 days after cleanup.

## Why This Exists

ISB currently has a "soft cooldown" that prefers older accounts but will still assign recently-cleaned accounts if the pool is exhausted. This causes:

1. **Billing attribution issues** - Previous user's charges appear on next user's invoice
2. **Quota exhaustion** - Heavy usage near end of lease throttles the next user (see [#88](https://github.com/aws-solutions/innovation-sandbox-on-aws/issues/88))

This workaround intercepts the ISB account lifecycle and enforces a hard 91-day cooldown. It's ugly, adds operational complexity, and has edge cases - but it solves our immediate need until native support lands.

## When To Delete This

**Archive this repo and destroy the infrastructure when:**
- ISB implements native hard cooldown support ([#70](https://github.com/aws-solutions/innovation-sandbox-on-aws/issues/70))
- The cooldown status approach is available (accounts held in cooldown state before becoming available)

## Overview

The Innovation Sandbox (ISB) solution enables rapid AWS account provisioning for experimentation. When a sandbox is returned to the pool, ISB immediately moves it to the Available OU for reuse. This can cause billing attribution issues when the previous user's charges appear on the next user's invoice.

The Billing Separator intercepts accounts transitioning from CleanUp to Available and holds them in a temporary Quarantine OU for 91 days. This ensures billing data from the previous usage period settles before the account is reassigned.

## Architecture

```
                    Org Management Account (us-east-1)
                    ┌─────────────────────────────────┐
                    │  CloudTrail MoveAccount Events  │
                    │              │                  │
                    │              ▼                  │
                    │     EventBridge Rule            │
                    │     (OrgMgmtStack)              │
                    │              │                  │
                    └──────────────┼──────────────────┘
                                   │ Cross-account
                                   │ event forwarding
                    ┌──────────────┼──────────────────┐
                    │              ▼                  │
                    │     Custom Event Bus            │
                    │              │                  │
Hub Account         │              ▼                  │
(us-west-2)         │     EventBridge Rule            │
                    │              │                  │
                    │              ▼                  │
                    │         SQS Queue               │
                    │              │                  │
                    │              ▼                  │
                    │    QuarantineLambda             │
                    │              │                  │
                    │    ┌─────────┴─────────┐        │
                    │    │                   │        │
                    │    ▼                   ▼        │
                    │  Move to           Create       │
                    │  Quarantine OU     Scheduler    │
                    │                        │        │
                    │                   91 days       │
                    │                        │        │
                    │                        ▼        │
                    │              UnquarantineLambda │
                    │                        │        │
                    │                        ▼        │
                    │              Move to Available  │
                    │                   OU            │
                    │                                 │
                    │   (HubStack)                    │
                    └─────────────────────────────────┘
```

### Components

**OrgMgmtStack** (Organization Management Account, us-east-1):
- EventBridge rule capturing MoveAccount events to Available OU
- Cross-account role for event forwarding
- Forwards events to Hub account's custom event bus

**HubStack** (Hub Account, us-west-2):
- Custom EventBridge event bus receiving forwarded events
- EventBridge rule routing events to SQS queue
- SQS queue with DLQ for event buffering
- QuarantineLambda: Intercepts and quarantines accounts
- UnquarantineLambda: Releases accounts after 91 days
- EventBridge Scheduler group for delayed releases
- CloudWatch alarms and SNS topic for monitoring

## Prerequisites

1. **Innovation Sandbox Deployed**: ISB must be operational with:
   - DynamoDB account table
   - OU structure including the existing Quarantine OU
   - Cross-account IAM roles configured

2. **AWS CLI Configured**: With permissions to deploy to both Hub and Org Management accounts

3. **Node.js 22+**: Required for building and testing

## Installation

1. **Clone the repository with submodules**:
   ```bash
   git clone --recurse-submodules <repository-url>
   cd innovation-sandbox-on-aws-billing-seperator
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure CDK context**:
   ```bash
   cp cdk.context.example.json cdk.context.json
   ```
   Edit `cdk.context.json` with your environment values. See the file for documentation on each required value.

4. **Run validation**:
   ```bash
   npm run validate
   ```

## Deployment

Deploy both stacks with a single command:

```bash
npm run deploy
```

This deploys:
1. `isb-billing-separator-hub-{env}` to Hub account (us-west-2)
2. `isb-billing-separator-org-mgmt-{env}` to Org Management account (us-east-1)

### Manual Deployment

For more control, deploy stacks individually:

```bash
# Deploy Hub stack first
npx cdk deploy isb-billing-separator-hub-<env>

# Deploy Org Management stack
npx cdk deploy isb-billing-separator-org-mgmt-<env>
```

### GitHub Actions Deployment

The project includes CI/CD workflows for automated deployment:

- **PR Check**: Runs on pull requests to validate code
- **Deploy**: Runs on push to main or manual trigger

Required GitHub secrets:
- `AWS_ROLE_ARN`: IAM role ARN for OIDC-based deployment

## Configuration

All configuration is provided via CDK context. See `cdk.context.example.json` for the complete list:

| Value | Description |
|-------|-------------|
| `environment` | Environment name (dev/staging/prod) |
| `hubAccountId` | Hub AWS account ID |
| `orgMgmtAccountId` | Organization Management AWS account ID |
| `accountTableName` | ISB DynamoDB table name |
| `sandboxOuId` | Parent Sandbox OU ID |
| `availableOuId` | Available OU ID |
| `quarantineOuId` | Quarantine OU ID |
| `cleanupOuId` | CleanUp OU ID |
| `intermediateRoleArn` | Hub account intermediate role ARN |
| `orgMgtRoleArn` | Org Management account role ARN |
| `snsAlertEmail` | (Optional) Email for alarm notifications |

## Testing

### Unit Tests

```bash
npm test
```

### Integration Testing

See [test/integration/README.md](test/integration/README.md) for:
- End-to-end test procedures
- Verification commands
- Troubleshooting guide
- Account reconciliation steps

## Monitoring

### CloudWatch Alarms

The solution creates alarms for:
- **DLQ Alarm**: Triggers when 3+ messages in event DLQ
- **QuarantineLambda Error Alarm**: Triggers on repeated Lambda errors
- **UnquarantineLambda Error Alarm**: Triggers on repeated Lambda errors
- **Rule DLQ Alarm**: Triggers on EventBridge rule delivery failures

### CloudWatch Metrics

Custom metrics in `ISB/BillingSeparator` namespace:
- `QuarantineSuccessCount`: Successful quarantine operations
- `UnquarantineSuccessCount`: Successful release operations

### X-Ray Tracing

Both Lambda functions have X-Ray tracing enabled for end-to-end visibility.

## Removal

Remove the solution completely:

```bash
npm run destroy
```

Or using CDK directly:

```bash
cdk destroy --all
```

**Important**: Accounts currently in Quarantine OU will remain there. See [test/integration/README.md](test/integration/README.md) for manual reconciliation steps.

## Quarantine Bypass

New accounts with no billing history don't need the 91-day quarantine. You can skip quarantine on a per-account, one-shot basis using the `do-not-separate` tag.

### How to use

1. **Tag the account** in AWS Organizations:
   ```bash
   aws organizations tag-resource \
     --resource-id 023138541607 \
     --tags Key=do-not-separate,Value=
   ```

2. **Let the normal lifecycle run.** When the account moves from CleanUp → Available, the quarantine handler will:
   - Detect the `do-not-separate` tag
   - Skip the 91-day quarantine (the account stays in Available)
   - **Remove the tag** so subsequent cycles enforce quarantine normally

3. The bypass is **one-shot** — the tag is consumed on use. To bypass again, re-tag the account.

### Fail-safe behaviour

- If the tag check API call fails (e.g. missing IAM permissions), quarantine proceeds normally and a `TAG_CHECK_FAILED` log entry is emitted.
- If the tag removal fails after bypass, quarantine is still skipped and a `TAG_REMOVAL_FAILED` warning is logged. The tag will remain but won't cause issues — it will simply trigger another bypass on the next cycle.

### IAM prerequisites

The cross-account role in the Organization Management account needs:
- `organizations:ListTagsForResource`
- `organizations:UntagResource`

These calls go through the existing credential chain (intermediate role → org management role). If the permissions aren't present, the fail-safe behaviour kicks in.

## Known Limitations

This is a bolt-on workaround with inherent limitations:

- **Race condition**: If the account pool is exhausted and a lease request arrives between the MoveAccount event firing and this solution intercepting it (or at quarantine release time), ISB may assign the account before we can quarantine it. Low probability but possible.
- **Operational complexity**: Two additional CDK stacks across two accounts to maintain.
- **No ISB integration**: ISB doesn't know about the quarantine - its UI/API will show accounts as "Available" when they're actually quarantined.
- **Manual reconciliation**: If this solution is removed, quarantined accounts must be manually moved to Available OU.

These limitations are acceptable for our use case but highlight why native ISB support is the proper solution.

## Troubleshooting

See [test/integration/README.md](test/integration/README.md) for detailed troubleshooting guidance including:
- Event routing issues
- Lambda errors
- DLQ investigation
- Account reconciliation

## Development

### Project Structure

```
.
├── bin/                    # CDK app entry point
├── lib/                    # CDK stack definitions
│   ├── hub-stack.ts        # Main compute resources
│   └── org-mgmt-stack.ts   # Event forwarding
├── source/
│   └── lambdas/            # Lambda handlers
│       ├── quarantine/     # QuarantineLambda
│       ├── unquarantine/   # UnquarantineLambda
│       └── shared/         # Shared utilities
├── test/                   # Tests
│   ├── integration/        # Integration test docs
│   └── billing-separator.test.ts  # CDK assertion tests
└── deps/
    └── isb/                # ISB git submodule
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript |
| `npm run test` | Run Jest tests |
| `npm run lint` | Run ESLint |
| `npm run validate` | Lint + Test + Build |
| `npm run deploy` | Deploy all stacks |
| `npm run destroy` | Destroy all stacks |

## License

This project is licensed under the MIT License.
