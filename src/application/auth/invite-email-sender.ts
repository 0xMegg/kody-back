import { Socket, createConnection } from 'node:net';
import { connect as createTlsConnection } from 'node:tls';
import type { Role } from '@/domain/shared/types.js';

export interface InviteEmailInput {
  to: string;
  signupUrl: string;
  expiresAt: Date;
  roles: Role[];
}

export interface InviteEmailDelivery {
  status: 'SENT' | 'RECORDED';
  channel: 'dev-outbox' | 'smtp';
}

export interface InviteEmailSender {
  sendInviteEmail(input: InviteEmailInput): Promise<InviteEmailDelivery>;
}

export class DevOutboxInviteEmailSender implements InviteEmailSender {
  async sendInviteEmail(_input: InviteEmailInput): Promise<InviteEmailDelivery> {
    // Dev-safe fallback: no token-bearing URL is printed to logs and no email is sent.
    return { status: 'RECORDED', channel: 'dev-outbox' };
  }
}

export interface SmtpInviteEmailSenderConfig {
  host: string;
  port: number;
  from: string;
  user?: string;
  password?: string;
  secure?: boolean;
  requireTls?: boolean;
}

export class SmtpInviteEmailSender implements InviteEmailSender {
  constructor(private readonly config: SmtpInviteEmailSenderConfig) {}

  async sendInviteEmail(input: InviteEmailInput): Promise<InviteEmailDelivery> {
    const client = new SmtpClient(this.config);
    const subject = '[KODY] 사용자 초대가 도착했습니다';
    const textBody = buildTextBody(input);
    const htmlBody = buildHtmlBody(input);
    const boundary = `kody-invite-${Date.now()}`;
    const message = [
      `From: ${formatHeaderAddress(this.config.from)}`,
      `To: ${formatHeaderAddress(input.to)}`,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      textBody,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      htmlBody,
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    await client.send({ from: envelopeAddress(this.config.from), to: envelopeAddress(input.to), message });
    return { status: 'SENT', channel: 'smtp' };
  }
}

function buildTextBody(input: InviteEmailInput): string {
  return [
    'KODY 사용자 초대가 도착했습니다.',
    '',
    `부여 예정 권한: ${input.roles.join(', ')}`,
    `초대 만료: ${input.expiresAt.toISOString()}`,
    '',
    '아래 링크를 열어 계정을 생성해 주세요.',
    input.signupUrl,
    '',
    '본인이 요청하지 않은 초대라면 이 메일을 무시해 주세요.',
  ].join('\n');
}

function buildHtmlBody(input: InviteEmailInput): string {
  const escapedUrl = escapeHtml(input.signupUrl);
  return [
    '<!doctype html>',
    '<html><body style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; line-height: 1.5;">',
    '<h2>KODY 사용자 초대</h2>',
    '<p>KODY OMS에 초대되었습니다. 아래 버튼을 눌러 계정을 생성해 주세요.</p>',
    `<p><strong>부여 예정 권한:</strong> ${escapeHtml(input.roles.join(', '))}</p>`,
    `<p><strong>초대 만료:</strong> ${escapeHtml(input.expiresAt.toISOString())}</p>`,
    `<p><a href="${escapedUrl}" style="display:inline-block;padding:10px 14px;background:#111827;color:#fff;text-decoration:none;border-radius:8px;">가입하기</a></p>`,
    `<p style="font-size:12px;color:#6b7280;">버튼이 열리지 않으면 다음 링크를 복사해 주세요:<br>${escapedUrl}</p>`,
    '</body></html>',
  ].join('');
}

interface SmtpMessage {
  from: string;
  to: string;
  message: string;
}

class SmtpClient {
  constructor(private readonly config: SmtpInviteEmailSenderConfig) {}

