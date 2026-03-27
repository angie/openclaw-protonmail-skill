/**
 * ProtonMail Skill for OpenClaw
 * 
 * Provides secure email integration through Proton Mail Bridge.
 * Bridge runs locally and provides IMAP/SMTP access to your ProtonMail account
 * while maintaining end-to-end encryption.
 * 
 * @packageDocumentation
 * 
 * @example
 * ```typescript
 * import ProtonMailSkill from 'openclaw-protonmail-skill';
 * 
 * const skill = new ProtonMailSkill({
 *   account: 'user@pm.me',
 *   bridgePassword: 'bridge-generated-password'
 * });
 * 
 * await skill.initialize();
 * const inbox = await skill.listInbox(10);
 * await skill.cleanup();
 * ```
 */

import { IMAPClient } from './imap';
import { SMTPClient } from './smtp';
import { registerTools } from './tools';
import { resolveBridgePassword } from './credential-store';
import { assertMessageUid, normaliseLimit } from './validation';

const DEFAULT_LIST_LIMIT = 10;
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_RESULT_LIMIT = 100;

/**
 * Configuration options for ProtonMail skill
 */
export interface ProtonMailConfig {
  /** ProtonMail account email (e.g., user@pm.me or user@protonmail.com) */
  account?: string;
  
  /** Bridge-generated password (NOT your ProtonMail password) */
  bridgePassword?: string;

  /** Optional keychain service name for Bridge password lookup */
  keychainService?: string;

  /** Optional keychain account override (default: ProtonMail account) */
  keychainAccount?: string;
  
  /** IMAP host (default: 127.0.0.1) */
  imapHost?: string;
  
  /** IMAP port (default: 1143) */
  imapPort?: number;
  
  /** SMTP host (default: 127.0.0.1) */
  smtpHost?: string;
  
  /** SMTP port (default: 1025) */
  smtpPort?: number;
}

/**
 * Load configuration from environment variables or passed config
 */
async function loadConfig(
  config?: ProtonMailConfig
): Promise<
  Required<Omit<ProtonMailConfig, 'account' | 'bridgePassword' | 'keychainService' | 'keychainAccount'>> & {
    account: string;
    bridgePassword: string;
    keychainService?: string;
    keychainAccount?: string;
  }
> {
  const account = config?.account || process.env.PROTONMAIL_ACCOUNT;

  if (!account) {
    throw new Error('ProtonMail account not configured. Set PROTONMAIL_ACCOUNT env var or pass account in config.');
  }

  const bridgePassword = await resolveBridgePassword({
    account,
    bridgePassword: config?.bridgePassword,
    envPassword: process.env.PROTONMAIL_BRIDGE_PASSWORD,
    keychainService: config?.keychainService || process.env.PROTONMAIL_KEYCHAIN_SERVICE,
    keychainAccount: config?.keychainAccount || process.env.PROTONMAIL_KEYCHAIN_ACCOUNT,
  });
  
  return {
    account,
    bridgePassword,
    imapHost: config?.imapHost || '127.0.0.1',
    imapPort: config?.imapPort || 1143,
    smtpHost: config?.smtpHost || '127.0.0.1',
    smtpPort: config?.smtpPort || 1025
  };
}

/**
 * Main skill class for ProtonMail integration
 * 
 * Manages IMAP and SMTP connections to Proton Mail Bridge and provides
 * high-level email operations for OpenClaw.
 */
export class ProtonMailSkill {
  private readonly config?: ProtonMailConfig;
  private imap: IMAPClient | null = null;
  private smtp: SMTPClient | null = null;

  /**
   * Create a new ProtonMail skill instance
   * 
   * @param config - Optional configuration. If not provided, reads from environment variables.
   * 
   * @remarks
   * The Bridge password is separate from your ProtonMail password. Get it from
   * Proton Mail Bridge → Account Settings → Mailbox Configuration.
   * 
   * Configuration priority:
   * 1. Passed config object
   * 2. Environment variables (PROTONMAIL_ACCOUNT, PROTONMAIL_BRIDGE_PASSWORD)
   */
  constructor(config?: ProtonMailConfig) {
    const account = config?.account || process.env.PROTONMAIL_ACCOUNT;
    if (!account) {
      throw new Error('ProtonMail account not configured. Set PROTONMAIL_ACCOUNT env var or pass account in config.');
    }

    this.config = config;
  }

  private getClients(): { imap: IMAPClient; smtp: SMTPClient } {
    if (!this.imap || !this.smtp) {
      throw new Error('ProtonMail skill is not initialized. Call initialize() first.');
    }

    return { imap: this.imap, smtp: this.smtp };
  }

