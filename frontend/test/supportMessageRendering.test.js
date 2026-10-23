import { describe, it, expect } from 'vitest';
import { getSupportMessageText } from '../src/pages/Support.jsx';

describe('Checkpoint B Fix: Support Message Body Rendering', () => {

  describe('1. Canonical Backend Schema & DTO Contract ({ text: "..." })', () => {
    it('correctly extracts message text from user-created ticket initial message', () => {
      const userCreationMessage = {
        _id: 'msg-initial-1',
        sender: 'user-id-101',
        senderRole: 'user',
        senderDisplayName: 'ActiveGamer',
        text: 'Where is my itemized receipt for the battle pass?',
        createdAt: '2026-10-23T04:00:00.000Z'
      };

      const renderedText = getSupportMessageText(userCreationMessage);
      expect(renderedText).toBe('Where is my itemized receipt for the battle pass?');
    });

    it('correctly extracts message text from user follow-up reply', () => {
      const userReply = {
        _id: 'msg-reply-1',
        sender: 'user-id-101',
        senderRole: 'user',
        senderDisplayName: 'ActiveGamer',
        text: 'I checked my spam folder but the receipt was not there.',
        createdAt: '2026-10-23T04:10:00.000Z'
      };

      const renderedText = getSupportMessageText(userReply);
      expect(renderedText).toBe('I checked my spam folder but the receipt was not there.');
    });

    it('correctly extracts message text from staff official reply', () => {
      const staffReply = {
        _id: 'msg-staff-1',
        sender: 'staff-id-999',
        senderRole: 'staff',
        senderDisplayName: 'ZYNC Support',
        text: 'We have re-sent the receipt to your registered email address.',
        createdAt: '2026-10-23T04:20:00.000Z'
      };

      const renderedText = getSupportMessageText(staffReply);
      expect(renderedText).toBe('We have re-sent the receipt to your registered email address.');
    });

    it('correctly extracts message text from suspended user appeal statement and replies', () => {
      const appealStatement = {
        _id: 'appeal-msg-1',
        sender: 'suspended-user-id',
        senderRole: 'user',
        senderDisplayName: 'SuspendedGamer',
        text: 'I apologize for the false report incident; my account was compromised.',
        createdAt: '2026-10-23T03:00:00.000Z'
      };

      const renderedText = getSupportMessageText(appealStatement);
      expect(renderedText).toBe('I apologize for the false report incident; my account was compromised.');
    });
  });

  describe('2. Legacy and Client Fallback Compatibility ({ message: "..." })', () => {
    it('gracefully falls back to message property if text is omitted in legacy client mocks', () => {
      const legacyMock = {
        _id: 'legacy-msg-1',
        sender: 'user-id-1',
        senderRole: 'user',
        message: 'This message uses the legacy property name'
      };

      const renderedText = getSupportMessageText(legacyMock);
      expect(renderedText).toBe('This message uses the legacy property name');
    });

    it('prefers canonical text property if both text and message are present', () => {
      const hybridMessage = {
        _id: 'hybrid-1',
        text: 'Canonical text property',
        message: 'Outdated message property'
      };

      const renderedText = getSupportMessageText(hybridMessage);
      expect(renderedText).toBe('Canonical text property');
    });
  });

  describe('3. Edge Cases and Non-Crashing Robustness', () => {
    it('returns empty string when message object is null or undefined without throwing', () => {
      expect(getSupportMessageText(null)).toBe('');
      expect(getSupportMessageText(undefined)).toBe('');
      expect(getSupportMessageText({})).toBe('');
    });

    it('handles non-string or whitespace-only values safely', () => {
      expect(getSupportMessageText({ text: '' })).toBe('');
      expect(getSupportMessageText({ message: '' })).toBe('');
      expect(getSupportMessageText({ text: null, message: null })).toBe('');
    });
  });

  describe('4. Full Ticket Message Thread Mapping Verification', () => {
    it('maps an entire conversation thread without any blank messages', () => {
      const mockTicket = {
        _id: 'tck-full-1',
        ticketNumber: 'TCK-20261023-8888',
        messages: [
          { senderRole: 'user', text: 'First user message' },
          { senderRole: 'staff', text: 'First staff response' },
          { senderRole: 'user', text: 'Second user follow-up' },
          { senderRole: 'staff', text: 'Final resolution notice' }
        ]
      };

      const renderedContents = mockTicket.messages.map(getSupportMessageText);

      expect(renderedContents).toEqual([
        'First user message',
        'First staff response',
        'Second user follow-up',
        'Final resolution notice'
      ]);

      // Assert no rendered item is empty or undefined
      for (const content of renderedContents) {
        expect(content).toBeTruthy();
        expect(content.length).toBeGreaterThan(0);
      }
    });
  });

});
