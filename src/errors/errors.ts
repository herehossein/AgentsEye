/** Usage or input-validation error (exit code 2). */
export class UsageError extends Error {
  exitCode: number;

  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
    this.exitCode = 2;
  }
}

/** Runtime/navigation/dependency error (exit code 1). */
export class InspectorError extends Error {
  code: string;
  exitCode: number;

  constructor(message: string, code: string = 'RUNTIME_ERROR') {
    super(message);
    this.name = 'InspectorError';
    this.code = code;
    this.exitCode = 1;
  }
}
