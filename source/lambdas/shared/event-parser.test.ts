/**
 * Tests for CloudTrail MoveAccount event parser
 */

import { describe, it, expect } from '@jest/globals';
import type { SQSEvent } from 'aws-lambda';
import {
  parseCloudTrailEvents,
  parseRawCloudTrailEvent,
  isValidAccountId,
  isValidOuId,
  isValidParentId,
  EventParseError,
} from './event-parser.js';
import { LOG_ACTIONS, MAX_SQS_RECORDS_PER_BATCH } from './constants.js';

// Import test fixtures
import cloudTrailEvent from '../__fixtures__/cloudtrail-move-account-event.json' with { type: 'json' };
import sqsEventWrapper from '../__fixtures__/sqs-event-wrapper.json' with { type: 'json' };

describe('parseCloudTrailEvents', () => {
  describe('given a valid SQS event with CloudTrail MoveAccount event', () => {
    it('should successfully parse the event', () => {
      const result = parseCloudTrailEvents(sqsEventWrapper as SQSEvent);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        accountId: '417845783913',
        sourceParentId: 'ou-2laj-x3o8lbk8',
        destinationParentId: 'ou-2laj-oihxgbtr',
        eventTime: '2026-01-28T14:44:00Z',
        eventId: 'abcdef12-3456-7890-abcd-ef1234567890',
      });
    });
  });

  describe('given an SQS event with no records', () => {
    it('should throw EventParseError', () => {
      const emptyEvent: SQSEvent = { Records: [] };

      expect(() => parseCloudTrailEvents(emptyEvent)).toThrow(EventParseError);
      expect(() => parseCloudTrailEvents(emptyEvent)).toThrow(
        'SQS event contains no records'
      );
    });
  });

  describe('given an SQS event with invalid JSON body', () => {
    it('should throw EventParseError with parse details', () => {
      const invalidEvent: SQSEvent = {
        Records: [
          {
            messageId: 'msg-123',
            receiptHandle: 'handle',
            body: 'not valid json',
            attributes: {} as SQSEvent['Records'][0]['attributes'],
            messageAttributes: {},
            md5OfBody: 'abc',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:us-west-2:123456789012:queue',
            awsRegion: 'us-west-2',
          },
        ],
      };

      expect(() => parseCloudTrailEvents(invalidEvent)).toThrow(EventParseError);
      expect(() => parseCloudTrailEvents(invalidEvent)).toThrow(
        'Failed to parse SQS message body as JSON'
      );
    });
  });

  describe('given an SQS event with missing required fields', () => {
    it('should throw EventParseError for missing accountId', () => {
      const eventWithoutAccountId = {
        ...cloudTrailEvent,
        detail: {
          ...cloudTrailEvent.detail,
          requestParameters: {
            sourceParentId: 'ou-2laj-x3o8lbk8',
            destinationParentId: 'ou-2laj-oihxgbtr',
          },
        },
      };

      const sqsEvent: SQSEvent = {
        Records: [
          {
            messageId: 'msg-123',
            receiptHandle: 'handle',
            body: JSON.stringify(eventWithoutAccountId),
            attributes: {} as SQSEvent['Records'][0]['attributes'],
            messageAttributes: {},
            md5OfBody: 'abc',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:us-west-2:123456789012:queue',
            awsRegion: 'us-west-2',
          },
        ],
      };

      expect(() => parseCloudTrailEvents(sqsEvent)).toThrow(EventParseError);
      expect(() => parseCloudTrailEvents(sqsEvent)).toThrow(
        'CloudTrail event validation failed'
      );
    });

    it('should throw EventParseError for invalid event source', () => {
      const invalidSourceEvent = {
        ...cloudTrailEvent,
        source: 'aws.ec2', // Wrong source
      };

      const sqsEvent: SQSEvent = {
        Records: [
          {
            messageId: 'msg-123',
            receiptHandle: 'handle',
            body: JSON.stringify(invalidSourceEvent),
            attributes: {} as SQSEvent['Records'][0]['attributes'],
            messageAttributes: {},
            md5OfBody: 'abc',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:us-west-2:123456789012:queue',
            awsRegion: 'us-west-2',
          },
        ],
      };

      expect(() => parseCloudTrailEvents(sqsEvent)).toThrow(EventParseError);
    });

    it('should throw EventParseError for invalid event name', () => {
      const invalidEventName = {
        ...cloudTrailEvent,
        detail: {
          ...cloudTrailEvent.detail,
          eventName: 'CreateAccount', // Wrong event name
        },
      };

      const sqsEvent: SQSEvent = {
        Records: [
          {
            messageId: 'msg-123',
            receiptHandle: 'handle',
            body: JSON.stringify(invalidEventName),
            attributes: {} as SQSEvent['Records'][0]['attributes'],
            messageAttributes: {},
            md5OfBody: 'abc',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:us-west-2:123456789012:queue',
            awsRegion: 'us-west-2',
          },
        ],
      };

      expect(() => parseCloudTrailEvents(sqsEvent)).toThrow(EventParseError);
    });
  });

  describe('given SQS batch exceeding maximum size', () => {
    it('should throw EventParseError for batch exceeding MAX_SQS_RECORDS_PER_BATCH', () => {
      const createRecord = (index: number) => ({
        messageId: `msg-${index}`,
        receiptHandle: `handle-${index}`,
        body: JSON.stringify(cloudTrailEvent),
        attributes: {} as SQSEvent['Records'][0]['attributes'],
        messageAttributes: {},
        md5OfBody: 'abc',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn:aws:sqs:us-west-2:123456789012:queue',
        awsRegion: 'us-west-2',
      });

      // Create more records than allowed
      const oversizedBatch: SQSEvent = {
        Records: Array.from({ length: MAX_SQS_RECORDS_PER_BATCH + 1 }, (_, i) =>
          createRecord(i)
        ),
      };

      expect(() => parseCloudTrailEvents(oversizedBatch)).toThrow(EventParseError);
      expect(() => parseCloudTrailEvents(oversizedBatch)).toThrow(
        `SQS batch size ${MAX_SQS_RECORDS_PER_BATCH + 1} exceeds maximum ${MAX_SQS_RECORDS_PER_BATCH}`
      );
    });
  });

  describe('given an event with root ID as source parent', () => {
    it('should successfully parse events from root OU', () => {
      const eventFromRoot = {
        ...cloudTrailEvent,
        detail: {
          ...cloudTrailEvent.detail,
          requestParameters: {
            accountId: '417845783913',
            sourceParentId: 'r-2laj', // Root ID instead of OU
            destinationParentId: 'ou-2laj-oihxgbtr',
          },
        },
      };

      const sqsEvent: SQSEvent = {
        Records: [
          {
            messageId: 'msg-root',
            receiptHandle: 'handle',
            body: JSON.stringify(eventFromRoot),
            attributes: {} as SQSEvent['Records'][0]['attributes'],
            messageAttributes: {},
            md5OfBody: 'abc',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:us-west-2:123456789012:queue',
            awsRegion: 'us-west-2',
          },
        ],
      };

      const result = parseCloudTrailEvents(sqsEvent);
      expect(result).toHaveLength(1);
      expect(result[0].sourceParentId).toBe('r-2laj');
    });
  });

  describe('given multiple SQS records', () => {
    it('should parse all records', () => {
      const multiRecordEvent: SQSEvent = {
        Records: [
          {
            messageId: 'msg-1',
            receiptHandle: 'handle1',
            body: JSON.stringify(cloudTrailEvent),
            attributes: {} as SQSEvent['Records'][0]['attributes'],
            messageAttributes: {},
            md5OfBody: 'abc',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:us-west-2:123456789012:queue',
            awsRegion: 'us-west-2',
          },
          {
            messageId: 'msg-2',
            receiptHandle: 'handle2',
            body: JSON.stringify({
              ...cloudTrailEvent,
              detail: {
                ...cloudTrailEvent.detail,
                requestParameters: {
                  accountId: '123456789012',
                  sourceParentId: 'ou-2laj-x3o8lbk8',
                  destinationParentId: 'ou-2laj-oihxgbtr',
                },
                eventID: 'second-event-id',
              },
            }),
            attributes: {} as SQSEvent['Records'][0]['attributes'],
            messageAttributes: {},
            md5OfBody: 'def',
            eventSource: 'aws:sqs',
            eventSourceARN: 'arn:aws:sqs:us-west-2:123456789012:queue',
            awsRegion: 'us-west-2',
          },
        ],
      };

      const results = parseCloudTrailEvents(multiRecordEvent);

      expect(results).toHaveLength(2);
      expect(results[0].accountId).toBe('417845783913');
      expect(results[1].accountId).toBe('123456789012');
      expect(results[1].eventId).toBe('second-event-id');
    });
  });
});

