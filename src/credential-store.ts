import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEFAULT_KEYCHAIN_SERVICE = 'openclaw-protonmail-skill';
const SYSTEMD_CREDENTIAL_NAME = 'protonmail_bridge_password';

export interface ResolveBridgePasswordOptions {
  account: string;
  bridgePassword?: string;
  envPassword?: string;
  envPasswordFile?: string;
  credentialsDirectory?: string;
  keychainService?: string;
  keychainAccount?: string;
  keychainLookup?: (service: string, account: string) => Promise<string | null>;
  fileRead?: (path: string, encoding: BufferEncoding) => Promise<string>;
}

export async function resolveBridgePassword(
  options: ResolveBridgePasswordOptions
): Promise<string> {
  if (options.bridgePassword) {
    return options.bridgePassword;
  }

  const keychainPassword = await (options.keychainLookup || getPasswordFromKeychain)(
    options.keychainService || DEFAULT_KEYCHAIN_SERVICE,
    options.keychainAccount || options.account
  );
  if (keychainPassword) {
    return keychainPassword;
  }

  const passwordFromFile = await readPasswordFromFile({
    envPasswordFile: options.envPasswordFile,
    credentialsDirectory: options.credentialsDirectory,
    fileRead: options.fileRead || readFile,
  });
  if (passwordFromFile) {
    return passwordFromFile;
  }

  if (options.envPassword) {
    return options.envPassword;
  }

  throw new Error(
    'ProtonMail Bridge password not configured. Set bridgePassword, store it in keychain, set PROTONMAIL_BRIDGE_PASSWORD_FILE, provide systemd credentials, or set PROTONMAIL_BRIDGE_PASSWORD.'
  );
}

interface ReadPasswordFromFileOptions {
  envPasswordFile?: string;
  credentialsDirectory?: string;
  fileRead: (path: string, encoding: BufferEncoding) => Promise<string>;
}

async function readPasswordFromFile(options: ReadPasswordFromFileOptions): Promise<string | null> {
  const passwordPath = options.envPasswordFile || getSystemdCredentialPath(options.credentialsDirectory);
  if (!passwordPath) {
    return null;
  }

  try {
    const value = await options.fileRead(passwordPath, 'utf8');
    const password = value.trim();
    return password.length > 0 ? password : null;
  } catch {
    return null;
  }
}

function getSystemdCredentialPath(credentialsDirectory?: string): string | null {
  if (!credentialsDirectory) {
    return null;
  }

  return join(credentialsDirectory, SYSTEMD_CREDENTIAL_NAME);
}

async function getPasswordFromKeychain(service: string, account: string): Promise<string | null> {
  try {
    const keytarModule = await import('keytar');
    const keytar = (keytarModule as unknown as { default?: { getPassword?: (svc: string, acc: string) => Promise<string | null> }; getPassword?: (svc: string, acc: string) => Promise<string | null> });
    const getPassword = keytar.getPassword || keytar.default?.getPassword;
    if (!getPassword) {
      return null;
    }

    return getPassword(service, account);
  } catch {
    return null;
  }
}
