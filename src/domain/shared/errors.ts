export class DomainRuleError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(code: string, message: string, statusCode: number = 400) {
    super(message);
    this.name = 'DomainRuleError';
    this.code = code;
    this.statusCode = statusCode;
  }
}
