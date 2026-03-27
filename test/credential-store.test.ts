import { resolveBridgePassword } from '../src/credential-store';

describe('resolveBridgePassword', () => {
  it('prefers explicit bridgePassword over all other sources', async () => {
    const keychainLookup = jest.fn(async () => 'keychain-secret');

    await expect(
      resolveBridgePassword({
        account: 'user@pm.me',
        bridgePassword: 'config-secret',
        envPassword: 'env-secret',
        keychainLookup,
      })
    ).resolves.toBe('config-secret');

    expect(keychainLookup).not.toHaveBeenCalled();
  });

  it('uses keychain value before environment fallback', async () => {
    const keychainLookup = jest.fn(async () => 'keychain-secret');

    await expect(
      resolveBridgePassword({
        account: 'user@pm.me',
        envPassword: 'env-secret',
        keychainLookup,
      })
    ).resolves.toBe('keychain-secret');
  });

  it('falls back to env password when keychain has no entry', async () => {
    const keychainLookup = jest.fn(async () => null);

    await expect(
      resolveBridgePassword({
        account: 'user@pm.me',
        envPassword: 'env-secret',
        keychainLookup,
      })
    ).resolves.toBe('env-secret');
  });

  it('uses password file before env fallback', async () => {
    const keychainLookup = jest.fn(async () => null);
    const fileRead = jest.fn(async () => 'file-secret\n');

    await expect(
      resolveBridgePassword({
        account: 'user@pm.me',
        envPassword: 'env-secret',
        envPasswordFile: '/run/secrets/protonmail_bridge_password',
        keychainLookup,
        fileRead,
      })
    ).resolves.toBe('file-secret');
  });

  it('uses systemd credentials directory fallback file when present', async () => {
    const keychainLookup = jest.fn(async () => null);
    const fileRead = jest.fn(async () => 'cred-secret\n');

    await expect(
      resolveBridgePassword({
        account: 'user@pm.me',
        credentialsDirectory: '/run/credentials/openclaw.service',
        keychainLookup,
        fileRead,
      })
    ).resolves.toBe('cred-secret');

    expect(fileRead).toHaveBeenCalledWith('/run/credentials/openclaw.service/protonmail_bridge_password', 'utf8');
  });

  it('falls back to env password when password file is empty', async () => {
    const keychainLookup = jest.fn(async () => null);
    const fileRead = jest.fn(async () => '   \n');

    await expect(
      resolveBridgePassword({
        account: 'user@pm.me',
        envPassword: 'env-secret',
        envPasswordFile: '/run/secrets/protonmail_bridge_password',
        keychainLookup,
        fileRead,
      })
    ).resolves.toBe('env-secret');
  });

  it('throws when no credential source is available', async () => {
    const keychainLookup = jest.fn(async () => null);

    await expect(
      resolveBridgePassword({
        account: 'user@pm.me',
        keychainLookup,
      })
    ).rejects.toThrow('ProtonMail Bridge password not configured');
  });
});
