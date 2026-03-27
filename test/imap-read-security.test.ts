import { EventEmitter } from 'events';
import { IMAPClient } from '../src/imap';

jest.mock('mailparser', () => ({
  simpleParser: jest.fn(async () => ({ subject: 'ok' })),
}));

const { simpleParser: simpleParserMock } = jest.requireMock('mailparser') as {
  simpleParser: jest.Mock;
};

class FakeImapFlow extends EventEmitter {
  public mailboxOpen = jest.fn(async () => ({ path: 'INBOX' }));
  public fetchOne = jest.fn(async () => false);
  public connect = jest.fn(async () => undefined);
  public logout = jest.fn(async () => undefined);
  public close = jest.fn();
}

const fakeClientInstances: FakeImapFlow[] = [];

jest.mock('imapflow', () => ({
  ImapFlow: jest.fn().mockImplementation(() => {
    const instance = new FakeImapFlow();
    fakeClientInstances.push(instance);
    return instance;
  }),
}));

function createClient(): IMAPClient {
  return new IMAPClient({
    user: 'user@pm.me',
    password: 'secret',
    host: '127.0.0.1',
    port: 1143,
    tls: false,
  });
}

describe('IMAPClient.readMessage security controls', () => {
  beforeEach(() => {
    simpleParserMock.mockClear();
    fakeClientInstances.splice(0, fakeClientInstances.length);
  });

  it('rejects invalid message UIDs before opening mailbox', async () => {
    const client = createClient();
    const imap = fakeClientInstances[0];

    await expect(client.readMessage('1:*')).rejects.toThrow('Message ID must be a positive numeric UID');
    expect(imap.mailboxOpen).not.toHaveBeenCalled();
  });

  it('rejects when fetch returns no message', async () => {
    const client = createClient();
    const imap = fakeClientInstances[0];

    (imap.fetchOne as jest.Mock).mockResolvedValue(false);

    await expect(client.readMessage('42')).rejects.toThrow('Message not found');
  });

  it('rejects oversized email payloads before parsing', async () => {
    const client = createClient();
    const imap = fakeClientInstances[0];

    (imap.fetchOne as jest.Mock).mockResolvedValue({
      uid: 43,
      seq: 1,
      source: Buffer.alloc(5 * 1024 * 1024 + 1),
    });

    await expect(client.readMessage('43')).rejects.toThrow('Email content exceeds limit');
    expect(simpleParserMock).not.toHaveBeenCalled();
  });
});