describe('parseRawCloudTrailEvent', () => {
  describe('given a valid CloudTrail event object', () => {
    it('should successfully parse the event', () => {
      const result = parseRawCloudTrailEvent(cloudTrailEvent);

      expect(result).toEqual({
        accountId: '417845783913',
        sourceParentId: 'ou-2laj-x3o8lbk8',
        destinationParentId: 'ou-2laj-oihxgbtr',
        eventTime: '2026-01-28T14:44:00Z',
        eventId: 'abcdef12-3456-7890-abcd-ef1234567890',
      });
    });
  });

  describe('given an invalid CloudTrail event object', () => {
    it('should throw EventParseError', () => {
      const invalidEvent = { foo: 'bar' };

      expect(() => parseRawCloudTrailEvent(invalidEvent)).toThrow(EventParseError);
    });
  });
});

describe('EventParseError', () => {
  it('should have correct name and action', () => {
    const error = new EventParseError('Test error', LOG_ACTIONS.PARSE_ERROR, {
      key: 'value',
    });

    expect(error.name).toBe('EventParseError');
    expect(error.action).toBe(LOG_ACTIONS.PARSE_ERROR);
    expect(error.details).toEqual({ key: 'value' });
    expect(error.message).toBe('Test error');
  });

  it('should default action to PARSE_ERROR', () => {
    const error = new EventParseError('Test error');

    expect(error.action).toBe(LOG_ACTIONS.PARSE_ERROR);
  });
});

