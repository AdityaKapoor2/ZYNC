import { describe, it, expect, vi } from 'vitest';
import { 
  extractTicketIdentifier, 
  isAppealSubmission 
} from '../src/pages/Notifications.jsx';

describe('Checkpoint B: Support Notification Deep-Links', () => {

  describe('1. Ticket Identifier Extraction Contract', () => {
    it('extracts ticket number from "New Support Ticket [TCK-...]" (ticket creation)', () => {
      const notif = {
        title: 'New Support Ticket [TCK-20261023-1001]',
        message: 'PlayerOne created a billing ticket: "Where is my receipt?"'
      };
      expect(extractTicketIdentifier(notif)).toBe('TCK-20261023-1001');
    });

    it('extracts ticket number from "Reply to Ticket [TCK-...]" (staff reply to user)', () => {
      const notif = {
        title: 'Reply to Ticket [TCK-20261023-1002]',
        message: 'ZYNC Support replied to "Appeal inquiry": "We have received your appeal."'
      };
      expect(extractTicketIdentifier(notif)).toBe('TCK-20261023-1002');
    });

    it('extracts ticket number from "New User Reply [TCK-...]" (user reply to staff)', () => {
      const notif = {
        title: 'New User Reply [TCK-20261023-1003]',
        message: 'PlayerTwo replied to ticket "Bug Report"'
      };
      expect(extractTicketIdentifier(notif)).toBe('TCK-20261023-1003');
    });

    it('extracts ticket number from "Ticket Status Updated [TCK-...]" (status modification)', () => {
      const notif = {
        title: 'Ticket Status Updated [TCK-20261023-1004]',
        message: 'Your ticket "Login issue" status is now "resolved"'
      };
      expect(extractTicketIdentifier(notif)).toBe('TCK-20261023-1004');
    });

    it('extracts unbracketed or message-embedded ticket number as fallback', () => {
      const notifWithMessage = {
        title: 'Support Update',
        message: 'Your inquiry regarding ticket TCK-20261023-5555 has been updated.'
      };
      expect(extractTicketIdentifier(notifWithMessage)).toBe('TCK-20261023-5555');
    });

    it('respects explicit ticketNumber or ticketId properties if provided', () => {
      const explicitNumber = {
        ticketNumber: 'TCK-20261023-7777',
        title: 'Generic Support Notification',
        message: 'Click to open'
      };
      expect(extractTicketIdentifier(explicitNumber)).toBe('TCK-20261023-7777');

      const explicitId = {
        ticketId: '6718a9b2c3d4e5f601234567',
        title: 'Generic Support Notification',
        message: 'Click to open'
      };
      expect(extractTicketIdentifier(explicitId)).toBe('6718a9b2c3d4e5f601234567');
    });

    it('returns null for unrelated notifications (warnings, broadcasts, friend messages)', () => {
      const warningNotif = {
        title: 'Official Warning',
        message: 'Your recent behavior in matchmaking violated our code of conduct.'
      };
      expect(extractTicketIdentifier(warningNotif)).toBeNull();

      const broadcastNotif = {
        title: 'System Maintenance Scheduled',
        message: 'Servers will undergo maintenance tonight at 02:00 UTC.'
      };
      expect(extractTicketIdentifier(broadcastNotif)).toBeNull();

      const friendNotif = {
        title: 'Friend Request Accepted',
        message: 'Nexus accepted your friend request.'
      };
      expect(extractTicketIdentifier(friendNotif)).toBeNull();
    });

    it('returns null safely for null, undefined, or empty notification objects', () => {
      expect(extractTicketIdentifier(null)).toBeNull();
      expect(extractTicketIdentifier(undefined)).toBeNull();
      expect(extractTicketIdentifier({})).toBeNull();
      expect(extractTicketIdentifier({ title: 123, message: null })).toBeNull();
    });
  });

  describe('2. Legacy Appeal Submission Detection', () => {
    it('detects "New Appeal Submitted" notifications correctly', () => {
      expect(isAppealSubmission({ title: 'New Appeal Submitted' })).toBe(true);
      expect(isAppealSubmission({ title: 'new appeal submitted' })).toBe(true);
      expect(isAppealSubmission({ title: 'Reply to Ticket [TCK-1]' })).toBe(false);
      expect(isAppealSubmission(null)).toBe(false);
    });
  });

  describe('3. Role-Based Navigation Routing Logic', () => {
    // Pure function simulating Notifications.jsx navigation resolver
    const resolveNotificationRoute = (notif, { userProfile, isAdmin }) => {
      const ticketId = extractTicketIdentifier(notif);
      const isAppeal = isAppealSubmission(notif);

      if (!ticketId && !isAppeal) return null; // Unrelated notification

      if (userProfile?.accountStatus === 'suspended' && !isAdmin) {
        return '/account-suspended';
      }

      if (ticketId) {
        if (isAdmin) {
          return `/admin/tickets?ticket=${encodeURIComponent(ticketId)}`;
        }
        return `/support?ticket=${encodeURIComponent(ticketId)}`;
      }

      if (isAppeal && isAdmin) {
        return '/admin/tickets?category=suspension_appeal';
      }

      return null;
    };

    it('navigates staff/super-admin users to the Admin Support Desk with the ticket identifier', () => {
      const notif = { title: 'Reply to Ticket [TCK-20261023-1001]', message: '...' };
      const route = resolveNotificationRoute(notif, {
        userProfile: { role: 'super_admin', accountStatus: 'active' },
        isAdmin: true
      });
      expect(route).toBe('/admin/tickets?ticket=TCK-20261023-1001');
    });

    it('navigates staff/super-admin to suspension_appeal category for legacy appeal submissions', () => {
      const notif = { title: 'New Appeal Submitted', message: 'User banned_player submitted an appeal' };
      const route = resolveNotificationRoute(notif, {
        userProfile: { role: 'super_admin', accountStatus: 'active' },
        isAdmin: true
      });
      expect(route).toBe('/admin/tickets?category=suspension_appeal');
    });

    it('navigates ordinary active users to the user Support interface with the ticket identifier', () => {
      const notif = { title: 'Reply to Ticket [TCK-20261023-2002]', message: '...' };
      const route = resolveNotificationRoute(notif, {
        userProfile: { role: 'user', accountStatus: 'active' },
        isAdmin: false
      });
      expect(route).toBe('/support?ticket=TCK-20261023-2002');
    });

    it('navigates suspended users to /account-suspended to prevent unauthorized route redirection loops', () => {
      const notif = { title: 'Reply to Ticket [TCK-20261023-3003]', message: '...' };
      const route = resolveNotificationRoute(notif, {
        userProfile: { role: 'user', accountStatus: 'suspended' },
        isAdmin: false
      });
      expect(route).toBe('/account-suspended');
    });

    it('does not navigate on unrelated notifications, preserving read-only behavior', () => {
      const warningNotif = { title: 'Official Warning', message: 'Take notice' };
      const route = resolveNotificationRoute(warningNotif, {
        userProfile: { role: 'user', accountStatus: 'active' },
        isAdmin: false
      });
      expect(route).toBeNull();
    });
  });

  describe('4. Ticket Selection & Stale/Missing Identifier Handling', () => {
    // Pure function simulating ticket matching in Support.jsx and AdminTickets.jsx
    const resolveSelectedTicket = (tickets, ticketParam) => {
      if (!ticketParam || !Array.isArray(tickets) || tickets.length === 0) return null;
      return tickets.find(t => t.ticketNumber === ticketParam || t._id === ticketParam) || null;
    };

    const mockTickets = [
      { _id: 'mongo-id-1', ticketNumber: 'TCK-20261023-1001', subject: 'Billing Issue' },
      { _id: 'mongo-id-2', ticketNumber: 'TCK-20261023-1002', subject: 'Account Access' },
      { _id: 'mongo-id-3', ticketNumber: 'TCK-20261023-1003', subject: 'Bug in matchmaking' }
    ];

    it('correctly selects ticket by human-readable ticketNumber', () => {
      const selected = resolveSelectedTicket(mockTickets, 'TCK-20261023-1002');
      expect(selected).not.toBeNull();
      expect(selected._id).toBe('mongo-id-2');
      expect(selected.subject).toBe('Account Access');
    });

    it('correctly selects ticket by Mongo _id', () => {
      const selected = resolveSelectedTicket(mockTickets, 'mongo-id-3');
      expect(selected).not.toBeNull();
      expect(selected.ticketNumber).toBe('TCK-20261023-1003');
    });

    it('returns null and does NOT select a random or first ticket if identifier is missing or stale', () => {
      const missing = resolveSelectedTicket(mockTickets, 'TCK-20261023-9999');
      expect(missing).toBeNull();

      const malformed = resolveSelectedTicket(mockTickets, 'invalid!!--');
      expect(malformed).toBeNull();

      const empty = resolveSelectedTicket(mockTickets, '');
      expect(empty).toBeNull();
    });

    it('handles empty ticket list without error', () => {
      const selected = resolveSelectedTicket([], 'TCK-20261023-1001');
      expect(selected).toBeNull();
    });
  });

  describe('5. Backend Ticket Ownership & Authorization Simulation', () => {
    // Simulating backend getTicketDetails authorization check (supportController.js:362-367)
    const checkTicketAccess = (ticket, user) => {
      if (!ticket || !user) throw new Error('Not found');
      const isStaff = user.role === 'super_admin';
      const isOwner = ticket.creatorId === user._id;

      if (!isStaff && !isOwner) {
        const err = new Error('Not authorized to view this ticket');
        err.status = 403;
        throw err;
      }
      return true;
    };

    const mockTicket = { _id: 't-1', creatorId: 'user-alice' };

    it('allows owner to access their ticket', () => {
      expect(checkTicketAccess(mockTicket, { _id: 'user-alice', role: 'user' })).toBe(true);
    });

    it('allows staff to access any ticket', () => {
      expect(checkTicketAccess(mockTicket, { _id: 'staff-charlie', role: 'super_admin' })).toBe(true);
    });

    it('rejects another ordinary user with 403 Forbidden', () => {
      expect(() => {
        checkTicketAccess(mockTicket, { _id: 'user-bob', role: 'user' });
      }).toThrow('Not authorized to view this ticket');
    });
  });

});
