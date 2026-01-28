/**
 * ISB Import Verification Tests
 *
 * These tests verify that ISB commons modules exist and can be found.
 * Since ISB is TypeScript source (not compiled), we verify the files exist
 * and that our path mappings are correctly configured.
 *
 * Runtime imports will work via tsx, which handles TypeScript natively.
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const ISB_COMMON_PATH = './deps/isb/source/common';

describe('ISB Commons Import Verification', () => {
  describe('given the project is configured with ISB submodule', () => {
    it('should have ISB submodule at deps/isb', () => {
      const isbPath = path.resolve(ISB_COMMON_PATH);
      expect(fs.existsSync(isbPath)).toBe(true);
    });

    it('should have SandboxOuService module', () => {
      const modulePath = path.resolve(
        ISB_COMMON_PATH,
        'isb-services/sandbox-ou-service.ts'
      );
      expect(fs.existsSync(modulePath)).toBe(true);

      // Verify it exports SandboxOuService
      const content = fs.readFileSync(modulePath, 'utf-8');
      expect(content).toContain('export class SandboxOuService');
    });

    it('should have DynamoSandboxAccountStore module', () => {
      const modulePath = path.resolve(
        ISB_COMMON_PATH,
        'data/sandbox-account/dynamo-sandbox-account-store.ts'
      );
      expect(fs.existsSync(modulePath)).toBe(true);

      // Verify it exports DynamoSandboxAccountStore
      const content = fs.readFileSync(modulePath, 'utf-8');
      expect(content).toContain('export class DynamoSandboxAccountStore');
    });

    it('should have cross-account-roles module with fromTemporaryIsbOrgManagementCredentials', () => {
      const modulePath = path.resolve(
        ISB_COMMON_PATH,
        'utils/cross-account-roles.ts'
      );
      expect(fs.existsSync(modulePath)).toBe(true);

      // Verify it exports the credential helper
      const content = fs.readFileSync(modulePath, 'utf-8');
      expect(content).toContain('export function fromTemporaryIsbOrgManagementCredentials');
    });

    it('should have sandbox-account types module', () => {
      const modulePath = path.resolve(
        ISB_COMMON_PATH,
        'data/sandbox-account/sandbox-account.ts'
      );
      expect(fs.existsSync(modulePath)).toBe(true);

      // Verify key types are exported
      const content = fs.readFileSync(modulePath, 'utf-8');
      expect(content).toContain('SandboxAccount');
      expect(content).toContain('SandboxAccountStatus');
      expect(content).toContain('IsbOu');
    });

    it('should have transactions module with Transaction type', () => {
      const modulePath = path.resolve(
        ISB_COMMON_PATH,
        'utils/transactions.ts'
      );
      expect(fs.existsSync(modulePath)).toBe(true);

      // Verify Transaction is exported
      const content = fs.readFileSync(modulePath, 'utf-8');
      expect(content).toContain('Transaction');
    });
  });

  describe('tsconfig and jest configuration', () => {
    it('should have ISB type declarations', () => {
      const typesPath = path.resolve('./types/isb-commons.d.ts');
      expect(fs.existsSync(typesPath)).toBe(true);

      // Verify key types are declared
      const content = fs.readFileSync(typesPath, 'utf-8');
      expect(content).toContain('SandboxOuService');
      expect(content).toContain('DynamoSandboxAccountStore');
      expect(content).toContain('fromTemporaryIsbOrgManagementCredentials');
    });

    it('should have jest moduleNameMapper for ISB', () => {
      const jestConfigPath = path.resolve('./jest.config.js');
      const content = fs.readFileSync(jestConfigPath, 'utf-8');

      expect(content).toContain('@amzn/innovation-sandbox-commons');
      expect(content).toContain('deps/isb/source/common');
    });

    it('should have tsconfig.build.json with ISB path mapping', () => {
      const tsconfigPath = path.resolve('./tsconfig.build.json');
      const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));

      expect(tsconfig.compilerOptions.paths).toBeDefined();
      expect(
        tsconfig.compilerOptions.paths['@amzn/innovation-sandbox-commons/*']
      ).toBeDefined();
    });
  });
});
