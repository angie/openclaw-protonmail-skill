export interface LimitOptions {
  defaultValue: number;
  maxValue: number;
}

const MESSAGE_UID_REGEX = /^[1-9]\d{0,9}$/;

export function normaliseLimit(limit: number | undefined, options: LimitOptions): number {
  if (limit === undefined) {
    return options.defaultValue;
  }

  if (!Number.isFinite(limit)) {
    throw new Error('Limit must be a finite number');
  }

  const integerLimit = Math.trunc(limit);
  if (integerLimit < 1 || integerLimit > options.maxValue) {
    throw new Error(`Limit must be between 1 and ${options.maxValue}`);
  }

  return integerLimit;
}

export function assertMessageUid(messageId: string): string {
  if (!MESSAGE_UID_REGEX.test(messageId)) {
    throw new Error('Message ID must be a positive numeric UID');
  }

  return messageId;
}

export function sanitiseHeaderValue(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }

  if (hasControlCharacters(trimmed)) {
    throw new Error(`${fieldName} contains invalid control characters`);
  }

  return trimmed;
}

export function sanitiseOptionalHeaderValue(value: string | undefined, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return sanitiseHeaderValue(value, fieldName);
}

export function sanitiseRequiredText(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }

  if (hasDisallowedTextControlCharacters(trimmed)) {
    throw new Error(`${fieldName} contains invalid control characters`);
  }

  return trimmed;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint < 32 || codePoint === 127) {
      return true;
    }
  }

  return false;
}

function hasDisallowedTextControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    const isPrintableWhitespace = codePoint === 9 || codePoint === 10 || codePoint === 13;
    const isControlCharacter = codePoint < 32 || codePoint === 127;
    if (isControlCharacter && !isPrintableWhitespace) {
      return true;
    }
  }

  return false;
}