describe('isValidAccountId', () => {
  it('should return true for valid 12-digit account IDs', () => {
    expect(isValidAccountId('123456789012')).toBe(true);
    expect(isValidAccountId('000000000000')).toBe(true);
    expect(isValidAccountId('999999999999')).toBe(true);
  });

  it('should return false for invalid account IDs', () => {
    expect(isValidAccountId('12345678901')).toBe(false); // Too short
    expect(isValidAccountId('1234567890123')).toBe(false); // Too long
    expect(isValidAccountId('12345678901a')).toBe(false); // Contains letter
    expect(isValidAccountId('')).toBe(false); // Empty
  });
});

describe('isValidOuId', () => {
  it('should return true for valid OU IDs', () => {
    expect(isValidOuId('ou-2laj-x3o8lbk8')).toBe(true);
    expect(isValidOuId('ou-abcd-12345678')).toBe(true);
    expect(isValidOuId('ou-test-oihxgbtr')).toBe(true);
  });

  it('should return false for invalid OU IDs', () => {
    expect(isValidOuId('r-2laj')).toBe(false); // Root ID
    expect(isValidOuId('ou-2laj')).toBe(false); // Missing second part
    expect(isValidOuId('123456789012')).toBe(false); // Account ID
    expect(isValidOuId('')).toBe(false); // Empty
    expect(isValidOuId('ou-AB-12345678')).toBe(false); // Uppercase (invalid)
  });
});

describe('isValidParentId', () => {
  it('should return true for valid OU IDs', () => {
    expect(isValidParentId('ou-2laj-x3o8lbk8')).toBe(true);
    expect(isValidParentId('ou-abcd-12345678')).toBe(true);
  });

  it('should return true for valid root IDs', () => {
    expect(isValidParentId('r-2laj')).toBe(true);
    expect(isValidParentId('r-abcd')).toBe(true);
    expect(isValidParentId('r-1234567890')).toBe(true);
  });

  it('should return false for invalid parent IDs', () => {
    expect(isValidParentId('123456789012')).toBe(false); // Account ID
    expect(isValidParentId('')).toBe(false); // Empty
    expect(isValidParentId('ou-short')).toBe(false); // Invalid OU
    expect(isValidParentId('R-2laj')).toBe(false); // Uppercase R
  });
});
