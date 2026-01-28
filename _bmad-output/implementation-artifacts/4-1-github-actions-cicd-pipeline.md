# Story 4.1: GitHub Actions CI/CD Pipeline

Status: done

## Story

As a **Developer**,
I want **a GitHub Actions pipeline that deploys the billing separator via OIDC**,
So that **deployments are automated, auditable, and don't require long-lived credentials**.

## Acceptance Criteria

1. **AC1: Deployment Workflow**
   - Given the CDK stack from Epic 2
   - When `.github/workflows/deploy.yml` is created
   - Then it triggers on push to `main` branch
   - And it triggers on manual workflow dispatch with environment parameter

2. **AC2: OIDC Authentication**
   - Given the workflow runs
   - When OIDC authentication is configured
   - Then the workflow assumes an IAM role via OIDC (FR23)
   - And no long-lived AWS credentials are stored in GitHub secrets
   - And the IAM role ARN is configurable per environment

3. **AC3: Deployment Steps**
   - Given the workflow authenticates successfully
   - When the deployment steps run
   - Then `npm ci` installs dependencies
   - And `npm run validate` passes (lint + test + build)
   - And `cdk deploy --require-approval never` deploys the stack
   - And deployment output shows stack ARN and resource names

4. **AC4: Success/Failure Handling**
   - Given the workflow completes
   - When deployment is successful
   - Then workflow exits with success status
   - And deployment summary is posted to workflow summary
   - Given validation or deployment fails
   - When the error is caught
   - Then workflow exits with failure status
   - And error logs are available in GitHub Actions console

5. **AC5: PR Check Workflow**
   - Given a PR workflow is needed
   - When `.github/workflows/pr-check.yml` is created
   - Then it triggers on pull requests to `main`
   - And it runs `npm run validate` only (no deploy)
   - And it runs `cdk synth` to verify template generation

## Tasks / Subtasks

- [x] **Task 1: Create PR Check Workflow** (AC: #5)
  - [x] 1.1 Create `.github/workflows/pr-check.yml`
  - [x] 1.2 Configure trigger on pull requests to main
  - [x] 1.3 Add checkout, setup-node, npm ci steps
  - [x] 1.4 Add `npm run validate` step
  - [x] 1.5 Add `npx cdk synth` step to verify template

- [x] **Task 2: Create Deployment Workflow** (AC: #1, #2, #3, #4)
  - [x] 2.1 Create `.github/workflows/deploy.yml`
  - [x] 2.2 Configure triggers (push to main, workflow_dispatch)
  - [x] 2.3 Configure OIDC permissions for AWS assume role
  - [x] 2.4 Add aws-actions/configure-aws-credentials with OIDC
  - [x] 2.5 Add checkout, setup-node, npm ci steps
  - [x] 2.6 Add `npm run validate` step
  - [x] 2.7 Add `npx cdk deploy --require-approval never` step
  - [x] 2.8 Configure environment secrets/variables for IAM role ARN

- [x] **Task 3: Workflow Inputs and Configuration** (AC: #2)
  - [x] 3.1 Add workflow_dispatch inputs for environment selection
  - [x] 3.2 Configure GitHub environment secrets mapping
  - [x] 3.3 Document required GitHub secrets in workflow comments

- [x] **Task 4: Final Validation** (AC: all)
  - [x] 4.1 Verify workflow YAML syntax is valid
  - [x] 4.2 Run `npm run validate` locally to confirm it works
  - [x] 4.3 Document workflow usage in README or workflow files

## Dev Notes

### GitHub OIDC Configuration

The deployment workflow uses GitHub's OIDC provider to assume an IAM role without storing long-lived credentials.

Required GitHub secrets:
- `AWS_ROLE_ARN`: IAM role ARN to assume (e.g., `arn:aws:iam::123456789012:role/github-actions-deploy`)

Required IAM role trust policy:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:ORG/REPO:*"
        }
      }
    }
  ]
}
```

### Workflow Structure

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy'
        required: true
        default: 'dev'
        type: choice
        options:
          - dev
          - prod

permissions:
  id-token: write  # Required for OIDC
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment || 'dev' }}
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: true
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      - name: Configure AWS Credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: eu-west-2
      - run: npm ci
      - run: npm run validate
      - run: npx cdk deploy --require-approval never
```

### References

- [Source: _bmad-output/planning-artifacts/architecture.md]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1]
- [GitHub Actions OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)
- [aws-actions/configure-aws-credentials](https://github.com/aws-actions/configure-aws-credentials)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

No issues encountered during implementation.

### Completion Notes List

1. Created PR check workflow with pull request trigger, validation, and CDK synth
2. Created deployment workflow with OIDC authentication
3. Deployment workflow supports both push to main and manual workflow_dispatch
4. Environment selection via workflow_dispatch inputs (dev/prod)
5. Uses aws-actions/configure-aws-credentials@v4 for OIDC
6. Documented required GitHub secrets (AWS_ROLE_ARN) and variables (AWS_REGION)
7. Added deployment summary to GitHub step summary
8. Uploads CDK outputs as artifact
9. All 88 tests pass

### File List

**Created:**
- `.github/workflows/pr-check.yml`
- `.github/workflows/deploy.yml`

### Change Log

- 2026-01-28: Story file created, status: ready-for-dev
- 2026-01-28: Implemented GitHub Actions workflows
- 2026-01-28: All 88 tests pass, story marked done
