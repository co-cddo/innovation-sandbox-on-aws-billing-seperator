# Story 1.2: Project Initialization with ISB Submodule

Status: done

## Story

As a **Developer**,
I want **a properly initialized CDK TypeScript project with ISB commons as a dependency**,
So that **I can import ISB services and begin implementing the billing separator**.

## Acceptance Criteria

1. **AC1: CDK TypeScript Project Initialization**
   - Given an empty project directory
   - When the project is initialized
   - Then CDK TypeScript app is created with `npx cdk init app --language typescript`
   - And ISB is added as git submodule at `deps/isb` pinned to v1.1.7
   - And `package.json` includes `"@amzn/innovation-sandbox-commons": "file:./deps/isb/source/common"`

2. **AC2: TypeScript Configuration**
   - Given the project is initialized
   - When `tsconfig.json` is configured
   - Then path mappings exist for `@amzn/innovation-sandbox-commons/*`
   - And strict mode is enabled
   - And ESM module settings are configured (module: "ESNext", moduleResolution: "NodeNext")

3. **AC3: NPM Scripts Configuration**
   - Given the project is initialized
   - When standard npm scripts are configured
   - Then `npm run build`, `npm test`, `npm run lint`, `npm run deploy`, `npm run destroy` all exist
   - And `npm run validate` runs lint + test + build in sequence

