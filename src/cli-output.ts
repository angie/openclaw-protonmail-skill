interface ParsedAddress {
  text?: string;
}

interface ParsedAttachment {
  filename?: string;
  contentType?: string;
  size?: number;
}

interface ParsedEmail {
  from?: ParsedAddress;
  to?: ParsedAddress;
  subject?: string;
  date?: Date;
  text?: string;
  html?: string;
  attachments?: ParsedAttachment[];
}

interface ReadEmailOutput {
  from?: string;
  to?: string;
  subject?: string;
  date?: Date;
  text?: string;
  html?: string;
  attachments: Array<{ filename?: string; contentType?: string; size?: number }>;
}

export function formatReadEmailOutput(email: ParsedEmail, includeBody: boolean): ReadEmailOutput {
  const output: ReadEmailOutput = {
    from: email.from?.text,
    to: email.to?.text,
    subject: email.subject,
    date: email.date,
    attachments: (email.attachments || []).map((attachment) => ({
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
    })),
  };

  if (includeBody) {
    output.text = email.text;
    output.html = email.html;
  }

  return output;
}

export function redactErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'Operation failed';
}
