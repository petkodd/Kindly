/** Thrown when the SMS provider (Twilio) call fails. Never carries the number or message body. */
export class SmsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmsError';
  }
}

export interface SendSmsInput {
  /** E.164 number, e.g. +15551234567. */
  to: string;
  body: string;
}

export interface SendSmsResult {
  /** Provider message id, or a fake-* id when the deterministic fake is used. */
  id: string;
}

export interface SmsClient {
  send(input: SendSmsInput): Promise<SendSmsResult>;
}