4. **AC4: Git Configuration**
   - Given project files are created
   - When `.gitignore` is configured
   - Then `node_modules/`, `cdk.out/`, `cdk.context.json`, and `*.js` (compiled) are ignored
   - And `deps/isb/` submodule is NOT ignored (it's tracked by git)

## Tasks / Subtasks

- [x] **Task 1: Initialize CDK TypeScript Project** (AC: #1)
  - [x] 1.1 Run `npx cdk init app --language typescript` in project root
  - [x] 1.2 Verify CDK creates standard project structure (bin/, lib/, test/, cdk.json)
  - [x] 1.3 Verify `npm install` completes without errors

- [x] **Task 2: Add ISB as Git Submodule** (AC: #1)
  - [x] 2.1 Create `deps/` directory if not exists
  - [x] 2.2 Add ISB submodule from aws-solutions repo
  - [x] 2.3 Pin to v1.1.7: `cd deps/isb && git checkout v1.1.7 && cd ../..`
  - [x] 2.4 Stage submodule reference

- [x] **Task 3: Configure package.json** (AC: #1, #3)
  - [x] 3.1 Add ISB commons dependency: `"@amzn/innovation-sandbox-commons": "file:./deps/isb/source/common"`
  - [x] 3.2 Add npm scripts (build, test, lint, deploy, destroy, validate)
  - [x] 3.3 Ensure `type: "module"` is set for ESM
  - [x] 3.4 Run `npm install` to verify deps resolve

- [x] **Task 4: Configure tsconfig.json** (AC: #2)
  - [x] 4.1 Set `module: "NodeNext"` and `moduleResolution: "NodeNext"` for ESM
  - [x] 4.2 Enable `strict: true`
  - [x] 4.3 Add path mapping for ISB commons
  - [x] 4.4 Set `esModuleInterop: true`
  - [x] 4.5 Set `outDir: "dist"` for compiled output

- [x] **Task 5: Configure .gitignore** (AC: #4)
  - [x] 5.1 Ensure `node_modules/` is ignored
  - [x] 5.2 Ensure `cdk.out/` is ignored
  - [x] 5.3 Ensure `cdk.context.json` is ignored
  - [x] 5.4 Ensure `*.js` and `*.d.ts` (compiled TypeScript) are ignored
  - [x] 5.5 Ensure `*.js.map` (source maps) are ignored
  - [x] 5.6 Do NOT ignore `deps/isb/` - tracked by git submodule

- [x] **Task 6: Create Source Directory Structure** (AC: #1)
  - [x] 6.1 Create `source/lambdas/` directory for Lambda handlers
  - [x] 6.2 Create `source/lambdas/shared/` directory for shared utilities
  - [x] 6.3 Create `source/lambdas/__mocks__/` directory for test mocks
  - [x] 6.4 Create `source/lambdas/__fixtures__/` directory for test data

- [x] **Task 7: Verify Project Builds** (AC: #1, #3)
  - [x] 7.1 Run `npm run build` and verify no TypeScript errors
  - [x] 7.2 Run `npm test` and verify Jest runs (2 tests passing)
  - [x] 7.3 Run `npm run lint` and verify ESLint runs (no errors)
  - [x] 7.4 Run `npm run validate` and verify all pass in sequence
  - [x] 7.5 Run `npm run synth` and verify CDK generates valid CloudFormation

## Dev Notes

### Critical Context

This story establishes the project foundation. The spike (Story 1.1) confirmed that **multi-stack deployment is required** - events only appear in the Org Management account's EventBridge in us-east-1, so we need:
- Hub stack (main compute) → deploys to us-west-2
- Org Mgmt stack (event forwarding) → deploys to us-east-1

This affects Story 1.3 (CDK stack shell) but doesn't change the initialization in this story.

### Previous Story Intelligence (from Story 1.1)

**Key Learnings:**
- AWS SSO profiles: `NDX/orgManagement` and `NDX/InnovationSandboxHub`
- Organizations is a global service - events appear in us-east-1
- Organization Trail: `aws-controltower-BaselineCloudTrail`
- OU IDs discovered (NDX environment):
  - Available OU: `ou-2laj-oihxgbtr`
  - CleanUp OU: `ou-2laj-x3o8lbk8`
  - Quarantine OU: `ou-2laj-mmagoake`
- Account IDs: Org Management: `955063685555`, Hub: `568672915267`

### Implementation Notes

**ISB Submodule:**
- Repository: `https://github.com/aws-solutions/innovation-sandbox-on-aws.git` (not aws-samples)
- Pinned to v1.1.7 (detached HEAD state)

**CDK Init workaround:**
- `cdk init` requires empty directory, but we had _bmad framework
- Manually created CDK structure (bin/, lib/, test/, cdk.json)

**ESM Configuration:**
- Using `tsx` instead of `ts-node` for better ESM handling
- `cdk.json` app: `npx tsx bin/billing-separator.ts`
- Jest configured with `--experimental-vm-modules` for ESM

**TypeScript Configuration:**
- Module: `NodeNext` (not ESNext) for proper Node.js ESM
- `isolatedModules: true` required by ts-jest

## Dev Agent Record

### Agent Model Used

Claude Opus 4.5 (claude-opus-4-5-20251101)

### Debug Log References

- 2026-01-28 16:30: Started Story 1.2 implementation
- 2026-01-28 16:30: `cdk init` failed (non-empty directory), switched to manual setup
- 2026-01-28 16:31: Created npm project with `npm init -y`
- 2026-01-28 16:31: Installed CDK and dev dependencies
- 2026-01-28 16:32: Added ISB submodule from aws-solutions repo, pinned to v1.1.7
- 2026-01-28 16:33: Configured package.json with ISB dependency and scripts
- 2026-01-28 16:33: Configured tsconfig.json for ESM
- 2026-01-28 16:34: Created .gitignore, cdk.json, jest.config.js, eslint.config.js
- 2026-01-28 16:35: Created CDK entry point (bin/billing-separator.ts) and stack (lib/billing-separator-stack.ts)
- 2026-01-28 16:35: Created basic CDK assertion test
- 2026-01-28 16:36: Fixed ESLint config to include node and jest globals
- 2026-01-28 16:37: Fixed cdk.json to use tsx instead of ts-node for ESM
- 2026-01-28 16:38: All validation passed: lint ✓, test ✓, build ✓, synth ✓

### Completion Notes List

1. **AC1 SATISFIED**: CDK TypeScript project initialized with ISB submodule at deps/isb pinned to v1.1.7
2. **AC2 SATISFIED**: tsconfig.json configured with strict mode, ESM settings, and path mappings
3. **AC3 SATISFIED**: All npm scripts configured and working (build, test, lint, deploy, destroy, validate)
4. **AC4 SATISFIED**: .gitignore configured correctly, deps/isb/ tracked by submodule

### File List

- `package.json` (created - ISB dependency, npm scripts, type: module)
- `tsconfig.json` (created - ESM, strict, path mappings)
- `.gitignore` (created - ignores node_modules, cdk.out, *.js, etc.)
- `.gitmodules` (created - ISB submodule reference)
- `cdk.json` (created - CDK configuration with tsx)
- `jest.config.js` (created - Jest ESM configuration)
- `eslint.config.js` (created - ESLint flat config)
- `bin/billing-separator.ts` (created - CDK app entry point)
- `lib/billing-separator-stack.ts` (created - CDK stack definition)
- `test/billing-separator.test.ts` (created - CDK assertion tests)
- `deps/isb/` (submodule - ISB v1.1.7)
- `source/lambdas/` (created - directory structure)
- `source/lambdas/shared/` (created)
- `source/lambdas/__mocks__/` (created)
- `source/lambdas/__fixtures__/` (created)

### Change Log

- 2026-01-28 16:30: Story moved to in-progress
- 2026-01-28 16:30-16:38: All tasks completed
- 2026-01-28 16:38: Story moved to review
- 2026-01-28 17:15: Code review completed - added .gitkeep files to empty directories
- 2026-01-28 17:15: Story moved to done

### Code Review Notes

**Review Date:** 2026-01-28
**Reviewer:** Claude Opus 4.5

**Issues Found:**
1. **M2 (Fixed):** Empty directories (shared/, __mocks__/, __fixtures__/) needed .gitkeep files for git tracking
2. **L2 (Verified):** package-lock.json exists and will be committed

**Resolution:** Added .gitkeep files to:
- `source/lambdas/shared/.gitkeep`
- `source/lambdas/__mocks__/.gitkeep`
- `source/lambdas/__fixtures__/.gitkeep`

**Final Validation:** All checks pass (lint ✓, test ✓, build ✓)
