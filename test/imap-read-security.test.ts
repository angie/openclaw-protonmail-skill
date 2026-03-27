import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { IMAPClient } from '../src/imap';

jest.mock('mailparser', () => ({
  simpleParser: jest.fn(async () => ({ subject: 'ok' })),
}));

const { simpleParser: simpleParserMock } = jest.requireMock('mailparser') as {
  simpleParser: jest.Mock;
};

class FakeImap extends EventEmitter {
  public openBox = jest.fn((_: string, __: boolean, callback: (err: Error | null, box?: object) => void) => {
    callback(null, {});
  });

  public fetch = jest.fn((_uid: string, _options: object) => new EventEmitter());

  public connect = jest.fn();
  public end = jest.fn();
}

const fakeImapInstances: FakeImap[] = [];

jest.mock('imap', () => {
  return jest.fn().mockImplementation(() => {
    const instance = new FakeImap();
    fakeImapInstances.push(instance);
    return instance;
  });
});

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
    fakeImapInstances.splice(0, fakeImapInstances.length);
  });

  it('rejects invalid message UIDs before opening mailbox', async () => {
    const client = createClient();
    const imap = fakeImapInstances[0];

    await expect(client.readMessage('1:*')).rejects.toThrow('Message ID must be a positive numeric UID');
    expect(imap.openBox).not.toHaveBeenCalled();
  });

  it('rejects when fetch completes without a message', async () => {
    const client = createClient();
    const imap = fakeImapInstances[0];
    const fetchEmitter = new EventEmitter();

    imap.fetch.mockReturnValue(fetchEmitter);

    const promise = client.readMessage('42');
    fetchEmitter.emit('end');

    await expect(promise).rejects.toThrow('Message not found');
  });

  it('rejects oversized email payloads before parsing', async () => {
    const client = createClient();
    const imap = fakeImapInstances[0];
    const fetchEmitter = new EventEmitter();

    imap.fetch.mockReturnValue(fetchEmitter);

    const promise = client.readMessage('43');
    const messageEmitter = new EventEmitter();
    const bodyStream = new PassThrough();

    fetchEmitter.emit('message', messageEmitter);
    messageEmitter.emit('body', bodyStream);
    bodyStream.write(Buffer.alloc(5 * 1024 * 1024 + 1));
    bodyStream.end();

    await expect(promise).rejects.toThrow('Email content exceeds limit');
    expect(simpleParserMock).not.toHaveBeenCalled();
  });
});
