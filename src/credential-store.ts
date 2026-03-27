const DEFAULT_KEYCHAIN_SERVICE = 'openclaw-protonmail-skill';

export interface ResolveBridgePasswordOptions {
  account: string;
  bridgePassword?: string;
  envPassword?: string;
  keychainService?: string;
  keychainAccount?: string;
  keychainLookup?: (service: string, account: string) => Promise<string | null>;
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

  if (options.envPassword) {
    return options.envPassword;
  }

  throw new Error(
    'ProtonMail Bridge password not configured. Set bridgePassword, store it in keychain, or set PROTONMAIL_BRIDGE_PASSWORD.'
  );
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
