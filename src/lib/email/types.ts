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
  /**
   * True when no email actually left the app (the deterministic fake, used in
   * local dev, tests and DEMO_MODE). Callers record such deliveries as
   * 'simulated', never 'sent'.
   */
  simulated?: boolean;
}

export interface EmailClient {
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