  async send(message: SmtpMessage): Promise<void> {
    let socket = await this.openSocket();
    let reader = new SmtpReader(socket);

    try {
      await reader.expect(220);
      await this.command(socket, reader, `EHLO kody.local`, 250);

      if (this.config.requireTls && !this.config.secure) {
        await this.command(socket, reader, 'STARTTLS', 220);
        socket = await this.upgradeToTls(socket);
        reader = new SmtpReader(socket);
        await this.command(socket, reader, `EHLO kody.local`, 250);
      }

      if (this.config.user || this.config.password) {
        if (!this.config.user || !this.config.password) {
          throw new Error('SMTP_USER and SMTP_PASSWORD must be configured together');
        }
        await this.command(socket, reader, `AUTH PLAIN ${authPlain(this.config.user, this.config.password)}`, 235);
      }

      await this.command(socket, reader, `MAIL FROM:<${message.from}>`, 250);
      await this.command(socket, reader, `RCPT TO:<${message.to}>`, 250);
      await this.command(socket, reader, 'DATA', 354);
      socket.write(`${dotStuff(message.message)}\r\n.\r\n`);
      await reader.expect(250);
      await this.command(socket, reader, 'QUIT', 221);
    } finally {
      socket.end();
    }
  }

  private async openSocket(): Promise<Socket> {
    const socket = this.config.secure
      ? createTlsConnection({ host: this.config.host, port: this.config.port, servername: this.config.host })
      : createConnection({ host: this.config.host, port: this.config.port });
    socket.setTimeout(10_000);
    if (this.config.secure) {
      await new Promise<void>((resolve, reject) => {
        socket.once('secureConnect', resolve);
        socket.once('error', reject);
      });
    }
    return socket;
  }

  private async upgradeToTls(socket: Socket): Promise<Socket> {
    const tlsSocket = createTlsConnection({ socket, servername: this.config.host });
    tlsSocket.setTimeout(10_000);
    await new Promise<void>((resolve, reject) => {
      tlsSocket.once('secureConnect', resolve);
      tlsSocket.once('error', reject);
    });
    return tlsSocket;
  }

  private async command(socket: Socket, reader: SmtpReader, command: string, expectedCode: number): Promise<SmtpResponse> {
    socket.write(`${command}\r\n`);
    return reader.expect(expectedCode);
  }
}

interface SmtpResponse {
  code: number;
  lines: string[];
}

class SmtpReader {
  private buffer = '';
  private pending: Array<{
    expectedCode: number;
    resolve: (response: SmtpResponse) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(socket: Socket) {
    socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      this.drain();
    });
    socket.on('error', (error) => this.rejectAll(error));
    socket.on('timeout', () => this.rejectAll(new Error('SMTP connection timed out')));
  }

  expect(expectedCode: number): Promise<SmtpResponse> {
    return new Promise((resolve, reject) => {
      this.pending.push({ expectedCode, resolve, reject });
      this.drain();
    });
  }

  private drain(): void {
    while (this.pending.length > 0) {
      const response = this.nextCompleteResponse();
      if (!response) return;
      const pending = this.pending.shift();
      if (!pending) return;
      if (response.code !== pending.expectedCode) {
        pending.reject(new Error(`SMTP expected ${pending.expectedCode}, got ${response.code}`));
      } else {
        pending.resolve(response);
      }
    }
  }

  private nextCompleteResponse(): SmtpResponse | null {
    const lineMatches = [...this.buffer.matchAll(/([^\r\n]*(?:\r?\n))/g)];
    if (lineMatches.length === 0) return null;

    const lines: string[] = [];
    let consumed = 0;
    let code: number | null = null;
    for (const match of lineMatches) {
      const rawLine = match[1];
      if (!rawLine) continue;
      consumed += rawLine.length;
      const line = rawLine.replace(/\r?\n$/, '');
      lines.push(line);
      const complete = line.match(/^(\d{3}) /);
      if (complete) {
        code = Number(complete[1]);
        break;
      }
    }

    if (code === null) return null;
    this.buffer = this.buffer.slice(consumed);
    return { code, lines };
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.splice(0)) {
      pending.reject(error);
    }
  }
}

function authPlain(user: string, password: string): string {
  return Buffer.from(`\0${user}\0${password}`, 'utf8').toString('base64');
}

function dotStuff(message: string): string {
  return message.replace(/\r?\n\./g, '\r\n..');
}

function formatHeaderAddress(address: string): string {
  return address.replace(/[\r\n]/g, '');
}

function envelopeAddress(address: string): string {
  const trimmed = address.replace(/[\r\n]/g, '').trim();
  const angleMatch = trimmed.match(/<([^<>]+)>/);
  return (angleMatch?.[1] ?? trimmed).trim();
}

function encodeHeader(value: string): string {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
