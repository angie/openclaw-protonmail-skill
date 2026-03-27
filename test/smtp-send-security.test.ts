import { SMTPClient } from '../src/smtp';

const mockSendMail = jest.fn().mockResolvedValue({ messageId: '<sent@test>' });

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({
    sendMail: mockSendMail,
  })),
}));

function makeSmtp() {
  return new SMTPClient({
    host: '127.0.0.1',
    port: 1025,
    secure: false,
    auth: { user: 'bucky@pm.me', pass: 'bridge-pw' },
  });
}

describe('SMTPClient.send security validation', () => {
  beforeEach(() => {
    mockSendMail.mockClear();
  });

  it('rejects newline header injection in recipient', async () => {
    const smtp = makeSmtp();

    await expect(
      smtp.send('alice@example.com\nBCC:mallory@example.com', 'Hello', 'Body text')
    ).rejects.toThrow('to contains invalid control characters');

    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('rejects empty subject values', async () => {
    const smtp = makeSmtp();

    await expect(smtp.send('alice@example.com', '   ', 'Body text')).rejects.toThrow(
      'subject is required'
    );

    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('sends with validated values', async () => {
    const smtp = makeSmtp();

    await smtp.send('alice@example.com', 'Subject', 'Body text', {
      cc: 'bob@example.com',
    });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@example.com',
        subject: 'Subject',
        text: 'Body text',
        cc: 'bob@example.com',
      })
    );
  });

  it('allows multiline plain-text bodies', async () => {
    const smtp = makeSmtp();

    await smtp.send('alice@example.com', 'Subject', 'Line 1\nLine 2\nLine 3');

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Line 1\nLine 2\nLine 3',
      })
    );
  });
});
