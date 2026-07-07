/** Thrown when the email provider (Resend) call fails. */
export class EmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailError';
  }
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  /** Provider message id, or a fake-* id when the deterministic fake is used. */
  id: string;
}

export interface EmailClient {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
