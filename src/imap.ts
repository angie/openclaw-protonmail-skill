import { ImapFlow, SearchObject } from 'imapflow';
import { ParsedMail, simpleParser } from 'mailparser';
import { assertMessageUid, normaliseLimit } from './validation';

const DEFAULT_LIMIT = 10;
const MAX_RESULT_LIMIT = 100;
const CONNECT_TIMEOUT_MS = 10000;
const READ_TIMEOUT_MS = 15000;
const MAX_MESSAGE_BYTES = 5 * 1024 * 1024;

export interface IMAPConfig {
  user: string;
  password: string;
  host: string;
  port: number;
  tls: boolean;
  tlsOptions?: { rejectUnauthorized: boolean };
}

export interface EmailMetadata {
  uid: string;
  from: string;
  subject: string;
  date: Date;
  flags: string[];
}

export class IMAPClient {
  private client: ImapFlow;
  private isConnected = false;

  constructor(config: IMAPConfig) {
    this.client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.tls,
      doSTARTTLS: false,
      auth: {
        user: config.user,
        pass: config.password,
      },
      tls: config.tlsOptions,
      logger: false,
      connectionTimeout: CONNECT_TIMEOUT_MS,
    });

    this.client.on('error', () => {
      this.isConnected = false;
    });

    this.client.on('close', () => {
      this.isConnected = false;
    });
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    await withTimeout(this.client.connect(), CONNECT_TIMEOUT_MS, 'IMAP connection timeout - is Bridge running?');
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      await this.client.logout();
    } catch {
      this.client.close();
    } finally {
      this.isConnected = false;
    }
  }

  async listInbox(limit = DEFAULT_LIMIT, unreadOnly = false): Promise<EmailMetadata[]> {
    const validatedLimit = normaliseLimit(limit, {
      defaultValue: DEFAULT_LIMIT,
      maxValue: MAX_RESULT_LIMIT,
    });

    await this.client.mailboxOpen('INBOX', { readOnly: true });

    const query: SearchObject = unreadOnly ? { seen: false } : { all: true };
    const results = await this.client.search(query, { uid: true });
    if (!results || results.length === 0) {
      return [];
    }

    const uids = results.slice(-validatedLimit).reverse();
    const emails: EmailMetadata[] = [];

    for await (const message of this.client.fetch(
      uids,
      { uid: true, envelope: true, flags: true },
      { uid: true }
    )) {
      emails.push({
        uid: message.uid.toString(),
        from: message.envelope?.from?.[0]?.address || '',
        subject: message.envelope?.subject || '',
        date: message.envelope?.date || new Date(''),
        flags: Array.from(message.flags || []),
      });
    }

    return emails;
  }

  async search(query: string, limit = DEFAULT_LIMIT): Promise<EmailMetadata[]> {
    const validatedLimit = normaliseLimit(limit, {
      defaultValue: DEFAULT_LIMIT,
      maxValue: MAX_RESULT_LIMIT,
    });

    await this.client.mailboxOpen('INBOX', { readOnly: true });

    const criteria = this.parseSearchQuery(query);
    const results = await this.client.search(criteria, { uid: true });
    if (!results || results.length === 0) {
      return [];
    }

    const uids = results.slice(-validatedLimit).reverse();
    const emails: EmailMetadata[] = [];

    for await (const message of this.client.fetch(
      uids,
      { uid: true, envelope: true, flags: true },
      { uid: true }
    )) {
      emails.push({
        uid: message.uid.toString(),
        from: message.envelope?.from?.[0]?.address || '',
        subject: message.envelope?.subject || '',
        date: message.envelope?.date || new Date(''),
        flags: Array.from(message.flags || []),
      });
    }

    return emails;
  }

  async readMessage(messageId: string): Promise<ParsedMail> {
    const uid = Number(assertMessageUid(messageId));
    await this.client.mailboxOpen('INBOX', { readOnly: true });

    const message = await withTimeout(
      this.client.fetchOne(
        uid,
        {
          uid: true,
          source: { maxLength: MAX_MESSAGE_BYTES + 1 },
        },
        { uid: true }
      ),
      READ_TIMEOUT_MS,
      'Timed out while reading email content'
    );

    if (!message || !message.source) {
      throw new Error('Message not found');
    }

    if (message.source.length > MAX_MESSAGE_BYTES) {
      throw new Error(`Email content exceeds limit of ${MAX_MESSAGE_BYTES} bytes`);
    }

    return simpleParser(message.source);
  }

  private parseSearchQuery(query: string): SearchObject {
    const criteria: SearchObject = {};
    const normalisedQuery = this.sanitizeSearchInput(query);
    const filterRegex = /(from|subject|body):(?:"([^"]{1,200})"|([^\s]{1,200}))/gi;
    let match: RegExpExecArray | null;

    while ((match = filterRegex.exec(normalisedQuery)) !== null) {
      const key = match[1].toLowerCase();
      const rawValue = (match[2] || match[3] || '').trim();
      const value = this.sanitizeSearchValue(rawValue);
      if (!value) {
        continue;
      }

      if (key === 'from') criteria.from = value;
      if (key === 'subject') criteria.subject = value;
      if (key === 'body') criteria.body = value;
    }

    const dateMatch = normalisedQuery.match(/newer_than:(\d{1,3})([dh])/i);
    if (dateMatch) {
      const value = parseInt(dateMatch[1], 10);
      const unit = dateMatch[2].toLowerCase();
      if (value > 0 && value <= 365) {
        const date = new Date();
        if (unit === 'd') {
          date.setDate(date.getDate() - value);
        } else if (unit === 'h') {
          date.setHours(date.getHours() - value);
        }
        criteria.since = date;
      }
    }

    if (Object.keys(criteria).length === 0) {
      const fallbackQuery = normalisedQuery
        .replace(/\b(from|subject|body|newer_than):[^\s]+/gi, '')
        .trim();
      const fallback = this.sanitizeSearchValue(fallbackQuery);
      if (!fallback) {
        throw new Error('Search query is empty or contains unsupported characters');
      }

      return { subject: fallback };
    }

    return criteria;
  }

  private sanitizeSearchInput(input: string): string {
    const trimmed = (input || '').trim();
    if (!trimmed) {
      throw new Error('Search query is required');
    }

    if (trimmed.length > 200) {
      throw new Error('Search query too long (max 200 chars)');
    }

    if (this.hasControlCharacters(trimmed)) {
      throw new Error('Search query contains invalid control characters');
    }

    return trimmed;
  }

  private sanitizeSearchValue(input: string): string {
    const value = (input || '').trim();
    if (!value) {
      return '';
    }

    if (!/^[a-zA-Z0-9@._+\-\s:]+$/.test(value)) {
      throw new Error('Search query contains unsupported characters');
    }

    return value.slice(0, 200);
  }

  private hasControlCharacters(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
      const codePoint = value.charCodeAt(index);
      if (codePoint < 32 || codePoint === 127) {
        return true;
      }
    }

    return false;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}
