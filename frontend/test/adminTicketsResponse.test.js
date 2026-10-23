import { describe, it, expect } from 'vitest';
import { parseStaffTicketsResponse } from '../src/pages/admin/AdminTickets.jsx';

describe('Checkpoint A: Admin Support Ticket List Response Handling', () => {

  describe('1. Response Parsing Contract ({ tickets: [...], pagination: {...} })', () => {
    it('correctly parses verified backend staff-ticket response with tickets and pagination', () => {
      const mockBackendResponse = {
        tickets: [
          {
            _id: 'tck-1',
            ticketNumber: 'TCK-20261023-1001',
            subject: 'Billing inquiry',
            status: 'open',
            priority: 'normal',
            category: 'billing',
            creatorEmail: 'player1@zync.gg',
            creator: { displayName: 'PlayerOne', email: 'player1@zync.gg' },
            messages: [{ senderRole: 'user', text: 'Where is my receipt?' }]
          },
          {
            _id: 'tck-2',
            ticketNumber: 'TCK-20261023-1002',
            subject: 'Suspension Appeal',
            status: 'in_progress',
            priority: 'high',
            category: 'suspension_appeal',
            creatorEmail: 'banned@zync.gg',
            creator: { displayName: 'BannedPlayer', email: 'banned@zync.gg' },
            messages: [{ senderRole: 'user', text: 'I would like to appeal.' }]
          }
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 45,
          totalPages: 3
        }
      };

      const parsed = parseStaffTicketsResponse(mockBackendResponse);

      expect(parsed.tickets).toHaveLength(2);
      expect(parsed.tickets[0].ticketNumber).toBe('TCK-20261023-1001');
      expect(parsed.tickets[1].ticketNumber).toBe('TCK-20261023-1002');
      expect(parsed.pagination.page).toBe(1);
      expect(parsed.pagination.limit).toBe(20);
      expect(parsed.pagination.total).toBe(45);
      expect(parsed.pagination.totalPages).toBe(3);
    });

    it('correctly handles a legitimate empty response from the server', () => {
      const mockEmptyResponse = {
        tickets: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0
        }
      };

      const parsed = parseStaffTicketsResponse(mockEmptyResponse);

      expect(parsed.tickets).toEqual([]);
      expect(parsed.pagination.page).toBe(1);
      expect(parsed.pagination.total).toBe(0);
      expect(parsed.pagination.totalPages).toBe(1); // Clamped to min 1 page
    });

    it('gracefully supports legacy or test flat array responses', () => {
      const mockArray = [
        { _id: 'tck-flat-1', ticketNumber: 'TCK-20261023-9999', subject: 'Flat ticket' }
      ];

      const parsed = parseStaffTicketsResponse(mockArray);

      expect(parsed.tickets).toHaveLength(1);
      expect(parsed.tickets[0].ticketNumber).toBe('TCK-20261023-9999');
      expect(parsed.pagination.page).toBe(1);
      expect(parsed.pagination.total).toBe(1);
      expect(parsed.pagination.totalPages).toBe(1);
    });

    it('calculates totalPages if pagination metadata lacks totalPages', () => {
      const responseWithoutTotalPages = {
        tickets: new Array(15).fill({ _id: 't', ticketNumber: 'TCK-X' }),
        pagination: {
          page: 1,
          limit: 10,
          total: 25
        }
      };

      const parsed = parseStaffTicketsResponse(responseWithoutTotalPages);

      expect(parsed.pagination.page).toBe(1);
      expect(parsed.pagination.total).toBe(25);
      expect(parsed.pagination.totalPages).toBe(3); // Math.ceil(25 / 10) = 3
    });
  });

  describe('2. Malformed Response Rejection (No False Empty Results)', () => {
    it('throws when response is null or undefined', () => {
      expect(() => parseStaffTicketsResponse(null)).toThrow('Invalid response format received from server.');
      expect(() => parseStaffTicketsResponse(undefined)).toThrow('Invalid response format received from server.');
    });

    it('throws when response is an object missing the tickets array', () => {
      const malformedObjects = [
        {},
        { message: 'Internal Server Error' },
        { error: 'Forbidden', status: 403 },
        { data: [] },
        { tickets: 'not-an-array' },
        { tickets: null }
      ];

      for (const malformed of malformedObjects) {
        expect(() => parseStaffTicketsResponse(malformed)).toThrow('Invalid response format received from server.');
      }
    });

    it('throws when response is a primitive value', () => {
      expect(() => parseStaffTicketsResponse(42)).toThrow('Invalid response format received from server.');
      expect(() => parseStaffTicketsResponse('success')).toThrow('Invalid response format received from server.');
      expect(() => parseStaffTicketsResponse(true)).toThrow('Invalid response format received from server.');
    });
  });

  describe('3. UI State Resolution and Invariants', () => {
    // Helper simulating the AdminTickets empty/error text resolution
    const resolveListEmptyMessage = (tickets, error) => {
      if (tickets.length > 0) return null;
      return error ? 'Unable to load tickets due to an error.' : 'No tickets matching current filters.';
    };

    it('renders "No tickets matching current filters." when query succeeds with 0 tickets and no error', () => {
      const message = resolveListEmptyMessage([], '');
      expect(message).toBe('No tickets matching current filters.');
    });

    it('renders error indicator rather than false empty message when error is present', () => {
      const message = resolveListEmptyMessage([], 'Failed to load tickets. Please check staff permissions.');
      expect(message).toBe('Unable to load tickets due to an error.');
      expect(message).not.toBe('No tickets matching current filters.');
    });

    it('renders error indicator when malformed response error occurs', () => {
      let error = '';
      let tickets = [];
      try {
        parseStaffTicketsResponse({ error: 'Database timeout' });
      } catch (err) {
        error = err.message;
      }

      const message = resolveListEmptyMessage(tickets, error);
      expect(error).toBe('Invalid response format received from server.');
      expect(message).toBe('Unable to load tickets due to an error.');
    });
  });

  describe('4. Pagination Navigation Logic', () => {
    it('correctly clamps previous page at 1', () => {
      const clampPrev = (p) => Math.max(1, p - 1);
      expect(clampPrev(1)).toBe(1);
      expect(clampPrev(2)).toBe(1);
      expect(clampPrev(5)).toBe(4);
    });

    it('correctly clamps next page at totalPages', () => {
      const totalPages = 4;
      const clampNext = (p) => Math.min(totalPages, p + 1);
      expect(clampNext(1)).toBe(2);
      expect(clampNext(3)).toBe(4);
      expect(clampNext(4)).toBe(4);
    });

    it('formats ticket count summary correctly for single-page and multi-page sets', () => {
      const formatSummary = (ticketsLength, totalCount, totalPages, page) => {
        const resolvedTotal = typeof totalCount === 'number' ? totalCount : ticketsLength;
        const countText = `Showing ${ticketsLength} of ${resolvedTotal} tickets`;
        const pageText = totalPages > 1 ? `Page ${page} of ${totalPages}` : null;
        return { countText, pageText };
      };

      const singlePage = formatSummary(5, 5, 1, 1);
      expect(singlePage.countText).toBe('Showing 5 of 5 tickets');
      expect(singlePage.pageText).toBeNull();

      const multiPage = formatSummary(20, 55, 3, 2);
      expect(multiPage.countText).toBe('Showing 20 of 55 tickets');
      expect(multiPage.pageText).toBe('Page 2 of 3');

      // Crucial edge case: legitimate total of 0 must render "Showing 0 of 0 tickets"
      const zeroResult = formatSummary(0, 0, 1, 1);
      expect(zeroResult.countText).toBe('Showing 0 of 0 tickets');
      expect(zeroResult.pageText).toBeNull();
    });
  });

  describe('5. Robust Pagination Metadata Sanitization', () => {
    it('sanitizes non-finite, negative, or invalid page values to 1', () => {
      const invalidPages = [-10, 0, NaN, Infinity, -Infinity, 'invalid'];
      for (const badPage of invalidPages) {
        const res = {
          tickets: [{ _id: 't1', ticketNumber: 'TCK-1' }],
          pagination: { page: badPage, limit: 20, total: 1, totalPages: 1 }
        };
        const parsed = parseStaffTicketsResponse(res);
        expect(parsed.pagination.page).toBe(1);
      }
    });

    it('sanitizes non-finite, negative, or invalid limit values to default 20', () => {
      const invalidLimits = [-5, 0, NaN, Infinity, -Infinity, 'invalid'];
      for (const badLimit of invalidLimits) {
        const res = {
          tickets: [{ _id: 't1', ticketNumber: 'TCK-1' }],
          pagination: { page: 1, limit: badLimit, total: 1, totalPages: 1 }
        };
        const parsed = parseStaffTicketsResponse(res);
        expect(parsed.pagination.limit).toBe(20);
      }
    });

    it('clamps limit to maximum 100 matching backend controller constraint', () => {
      const res = {
        tickets: [{ _id: 't1', ticketNumber: 'TCK-1' }],
        pagination: { page: 1, limit: 500, total: 1, totalPages: 1 }
      };
      const parsed = parseStaffTicketsResponse(res);
      expect(parsed.pagination.limit).toBe(100);
    });

    it('falls back to tickets.length if total is negative, non-finite, or invalid', () => {
      const invalidTotals = [-1, NaN, Infinity, 'invalid'];
      for (const badTotal of invalidTotals) {
        const res = {
          tickets: [{ _id: 't1', ticketNumber: 'TCK-1' }, { _id: 't2', ticketNumber: 'TCK-2' }],
          pagination: { page: 1, limit: 20, total: badTotal, totalPages: 1 }
        };
        const parsed = parseStaffTicketsResponse(res);
        expect(parsed.pagination.total).toBe(2);
      }
    });

    it('correctly preserves a legitimate total of 0 without falling back', () => {
      const res = {
        tickets: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }
      };
      const parsed = parseStaffTicketsResponse(res);
      expect(parsed.pagination.total).toBe(0);
      expect(parsed.pagination.totalPages).toBe(1);
    });
  });

  describe('6. Filter and Search Reset Invariants', () => {
    it('filter changes trigger resetting page to 1', () => {
      let page = 3;
      let filterValue = 'all';

      const handleFilterChange = (setter) => (newVal) => {
        setter(newVal);
        page = 1;
      };

      const setStatusFilter = (val) => { filterValue = val; };
      const changeFilter = handleFilterChange(setStatusFilter);

      changeFilter('waiting_on_user');
      expect(filterValue).toBe('waiting_on_user');
      expect(page).toBe(1);
    });

    it('search submit resets page to 1 when on a later page', () => {
      let page = 4;
      let fetchedPage = null;

      const handleSearchSubmit = () => {
        if (page !== 1) {
          page = 1;
        } else {
          fetchedPage = page;
        }
      };

      handleSearchSubmit();
      expect(page).toBe(1);
      expect(fetchedPage).toBeNull(); // page changed to 1, effect will trigger fetch
    });
  });

});

