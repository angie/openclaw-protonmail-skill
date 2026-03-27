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
