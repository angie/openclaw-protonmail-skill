import {
  assertMessageUid,
  normaliseLimit,
  sanitiseHeaderValue,
  sanitiseRequiredText,
} from '../src/validation';

describe('validation helpers', () => {
  it('normalises undefined limit to default value', () => {
    expect(normaliseLimit(undefined, { defaultValue: 10, maxValue: 100 })).toBe(10);
  });

  it('rejects non-finite limit values', () => {
    expect(() => normaliseLimit(Number.NaN, { defaultValue: 10, maxValue: 100 })).toThrow(
      'Limit must be a finite number'
    );
  });

  it('rejects limit values above max', () => {
    expect(() => normaliseLimit(101, { defaultValue: 10, maxValue: 100 })).toThrow(
      'Limit must be between 1 and 100'
    );
  });

  it('accepts strict positive message UID values', () => {
    expect(assertMessageUid('12345')).toBe('12345');
  });

  it('rejects message UID range syntax', () => {
    expect(() => assertMessageUid('1:*')).toThrow('Message ID must be a positive numeric UID');
  });

  it('rejects message UID with surrounding whitespace', () => {
    expect(() => assertMessageUid(' 12 ')).toThrow('Message ID must be a positive numeric UID');
  });

  it('rejects control characters in header values', () => {
    expect(() => sanitiseHeaderValue('alice@example.com\nBCC:mallory@example.com', 'to')).toThrow(
      'to contains invalid control characters'
    );
  });

  it('requires non-empty text values for required fields', () => {
    expect(() => sanitiseRequiredText('   ', 'body')).toThrow('body is required');
  });
});