  /**
   * Initialize the skill and register tools with OpenClaw
   *
   * @throws {Error} If Bridge is not running or credentials are invalid
   *
   * @remarks
   * Ensure Proton Mail Bridge is running before calling this method.
   */
  async initialize(): Promise<void> {
    if (this.imap && this.smtp) {
      return;
    }

    const fullConfig = await loadConfig(this.config);

    // Security hardening: Proton Bridge must be localhost-only
    const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
    if (!localHosts.has(fullConfig.imapHost) || !localHosts.has(fullConfig.smtpHost)) {
      throw new Error('Unsafe Bridge host configuration. IMAP/SMTP hosts must be localhost (127.0.0.1, localhost, or ::1).');
    }

    const imapConfig = {
      user: fullConfig.account,
      password: fullConfig.bridgePassword,
      host: fullConfig.imapHost,
      port: fullConfig.imapPort,
      tls: false,
    };

    const smtpConfig = {
      host: fullConfig.smtpHost,
      port: fullConfig.smtpPort,
      secure: false,
      auth: {
        user: fullConfig.account,
        pass: fullConfig.bridgePassword
      }
    };

    this.imap = new IMAPClient(imapConfig);
    this.smtp = new SMTPClient(smtpConfig);

    await this.imap.connect();
    registerTools(this);
  }

  /**
   * Cleanup and disconnect from Bridge
   * 
   * @remarks
   * Always call this when shutting down to cleanly close connections.
   */
  async cleanup(): Promise<void> {
    if (!this.imap) {
      return;
    }

    await this.imap.disconnect();
    this.imap = null;
    this.smtp = null;
  }

  // ========================================
  // Public methods for OpenClaw tool calls
  // ========================================

  /**
   * List recent emails from inbox
   * 
   * @param limit - Maximum number of emails to return (default: 10)
   * @param unreadOnly - Only return unread emails (default: false)
   * @returns Array of email metadata (sender, subject, date, etc.)
   * 
   * @example
   * ```typescript
   * const recent = await skill.listInbox(5, true); // 5 unread emails
   * ```
   */
  async listInbox(limit = 10, unreadOnly = false): Promise<any[]> {
    const { imap } = this.getClients();
    const validatedLimit = normaliseLimit(limit, {
      defaultValue: DEFAULT_LIST_LIMIT,
      maxValue: MAX_RESULT_LIMIT,
    });

    return imap.listInbox(validatedLimit, unreadOnly);
  }

  /**
   * Search emails by query
   * 
   * @param query - Search query (sender, subject, body keywords)
   * @param limit - Maximum results to return (default: 10)
   * @returns Matching emails
   * 
   * @example
   * ```typescript
   * const results = await skill.searchEmails('from:alice@example.com', 20);
   * ```
   */
  async searchEmails(query: string, limit = 10): Promise<any[]> {
    const { imap } = this.getClients();
    const validatedLimit = normaliseLimit(limit, {
      defaultValue: DEFAULT_SEARCH_LIMIT,
      maxValue: MAX_RESULT_LIMIT,
    });

    return imap.search(query, validatedLimit);
  }

  /**
   * Read a specific email by ID
   * 
   * @param messageId - Message UID or sequence number
   * @returns Full email content (headers, body, attachments)
   * 
   * @throws {Error} If message ID is invalid or email doesn't exist
   */
  async readEmail(messageId: string): Promise<any> {
    const { imap } = this.getClients();
    return imap.readMessage(assertMessageUid(messageId));
  }

  /**
   * Send a new email via ProtonMail
   * 
   * @param to - Recipient email address
   * @param subject - Email subject
   * @param body - Email body (plain text)
   * @param options - Optional settings (CC, BCC, HTML, attachments)
   * @returns Send result
   * 
   * @example
   * ```typescript
   * await skill.sendEmail(
   *   'alice@example.com',
   *   'Meeting Follow-up',
   *   'Thanks for the meeting today...',
   *   { cc: 'bob@example.com' }
   * );
   * ```
   */
  async sendEmail(to: string, subject: string, body: string, options?: any): Promise<any> {
    const { smtp } = this.getClients();
    return smtp.send(to, subject, body, options);
  }

  /**
   * Reply to an existing email thread
   * 
   * @param messageId - Original message ID to reply to
   * @param body - Reply text
   * @returns Send result
   * 
   * @remarks
   * Automatically sets Reply-To, In-Reply-To, and References headers
   * to maintain threading.
   */
  async replyToEmail(messageId: string, body: string): Promise<any> {
    const { imap, smtp } = this.getClients();
    const original = await imap.readMessage(assertMessageUid(messageId));
    return smtp.reply(original, body);
  }
}

export default ProtonMailSkill;
