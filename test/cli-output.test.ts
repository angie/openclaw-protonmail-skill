import { formatReadEmailOutput, redactErrorMessage } from '../src/cli-output';

describe('cli output safety', () => {
  const sampleEmail = {
    from: { text: 'Alice <alice@example.com>' },
    to: { text: 'Bob <bob@example.com>' },
    subject: 'Hello',
    date: new Date('2026-01-01T00:00:00.000Z'),
    text: 'Sensitive text body',
    html: '<p>Sensitive text body</p>',
    attachments: [
      {
        filename: 'file.txt',
        contentType: 'text/plain',
        size: 10,
      },
    ],
  };

  it('omits body fields by default', () => {
    const output = formatReadEmailOutput(sampleEmail, false);
    expect(output).not.toHaveProperty('text');
    expect(output).not.toHaveProperty('html');
    expect(output.subject).toBe('Hello');
  });

  it('includes body fields when explicitly requested', () => {
    const output = formatReadEmailOutput(sampleEmail, true);
    expect(output.text).toBe('Sensitive text body');
    expect(output.html).toBe('<p>Sensitive text body</p>');
  });

  it('redacts unknown errors to generic message', () => {
    expect(redactErrorMessage({ code: 'E_FAIL' })).toBe('Operation failed');
  });

  it('returns safe message for string errors', () => {
    expect(redactErrorMessage('authentication failed')).toBe('authentication failed');
  });
});
