export class OrchportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OrchportError";
    this.code = code;
  }
}
