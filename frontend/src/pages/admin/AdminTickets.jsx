import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { 
  getStaffSupportTickets, 
  getSupportTicketDetails,
  updateSupportTicketStaffMeta, 
  addSupportTicketInternalNote, 
  replySupportTicket 
} from '../../services/api';
import { getSupportMessageText } from '../Support';

const CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: 'general', label: 'General' },
  { value: 'suspension_appeal', label: 'Suspension Appeal' },
  { value: 'account_access', label: 'Account Access' },
  { value: 'bug_report', label: 'Bug Report' },
  { value: 'harassment_inquiry', label: 'Harassment Inquiry' },
  { value: 'billing', label: 'Billing' }
];

const STATUS_CONFIG = {
  open: { label: 'Open', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  in_progress: { label: 'In Progress', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  waiting_on_user: { label: 'Waiting User', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  resolved: { label: 'Resolved', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  closed: { label: 'Closed', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' }
};

const PRIORITY_CONFIG = {
  low: { label: 'Low', color: 'text-gray-400' },
  normal: { label: 'Normal', color: 'text-blue-400' },
  high: { label: 'High', color: 'text-amber-400 font-bold' },
  urgent: { label: 'Urgent', color: 'text-red-400 font-bold animate-pulse' }
};

export function parseStaffTicketsResponse(res) {
  if (res && Array.isArray(res.tickets)) {
    const pagination = res.pagination || {};
    const total = typeof pagination.total === 'number' && Number.isFinite(pagination.total) && pagination.total >= 0
      ? Math.floor(pagination.total)
      : res.tickets.length;

    const rawLimit = Number(pagination.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(Math.floor(rawLimit), 100)
      : 20;

    const calculatedPages = Math.ceil(total / limit) || 1;
    const rawTotalPages = Number(pagination.totalPages);
    const totalPages = Number.isFinite(rawTotalPages) && rawTotalPages >= 1
      ? Math.floor(rawTotalPages)
      : calculatedPages;

    const rawPage = Number(pagination.page);
    const page = Number.isFinite(rawPage) && rawPage >= 1
      ? Math.floor(rawPage)
      : 1;

    return {
      tickets: res.tickets,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    };
  }

  // Gracefully support flat array fallback if returned by test mocks
  if (Array.isArray(res)) {
    return {
      tickets: res,
      pagination: {
        page: 1,
        limit: res.length || 20,
        total: res.length,
        totalPages: 1
      }
    };
  }

  throw new Error('Invalid response format received from server.');
}

const AdminTickets = () => {
  const { currentUser } = useAuth();

  const [searchParams] = useSearchParams();
  const ticketParam = (searchParams.get('ticket') || searchParams.get('ticketId') || '').trim();
  const categoryParam = (searchParams.get('category') || '').trim();

  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState(categoryParam || 'all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState(ticketParam || '');

  // Keep state in sync if URL search params change
  useEffect(() => {
    if (ticketParam) {
      setSearchQuery(ticketParam);
      setPage(1);
    }
  }, [ticketParam]);

  useEffect(() => {
    if (categoryParam) {
      setCategoryFilter(categoryParam);
      setPage(1);
    }
  }, [categoryParam]);

  // Actions
  const [replyMessage, setReplyMessage] = useState('');
  const [replying, setReplying] = useState(false);
  const [noteMessage, setNoteMessage] = useState('');
  const [addingNote, setAddingNote] = useState(false);
  const [activeTab, setActiveTab] = useState('conversation'); // 'conversation' | 'internal_notes'

  const fetchTickets = async () => {
    if (!currentUser) return;
    try {
      setLoading(true);
      setError('');
      const token = await currentUser.getIdToken();
      const params = { page, limit: 20 };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (categoryFilter !== 'all') params.category = categoryFilter;
      if (priorityFilter !== 'all') params.priority = priorityFilter;
      if (searchQuery.trim()) params.search = searchQuery.trim();

      const res = await getStaffSupportTickets(token, params);
      const parsed = parseStaffTicketsResponse(res);

      setTickets(parsed.tickets);
      setPage(parsed.pagination.page);
      setTotalPages(parsed.pagination.totalPages);
      setTotalCount(parsed.pagination.total);

      // Deep-link ticket selection priority
      if (ticketParam) {
        const matched = parsed.tickets.find(
          t => t.ticketNumber === ticketParam || t._id === ticketParam
        );
        if (matched) {
          setSelectedTicket(matched);
        } else if (parsed.tickets.length === 1 && searchQuery.trim() === ticketParam) {
          setSelectedTicket(parsed.tickets[0]);
        } else if (/^[0-9a-fA-F]{24}$/.test(ticketParam)) {
          // Direct Mongo ObjectId lookup fallback
          try {
            const singleDetail = await getSupportTicketDetails(token, ticketParam);
            if (singleDetail && singleDetail._id) {
              setSelectedTicket(singleDetail);
              setTickets(prev => [singleDetail, ...prev.filter(t => t._id !== singleDetail._id)]);
            }
          } catch (singleErr) {
            console.debug('Direct ID lookup not found:', singleErr);
          }
        }
      } else if (selectedTicket) {
        const refreshed = parsed.tickets.find(t => t._id === selectedTicket._id);
        if (refreshed) setSelectedTicket(refreshed);
      }
    } catch (err) {
      console.error('Failed to load tickets for staff:', err);
      setError(err.message || 'Failed to load tickets. Please check staff permissions.');
      setTickets([]);
      setTotalPages(1);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [currentUser, page, statusFilter, categoryFilter, priorityFilter]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (page !== 1) {
      setPage(1);
    } else {
      fetchTickets();
    }
  };

  const handleFilterChange = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };

  const handleUpdateMeta = async (updates) => {
    if (!selectedTicket || !currentUser) return;
    try {
      setActionMsg('');
      setError('');
      const token = await currentUser.getIdToken();
      const updated = await updateSupportTicketStaffMeta(token, selectedTicket._id, updates);
      setSelectedTicket(updated);
      setTickets(prev => prev.map(t => t._id === updated._id ? updated : t));
      setActionMsg('Ticket updated successfully.');
    } catch (err) {
      console.error('Failed to update ticket meta:', err);
      setError(err.message || 'Failed to update ticket.');
    }
  };

  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!selectedTicket || !replyMessage.trim() || !currentUser) return;
    try {
      setReplying(true);
      setActionMsg('');
      setError('');
      const token = await currentUser.getIdToken();
      const updated = await replySupportTicket(token, selectedTicket._id, replyMessage.trim());
      setSelectedTicket(updated);
      setTickets(prev => prev.map(t => t._id === updated._id ? updated : t));
      setReplyMessage('');
      setActionMsg('Staff reply sent.');
    } catch (err) {
      console.error('Failed to send staff reply:', err);
      setError(err.message || 'Failed to send reply.');
    } finally {
      setReplying(false);
    }
  };

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!selectedTicket || !noteMessage.trim() || !currentUser) return;
    try {
      setAddingNote(true);
      setActionMsg('');
      setError('');
      const token = await currentUser.getIdToken();
      const updated = await addSupportTicketInternalNote(token, selectedTicket._id, noteMessage.trim());
      setSelectedTicket(updated);
      setTickets(prev => prev.map(t => t._id === updated._id ? updated : t));
      setNoteMessage('');
      setActionMsg('Internal staff note recorded.');
    } catch (err) {
      console.error('Failed to add internal note:', err);
      setError(err.message || 'Failed to record note.');
    } finally {
      setAddingNote(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <span>Support Ticket Desk</span>
            <span className="text-xs bg-zync-cyan/10 text-zync-cyan border border-zync-cyan/30 px-2 py-0.5 rounded-full font-mono font-bold">
              Staff Portal
            </span>
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Resolve user inquiries, process appeals, coordinate assignments, and document staff notes securely.
          </p>
        </div>

        <button
          onClick={fetchTickets}
          className="px-4 py-2 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20 text-white transition-colors"
        >
          ↻ Refresh List
        </button>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError('')} className="hover:text-white">✕</button>
        </div>
      )}
      {actionMsg && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400 text-xs flex justify-between items-center">
          <span>{actionMsg}</span>
          <button onClick={() => setActionMsg('')} className="hover:text-white">✕</button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="bg-[#0A0F1E] border border-white/10 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <form onSubmit={handleSearchSubmit} className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search ticket # or subject..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white placeholder-text-secondary focus:outline-none focus:border-zync-cyan"
          />
        </form>

        <select
          value={statusFilter}
          onChange={handleFilterChange(setStatusFilter)}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-zync-cyan"
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="waiting_on_user">Waiting on User</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>

        <select
          value={categoryFilter}
          onChange={handleFilterChange(setCategoryFilter)}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-zync-cyan"
        >
          {CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>

        <select
          value={priorityFilter}
          onChange={handleFilterChange(setPriorityFilter)}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-zync-cyan"
        >
          <option value="all">All Priorities</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Main Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Ticket List */}
        <div className={`lg:col-span-5 flex flex-col space-y-3 ${selectedTicket ? 'hidden lg:flex' : 'flex'}`}>
          <div className="flex items-center justify-between text-xs text-text-secondary px-1">
            <span>Showing {tickets.length} of {typeof totalCount === 'number' ? totalCount : tickets.length} tickets</span>
            {totalPages > 1 && (
              <span>Page {page} of {totalPages}</span>
            )}
          </div>

          {loading ? (
            <div className="p-8 text-center text-xs text-text-secondary bg-[#0A0F1E] rounded-xl border border-white/10">
              Loading support tickets...
            </div>
          ) : tickets.length === 0 ? (
            <div className="p-8 text-center text-xs text-text-secondary bg-[#0A0F1E] rounded-xl border border-white/10">
              {error ? 'Unable to load tickets due to an error.' : 'No tickets matching current filters.'}
            </div>
          ) : (
            <div className="space-y-2 max-h-[720px] overflow-y-auto pr-1">
              {tickets.map(t => {
                const st = STATUS_CONFIG[t.status] || STATUS_CONFIG.open;
                const isSelected = selectedTicket?._id === t._id;
                const isAppeal = t.category === 'suspension_appeal';
                return (
                  <div
                    key={t._id}
                    onClick={() => setSelectedTicket(t)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                      isSelected 
                        ? 'bg-[#121c33] border-zync-cyan shadow-md' 
                        : 'bg-[#0A0F1E] border-white/10 hover:border-white/20 hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-mono font-bold text-zync-cyan">
                          {t.ticketNumber}
                        </span>
                        {isAppeal && (
                          <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 font-bold border border-red-500/30">
                            Appeal
                          </span>
                        )}
                      </div>
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${st.color}`}>
                        {st.label}
                      </span>
                    </div>

                    <h4 className="text-xs font-bold text-white truncate mb-1">
                      {t.subject}
                    </h4>

                    <div className="flex items-center justify-between text-[11px] text-text-secondary">
                      <span className="truncate max-w-[150px]">
                        By: <strong className="text-white">{t.creator?.displayName || t.creatorEmail}</strong>
                      </span>
                      <span className={`capitalize font-bold ${PRIORITY_CONFIG[t.priority]?.color}`}>
                        {t.priority}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 border-t border-white/10 text-xs">
              <button
                type="button"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 hover:border-white/20 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-white transition-colors"
              >
                Previous
              </button>
              <span className="text-text-secondary font-medium">
                {page} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 hover:border-white/20 disabled:opacity-40 disabled:cursor-not-allowed font-medium text-white transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Ticket Details & Workspace */}
        <div className={`lg:col-span-7 flex flex-col ${!selectedTicket ? 'hidden lg:flex' : 'flex'}`}>
          {selectedTicket ? (
            <div className="bg-[#0A0F1E] border border-white/10 rounded-xl flex flex-col h-[750px] shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="p-4 border-b border-white/10 bg-black/40">
                <div className="flex items-center justify-between mb-2">
                  <button
                    onClick={() => setSelectedTicket(null)}
                    className="lg:hidden text-xs text-zync-cyan font-bold"
                  >
                    ← Back to list
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-zync-cyan">
                      {selectedTicket.ticketNumber}
                    </span>
                    <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${STATUS_CONFIG[selectedTicket.status]?.color}`}>
                      {STATUS_CONFIG[selectedTicket.status]?.label}
                    </span>
                  </div>

                  {/* Actions / Meta Modifiers */}
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedTicket.status}
                      onChange={(e) => handleUpdateMeta({ status: e.target.value })}
                      className="bg-black/60 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-zync-cyan"
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="waiting_on_user">Waiting on User</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>

                    <select
                      value={selectedTicket.priority}
                      onChange={(e) => handleUpdateMeta({ priority: e.target.value })}
                      className="bg-black/60 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-zync-cyan"
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                </div>

                <h2 className="text-sm md:text-base font-bold text-white mb-2">
                  {selectedTicket.subject}
                </h2>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-text-secondary bg-white/[0.02] p-2 rounded-lg border border-white/5">
                  <div>Creator: <strong className="text-white truncate block">{selectedTicket.creator?.displayName || selectedTicket.creatorEmail}</strong></div>
                  <div>Account: <strong className="text-white uppercase">{selectedTicket.accountStatusAtCreation}</strong></div>
                  <div>Category: <strong className="text-white capitalize">{selectedTicket.category?.replace('_', ' ')}</strong></div>
                  <div>Assigned: <strong className="text-white">{selectedTicket.assignedStaff?.displayName || 'Unassigned'}</strong></div>
                </div>

                {/* Tabs */}
                <div className="flex items-center gap-4 mt-3 pt-2 border-t border-white/5">
                  <button
                    onClick={() => setActiveTab('conversation')}
                    className={`text-xs font-bold uppercase tracking-wider pb-1 transition-colors ${
                      activeTab === 'conversation' 
                        ? 'text-zync-cyan border-b-2 border-zync-cyan' 
                        : 'text-text-secondary hover:text-white'
                    }`}
                  >
                    User Thread ({selectedTicket.messages?.length || 0})
                  </button>
                  <button
                    onClick={() => setActiveTab('internal_notes')}
                    className={`text-xs font-bold uppercase tracking-wider pb-1 transition-colors flex items-center gap-1 ${
                      activeTab === 'internal_notes' 
                        ? 'text-amber-400 border-b-2 border-amber-400' 
                        : 'text-text-secondary hover:text-white'
                    }`}
                  >
                    🔒 Internal Notes ({selectedTicket.internalNotes?.length || 0})
                  </button>
                </div>
              </div>

              {/* Thread Content Area */}
              <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-black/20">
                {activeTab === 'conversation' ? (
                  selectedTicket.messages?.map((msg, idx) => {
                    const isStaff = msg.senderRole === 'staff';
                    return (
                      <div
                        key={idx}
                        className={`flex flex-col ${isStaff ? 'items-end' : 'items-start'}`}
                      >
                        <div className="flex items-center gap-2 mb-1 px-1">
                          <span className={`text-[11px] font-bold ${isStaff ? 'text-zync-cyan' : 'text-white'}`}>
                            {isStaff ? '🛡️ ZYNC Support Staff' : (selectedTicket.creator?.displayName || 'User')}
                          </span>
                          <span className="text-[10px] text-text-secondary">
                            {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div
                          className={`max-w-[85%] rounded-xl p-3 text-xs leading-relaxed border ${
                            isStaff 
                              ? 'bg-[#18233C] border-zync-cyan/30 text-white rounded-tr-sm' 
                              : 'bg-[#0E172A] border-white/10 text-white rounded-tl-sm'
                          }`}
                        >
                          <p className="whitespace-pre-wrap">{getSupportMessageText(msg)}</p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="space-y-3">
                    <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
                      ⚠️ Internal notes are private to staff and never visible to the ticket creator.
                    </div>
                    {(!selectedTicket.internalNotes || selectedTicket.internalNotes.length === 0) ? (
                      <div className="text-center text-xs text-text-secondary py-8">
                        No internal notes recorded yet.
                      </div>
                    ) : (
                      selectedTicket.internalNotes.map((note, idx) => (
                        <div key={idx} className="p-3 rounded-lg bg-[#14120B] border border-amber-500/20 text-xs">
                          <div className="flex items-center justify-between mb-1 text-amber-400 font-bold">
                            <span>Staff Member ({note.author?.displayName || 'Staff'})</span>
                            <span className="text-[10px] text-text-secondary font-normal">
                              {new Date(note.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-gray-200 whitespace-pre-wrap">{note.note}</p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Bottom Composer Area */}
              <div className="p-3 border-t border-white/10 bg-black/60">
                {activeTab === 'conversation' ? (
                  <form onSubmit={handleSendReply} className="space-y-2">
                    <textarea
                      rows={2}
                      maxLength={3000}
                      placeholder="Send official response to the user..."
                      value={replyMessage}
                      onChange={(e) => setReplyMessage(e.target.value)}
                      className="w-full bg-[#0d1424] border border-white/10 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-zync-cyan resize-none"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-text-secondary">
                        Sends as "ZYNC Support Staff" and notifies ticket creator
                      </span>
                      <button
                        type="submit"
                        disabled={replying || !replyMessage.trim()}
                        className="px-4 py-1.5 rounded-lg text-xs font-bold bg-zync-cyan text-black hover:brightness-110 disabled:opacity-50"
                      >
                        {replying ? 'Sending...' : 'Send Official Reply'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={handleAddNote} className="space-y-2">
                    <textarea
                      rows={2}
                      maxLength={2000}
                      placeholder="Add an internal note or decision reasoning..."
                      value={noteMessage}
                      onChange={(e) => setNoteMessage(e.target.value)}
                      className="w-full bg-[#18150c] border border-amber-500/30 rounded-lg p-2.5 text-xs text-amber-100 placeholder-amber-400/50 focus:outline-none focus:border-amber-400 resize-none"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-amber-400/80">
                        Recorded for staff audit trail only
                      </span>
                      <button
                        type="submit"
                        disabled={addingNote || !noteMessage.trim()}
                        className="px-4 py-1.5 rounded-lg text-xs font-bold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50"
                      >
                        {addingNote ? 'Recording...' : 'Add Internal Note'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-[#0A0F1E] border border-white/10 rounded-xl p-12 text-center text-text-secondary flex flex-col items-center justify-center h-[500px]">
              <span className="text-4xl mb-3 opacity-60">🛡️</span>
              <h3 className="text-sm font-bold text-white mb-1">Select a Support Ticket</h3>
              <p className="text-xs max-w-xs">
                Pick a ticket from the left panel to read history, reply, modify status, or append internal staff notes.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminTickets;
