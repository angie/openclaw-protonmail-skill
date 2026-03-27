import Imap from 'imap';
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
  private imap: Imap;
  private isConnected = false;

  constructor(config: IMAPConfig) {
    this.imap = new Imap(config);

    this.imap.on('error', () => {
      this.isConnected = false;
    });

    this.imap.on('end', () => {
      this.isConnected = false;
    });
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('IMAP connection timeout - is Bridge running?'));
      }, CONNECT_TIMEOUT_MS);

      this.imap.once('ready', () => {
        clearTimeout(timeout);
        this.isConnected = true;
        resolve();
      });

      this.imap.once('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.imap.connect();
    });
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      this.imap.end();
      this.isConnected = false;
    }
  }

  async listInbox(limit = DEFAULT_LIMIT, unreadOnly = false): Promise<EmailMetadata[]> {
    const validatedLimit = normaliseLimit(limit, {
      defaultValue: DEFAULT_LIMIT,
      maxValue: MAX_RESULT_LIMIT,
    });

    return new Promise((resolve, reject) => {
      this.imap.openBox('INBOX', true, (openError) => {
        if (openError) {
          reject(openError);
          return;
        }

        const searchCriteria = unreadOnly ? ['UNSEEN'] : ['ALL'];

        this.imap.search(searchCriteria, (searchError, results) => {
          if (searchError) {
            reject(searchError);
            return;
          }

          if (!results || results.length === 0) {
            resolve([]);
            return;
          }

          const uids = results.slice(-validatedLimit).reverse();
          const emails: EmailMetadata[] = [];
          const fetch = this.imap.fetch(uids, {
            bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
            struct: true,
          });

          fetch.on('message', (msg) => {
            let buffer = '';
            let uid = '';

            msg.on('body', (stream) => {
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });
            });

            msg.once('attributes', (attrs) => {
              uid = attrs.uid.toString();
            });

            msg.once('end', () => {
              const header = Imap.parseHeader(buffer);
              emails.push({
                uid,
                from: Array.isArray(header.from) ? header.from[0] : header.from || '',
                subject: Array.isArray(header.subject) ? header.subject[0] : header.subject || '',
                date: new Date(Array.isArray(header.date) ? header.date[0] : header.date || ''),
                flags: [],
              });
            });
          });

          fetch.once('error', reject);
          fetch.once('end', () => {
            resolve(emails);
          });
        });
      });
    });
  }

  async search(query: string, limit = DEFAULT_LIMIT): Promise<EmailMetadata[]> {
    const validatedLimit = normaliseLimit(limit, {
      defaultValue: DEFAULT_LIMIT,
      maxValue: MAX_RESULT_LIMIT,
    });

    return new Promise((resolve, reject) => {
      this.imap.openBox('INBOX', true, (openError) => {
        if (openError) {
          reject(openError);
          return;
        }

        const criteria = this.parseSearchQuery(query);

        this.imap.search(criteria, (searchError, results) => {
          if (searchError) {
            reject(searchError);
            return;
          }

          if (!results || results.length === 0) {
            resolve([]);
            return;
          }

          const uids = results.slice(-validatedLimit).reverse();
          const emails: EmailMetadata[] = [];
          const fetch = this.imap.fetch(uids, {
            bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
            struct: true,
          });

          fetch.on('message', (msg) => {
            let buffer = '';
            let uid = '';

            msg.on('body', (stream) => {
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });
            });

            msg.once('attributes', (attrs) => {
              uid = attrs.uid.toString();
            });

            msg.once('end', () => {
              const header = Imap.parseHeader(buffer);
              emails.push({
                uid,
                from: Array.isArray(header.from) ? header.from[0] : header.from || '',
                subject: Array.isArray(header.subject) ? header.subject[0] : header.subject || '',
                date: new Date(Array.isArray(header.date) ? header.date[0] : header.date || ''),
                flags: [],
              });
            });
          });

          fetch.once('error', reject);
          fetch.once('end', () => {
            resolve(emails);
          });
        });
      });
    });
  }

  private parseSearchQuery(query: string): any[] {
    const criteria: any[] = [];
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

      if (key === 'from') criteria.push(['FROM', value]);
      if (key === 'subject') criteria.push(['SUBJECT', value]);
      if (key === 'body') criteria.push(['BODY', value]);
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

        criteria.push(['SINCE', date]);
      }
    }

    if (criteria.length === 0) {
      const fallbackQuery = normalisedQuery
        .replace(/\b(from|subject|body|newer_than):[^\s]+/gi, '')
        .trim();
      const fallback = this.sanitizeSearchValue(fallbackQuery);
      if (!fallback) {
        throw new Error('Search query is empty or contains unsupported characters');
      }
      criteria.push(['SUBJECT', fallback]);
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

  async readMessage(messageId: string): Promise<ParsedMail> {
    const uid = assertMessageUid(messageId);

    return new Promise((resolve, reject) => {
      let settled = false;

      const fail = (error: Error): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        reject(error);
      };

      const succeed = (result: ParsedMail): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };

      const timeout = setTimeout(() => {
        fail(new Error('Timed out while reading email content'));
      }, READ_TIMEOUT_MS);

      this.imap.openBox('INBOX', true, (openError) => {
        if (openError) {
          fail(openError);
          return;
        }

        const fetch = this.imap.fetch(uid, { bodies: '' });
        let sawMessage = false;

        fetch.on('message', (msg) => {
          sawMessage = true;

          msg.on('body', (stream) => {
            const chunks: Buffer[] = [];
            let totalBytes = 0;

            stream.on('data', (chunk: Buffer) => {
              if (settled) {
                return;
              }

              totalBytes += chunk.length;
              if (totalBytes > MAX_MESSAGE_BYTES) {
                fail(new Error(`Email content exceeds limit of ${MAX_MESSAGE_BYTES} bytes`));
                return;
              }

              chunks.push(chunk);
            });

            stream.once('end', async () => {
              if (settled) {
                return;
              }

              try {
                const parsed = await simpleParser(Buffer.concat(chunks, totalBytes));
                succeed(parsed);
              } catch (parseError) {
                const error = parseError instanceof Error
                  ? parseError
                  : new Error('Failed to parse email content');
                fail(error);
              }
            });

            stream.once('error', (streamError: Error) => {
              fail(streamError);
            });
          });
        });

        fetch.once('error', (fetchError: Error) => {
          fail(fetchError);
        });

        fetch.once('end', () => {
          if (!sawMessage) {
            fail(new Error('Message not found'));
            return;
          }

          if (!settled) {
            fail(new Error('Message read completed without content'));
          }
        });
      });
    });
  }
}
