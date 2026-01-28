/**
 * Type declarations for ISB commons
 * These override the path mapping types to avoid compilation issues with ISB internals
 */

declare module '@amzn/innovation-sandbox-commons/isb-services/sandbox-ou-service.js' {
  import { OrganizationsClient } from '@aws-sdk/client-organizations';
  
  export interface SandboxAccount {
    awsAccountId: string;
    status: string;
    email?: string;
    name?: string;
    meta?: {
      schemaVersion: number;
      createdTime?: string;
      lastEditTime?: string;
    };
  }

  export interface OrganizationalUnit {
    Id?: string;
    Name?: string;
    Arn?: string;
  }

  export interface SandboxAccountStore {
    get(accountId: string): Promise<{ result: SandboxAccount | null }>;
    put(account: SandboxAccount): Promise<{ oldItem?: unknown; newItem: SandboxAccount }>;
  }

  export interface Transaction<T> {
    beginTransaction(): Promise<T>;
    rollbackTransaction(): Promise<void>;
  }

  export type IsbOu = 'Available' | 'Active' | 'CleanUp' | 'Quarantine' | 'Frozen' | 'Entry' | 'Exit';

  export class SandboxOuService {
    constructor(props: {
      namespace: string;
      sandboxAccountStore: SandboxAccountStore;
      sandboxOuId: string;
      orgsClient: OrganizationsClient;
    });

    getIsbOu(ouName: IsbOu): Promise<OrganizationalUnit>;
    transactionalMoveAccount(
      account: SandboxAccount,
      sourceOu: IsbOu,
      destinationOu: IsbOu
    ): Transaction<{ oldItem?: unknown; newItem: SandboxAccount }>;
    moveAccount(
      account: SandboxAccount,
      sourceOu: IsbOu,
      destinationOu: IsbOu
    ): Promise<{ oldItem?: unknown; newItem: SandboxAccount }>;
  }
}

declare module '@amzn/innovation-sandbox-commons/data/sandbox-account/dynamo-sandbox-account-store.js' {
  import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

  export interface SandboxAccount {
    awsAccountId: string;
    status: string;
    email?: string;
    name?: string;
  }

  export class DynamoSandboxAccountStore {
    constructor(props: {
      client: DynamoDBDocumentClient;
      accountTableName: string;
    });

    get(accountId: string): Promise<{ result: SandboxAccount | null }>;
    put(account: SandboxAccount): Promise<{ oldItem?: unknown; newItem: SandboxAccount }>;
    findByStatus(args: {
      status: string;
      pageIdentifier?: string;
      pageSize?: number;
    }): Promise<{ results: SandboxAccount[]; nextPageIdentifier?: string }>;
  }
}

declare module '@amzn/innovation-sandbox-commons/utils/cross-account-roles.js' {
  import { AwsCredentialIdentityProvider } from '@aws-sdk/types';

  export function fromTemporaryIsbOrgManagementCredentials(env: {
    INTERMEDIATE_ROLE_ARN: string;
    ORG_MGT_ROLE_ARN: string;
    USER_AGENT_EXTRA: string;
  }): AwsCredentialIdentityProvider;

  export function fromTemporaryIsbSpokeCredentials(props: {
    intermediateRoleArn: string;
    targetRoleArn: string;
    sessionName: string;
    customUserAgent: string;
  }): AwsCredentialIdentityProvider;
}

declare module '@amzn/innovation-sandbox-commons/data/sandbox-account/sandbox-account.js' {
  export type IsbOu = 'Available' | 'Active' | 'CleanUp' | 'Quarantine' | 'Frozen' | 'Entry' | 'Exit';
  export type SandboxAccountStatus = 'Available' | 'Active' | 'CleanUp' | 'Quarantine' | 'Frozen';

  export interface SandboxAccount {
    awsAccountId: string;
    status: SandboxAccountStatus;
    email?: string;
    name?: string;
    cleanupExecutionContext?: {
      stateMachineExecutionArn: string;
      stateMachineExecutionStartTime: string;
    };
    driftAtLastScan?: boolean;
    meta?: {
      schemaVersion: number;
      createdTime?: string;
      lastEditTime?: string;
    };
  }
}
