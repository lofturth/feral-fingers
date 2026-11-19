export type DiagnosticEvent = { timestamp: number; type: string; detail: string; attemptId?: number };
export type LogEvent = (event: DiagnosticEvent) => void;
