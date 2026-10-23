import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import { 
  getUserSupportTickets, 
  getSupportTicketDetails, 
  createSupportTicket, 
  replySupportTicket,
  reopenSupportTicket
} from '../services/api';

const CATEGORIES = [
  { value: 'general', label: 'General Inquiry' },
  { value: 'account_access', label: 'Account Access & Security' },
  { value: 'bug_report', label: 'Bug Report & Technical Issue' },
  { value: 'harassment_inquiry', label: 'Harassment & Safety Inquiry' },
  { value: 'billing', label: 'Billing & Subscriptions' }
];

const STATUS_CONFIG = {
  open: { label: 'Open', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  in_progress: { label: 'In Progress', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  waiting_on_user: { label: 'Action Needed', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  resolved: { label: 'Resolved', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  closed: { label: 'Closed', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' }
};

const PRIORITY_CONFIG = {
  low: { label: 'Low', color: 'text-gray-400' },
  normal: { label: 'Normal', color: 'text-blue-400' },
  high: { label: 'High', color: 'text-amber-400' },
  urgent: { label: 'Urgent', color: 'text-red-400 font-bold' }
};

export function getSupportMessageText(msg) {
  if (!msg) return '';
  if (typeof msg.text === 'string' && msg.text.length > 0) return msg.text;
  if (typeof msg.message === 'string' && msg.message.length > 0) return msg.message;
  return msg.text || msg.message || '';
}

const Support = () => {
  const { currentUser } = useAuth();
  const [searchParams] = useSearchParams();
  const ticketParam = (searchParams.get('ticket') || searchParams.get('ticketId') || '').trim();
  
  const [activeTab, setActiveTab] = useState('tickets'); // 'tickets' | 'create'
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // New Ticket Form State
  const [formData, setFormData] = useState({
    category: 'general',
    subject: '',
    message: '',
    priority: 'normal'
  });
  const [creating, setCreating] = useState(false);

  // Reply State
  const [replyMessage, setReplyMessage] = useState('');
  const [replying, setReplying] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');

  const fetchTickets = async () => {
    if (!currentUser) return;
    try {
      setLoading(true);
      setError('');
      const token = await currentUser.getIdToken();
      const res = await getUserSupportTickets(token);
      setTickets(Array.isArray(res) ? res : []);
    } catch (err) {
      console.error('Failed to load tickets:', err);
      setError('Unable to load your support tickets. Please refresh.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [currentUser]);

  const handleSelectTicket = async (ticketId) => {
    if (!currentUser) return;
    try {
      setDetailLoading(true);
      setError('');
      const token = await currentUser.getIdToken();
      const detail = await getSupportTicketDetails(token, ticketId);
      setSelectedTicket(detail);
      setReplyMessage('');
    } catch (err) {
      console.error('Failed to load ticket detail:', err);
      setError(err.message || 'Unable to open ticket details.');
    } finally {
      setDetailLoading(false);
    }
  };

  // Auto-select ticket from URL query parameter (deep-link)
  useEffect(() => {
    if (!ticketParam || loading) return;

    if (tickets.length > 0) {
      const matched = tickets.find(
        t => t.ticketNumber === ticketParam || t._id === ticketParam
      );
      if (matched) {
        if (selectedTicket?._id !== matched._id) {
          handleSelectTicket(matched._id);
          setActiveTab('tickets');
        }
        return;
      }
    }

    // If not found in loaded tickets array, attempt direct ObjectId fetch if valid hex format
    if (/^[0-9a-fA-F]{24}$/.test(ticketParam)) {
      if (selectedTicket?._id !== ticketParam) {
        handleSelectTicket(ticketParam);
        setActiveTab('tickets');
      }
    } else {
      setError(`Ticket "${ticketParam}" was not found in your account.`);
    }
  }, [ticketParam, tickets, loading]);

  const handleCreateTicket = async (e) => {
    e.preventDefault();
    if (!formData.subject.trim() || !formData.message.trim()) {
      setError('Please provide both a subject and a detailed message.');
      return;
    }
    try {
      setCreating(true);
      setError('');
      const token = await currentUser.getIdToken();
      const newTicket = await createSupportTicket(token, formData);
      setSuccessMsg(`Ticket ${newTicket.ticketNumber} created successfully.`);
      setFormData({ category: 'general', subject: '', message: '', priority: 'normal' });
      await fetchTickets();
      setSelectedTicket(newTicket);
      setActiveTab('tickets');
    } catch (err) {
      console.error('Failed to create ticket:', err);
      setError(err.message || 'Failed to submit support ticket.');
    } finally {
      setCreating(false);
    }
  };

  const handleSendReply = async (e) => {
    e.preventDefault();
    if (!replyMessage.trim() || !selectedTicket) return;
    try {
      setReplying(true);
      setError('');
      const token = await currentUser.getIdToken();
      const updatedTicket = await replySupportTicket(token, selectedTicket._id, replyMessage.trim());
      setSelectedTicket(updatedTicket);
      setReplyMessage('');
      setTickets(prev => prev.map(t => t._id === updatedTicket._id ? updatedTicket : t));
    } catch (err) {
      console.error('Failed to reply to ticket:', err);
      setError(err.message || 'Failed to send reply.');
    } finally {
      setReplying(false);
    }
  };

  const handleReopenTicket = async () => {
    if (!selectedTicket || !currentUser) return;
    try {
      setReopening(true);
      setError('');
      const token = await currentUser.getIdToken();
      const updated = await reopenSupportTicket(token, selectedTicket._id);
      setSelectedTicket(updated);
      setSuccessMsg(`Ticket ${updated.ticketNumber} has been reopened.`);
      setTickets(prev => prev.map(t => t._id === updated._id ? updated : t));
    } catch (err) {
      console.error('Failed to reopen ticket:', err);
      setError(err.message || 'Failed to reopen ticket.');
    } finally {
      setReopening(false);
    }
  };

  const filteredTickets = tickets.filter(t => {
    if (filterStatus === 'all') return true;
    return t.status === filterStatus;
  });

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary font-sans flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-6xl w-full mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 mb-6 border-b border-white/10 gap-4">
          <div>
            <div className="text-[11px] font-extrabold tracking-[0.2em] text-zync-cyan uppercase mb-1">
              Help Center & Inquiries
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">Contact Support</h1>
            <p className="text-text-secondary text-sm mt-1">
              Track issues, contact staff, and resolve account inquiries directly.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => { setActiveTab('tickets'); setSelectedTicket(null); }}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                activeTab === 'tickets' 
                  ? 'bg-white/10 text-white border border-white/20' 
                  : 'text-text-secondary hover:text-white hover:bg-white/5'
              }`}
            >
              My Tickets ({tickets.length})
            </button>
            <button
              onClick={() => { setActiveTab('create'); setSelectedTicket(null); }}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                activeTab === 'create' 
                  ? 'bg-zync-cyan text-black font-extrabold shadow-lg shadow-zync-cyan/20' 
                  : 'bg-zync-cyan/10 text-zync-cyan border border-zync-cyan/30 hover:bg-zync-cyan/20'
              }`}
            >
              + New Ticket
            </button>
          </div>
        </div>

        {/* Global Notifications / Alerts */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-white ml-2">✕</button>
          </div>
        )}
        {successMsg && (
          <div className="mb-6 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm flex items-center justify-between">
            <span>{successMsg}</span>
            <button onClick={() => setSuccessMsg('')} className="text-emerald-400 hover:text-white ml-2">✕</button>
          </div>
        )}

        {/* Tab 1: Create Ticket */}
        {activeTab === 'create' && (
          <div className="max-w-2xl mx-auto bg-bg-card border border-white/10 rounded-xl p-6 md:p-8 shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-2">Submit a Support Ticket</h2>
            <p className="text-xs text-text-secondary mb-6 leading-relaxed">
              Our support team will review your inquiry. You'll receive updates directly on this ticket thread and via in-app notifications.
            </p>

            <form onSubmit={handleCreateTicket} className="space-y-5">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">
                  Category <span className="text-red-400">*</span>
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full bg-[#0d1424] border border-white/10 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-zync-cyan transition-colors"
                >
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">
                  Subject <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  maxLength={150}
                  placeholder="Summary of your issue (e.g., Unable to connect Discord account)"
                  value={formData.subject}
                  onChange={(e) => setFormData(prev => ({ ...prev, subject: e.target.value }))}
                  required
                  className="w-full bg-[#0d1424] border border-white/10 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-zync-cyan transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">
                  Description & Details <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={6}
                  maxLength={3000}
                  placeholder="Provide as much detail as possible to help us investigate..."
                  value={formData.message}
                  onChange={(e) => setFormData(prev => ({ ...prev, message: e.target.value }))}
                  required
                  className="w-full bg-[#0d1424] border border-white/10 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-zync-cyan transition-colors resize-y"
                />
                <div className="text-right text-[11px] text-text-secondary mt-1">
                  {formData.message.length} / 3000 characters
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setActiveTab('tickets')}
                  className="px-5 py-2.5 rounded-lg text-sm font-bold text-text-secondary hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !formData.subject.trim() || !formData.message.trim()}
                  className="px-6 py-2.5 rounded-lg text-sm font-extrabold bg-zync-cyan text-black hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {creating ? 'Submitting...' : 'Submit Ticket'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tab 2: Tickets View (List + Detail) */}
        {activeTab === 'tickets' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Ticket List */}
            <div className={`lg:col-span-5 flex flex-col space-y-4 ${selectedTicket ? 'hidden lg:flex' : 'flex'}`}>
              {/* Filter Row */}
              <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1">
                {['all', 'open', 'in_progress', 'waiting_on_user', 'resolved', 'closed'].map(st => (
                  <button
                    key={st}
                    onClick={() => setFilterStatus(st)}
                    className={`px-3 py-1 rounded text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-colors ${
                      filterStatus === st 
                        ? 'bg-white/20 text-white' 
                        : 'text-text-secondary hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {st === 'waiting_on_user' ? 'Action' : st.replace('_', ' ')}
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="p-8 text-center text-text-secondary text-sm">
                  Loading tickets...
                </div>
              ) : filteredTickets.length === 0 ? (
                <div className="bg-bg-card border border-white/10 rounded-xl p-8 text-center">
                  <div className="text-3xl mb-2">🎫</div>
                  <h3 className="text-base font-bold text-white mb-1">No Tickets Found</h3>
                  <p className="text-xs text-text-secondary mb-4">
                    {filterStatus === 'all' 
                      ? "You haven't submitted any support inquiries yet." 
                      : `No tickets with status "${filterStatus}".`}
                  </p>
                  <button
                    onClick={() => setActiveTab('create')}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-zync-cyan text-black hover:brightness-110"
                  >
                    Create Your First Ticket
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[700px] overflow-y-auto pr-1">
                  {filteredTickets.map(t => {
                    const st = STATUS_CONFIG[t.status] || STATUS_CONFIG.open;
                    const isSelected = selectedTicket?._id === t._id;
                    return (
                      <div
                        key={t._id}
                        onClick={() => handleSelectTicket(t._id)}
                        className={`p-4 rounded-xl border cursor-pointer transition-all ${
                          isSelected 
                            ? 'bg-[#121c33] border-zync-cyan shadow-lg shadow-zync-cyan/5' 
                            : 'bg-bg-card border-white/10 hover:border-white/20 hover:bg-white/[0.03]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-mono font-bold text-zync-cyan">
                            {t.ticketNumber}
                          </span>
                          <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border ${st.color}`}>
                            {st.label}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-white truncate mb-1">
                          {t.subject}
                        </h4>
                        <div className="flex items-center justify-between text-[11px] text-text-secondary">
                          <span className="capitalize">{t.category?.replace('_', ' ')}</span>
                          <span>{new Date(t.updatedAt || t.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right: Selected Ticket Detail */}
            <div className={`lg:col-span-7 flex flex-col ${!selectedTicket ? 'hidden lg:flex' : 'flex'}`}>
              {detailLoading ? (
                <div className="bg-bg-card border border-white/10 rounded-xl p-12 text-center text-text-secondary">
                  Loading ticket conversation...
                </div>
              ) : selectedTicket ? (
                <div className="bg-bg-card border border-white/10 rounded-xl flex flex-col h-[750px] shadow-2xl overflow-hidden">
                  {/* Ticket Header */}
                  <div className="p-4 md:p-6 border-b border-white/10 bg-[#0A0F1E]/60 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setSelectedTicket(null)}
                        className="lg:hidden text-xs text-zync-cyan font-bold flex items-center gap-1"
                      >
                        ← Back to List
                      </button>
                      <span className="text-xs font-mono font-bold text-zync-cyan">
                        {selectedTicket.ticketNumber}
                      </span>
                      <span className={`text-xs uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full border ${STATUS_CONFIG[selectedTicket.status]?.color}`}>
                        {STATUS_CONFIG[selectedTicket.status]?.label}
                      </span>
                    </div>

                    <h2 className="text-lg md:text-xl font-bold text-white">
                      {selectedTicket.subject}
                    </h2>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary pt-1">
                      <span>Category: <strong className="text-white capitalize">{selectedTicket.category?.replace('_', ' ')}</strong></span>
                      <span>Priority: <strong className={`capitalize ${PRIORITY_CONFIG[selectedTicket.priority]?.color}`}>{selectedTicket.priority}</strong></span>
                      <span>Created: <strong className="text-white">{new Date(selectedTicket.createdAt).toLocaleString()}</strong></span>
                    </div>
                  </div>

                  {/* Message Thread */}
                  <div className="flex-1 p-4 md:p-6 overflow-y-auto space-y-4 bg-black/20">
                    {selectedTicket.messages?.map((msg, idx) => {
                      const isStaff = msg.senderRole === 'staff';
                      return (
                        <div
                          key={idx}
                          className={`flex flex-col ${isStaff ? 'items-start' : 'items-end'}`}
                        >
                          <div className="flex items-center gap-2 mb-1 px-1">
                            <span className={`text-xs font-bold ${isStaff ? 'text-zync-cyan' : 'text-white'}`}>
                              {isStaff ? '🛡️ ZYNC Support Staff' : 'You'}
                            </span>
                            <span className="text-[10px] text-text-secondary">
                              {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          <div
                            className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed border ${
                              isStaff 
                                ? 'bg-[#0E172A] border-white/10 text-white rounded-tl-sm' 
                                : 'bg-[#18233C] border-zync-cyan/30 text-white rounded-tr-sm'
                            }`}
                          >
                            <p className="whitespace-pre-wrap">{getSupportMessageText(msg)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Reply Form */}
                  <div className="p-4 border-t border-white/10 bg-[#0A0F1E]/80">
                    {selectedTicket.status === 'closed' ? (
                      <div className="p-4 text-center space-y-3 bg-white/5 rounded-lg border border-white/10">
                        <p className="text-xs text-text-secondary">
                          This ticket is closed. If your issue is not resolved, you can reopen it or submit a new ticket.
                        </p>
                        <button
                          type="button"
                          onClick={handleReopenTicket}
                          disabled={reopening}
                          className="px-4 py-2 rounded-lg text-xs font-bold bg-white/10 text-white hover:bg-white/20 border border-white/20 transition-all disabled:opacity-50"
                        >
                          {reopening ? 'Reopening...' : 'Reopen Ticket'}
                        </button>
                      </div>
                    ) : selectedTicket.status === 'resolved' ? (
                      <div className="p-4 text-center space-y-3 bg-purple-500/10 rounded-lg border border-purple-500/20">
                        <p className="text-xs text-purple-300">
                          This ticket has been marked as resolved. If you require further assistance with this inquiry, please reopen it.
                        </p>
                        <button
                          type="button"
                          onClick={handleReopenTicket}
                          disabled={reopening}
                          className="px-4 py-2 rounded-lg text-xs font-extrabold bg-purple-500 text-white hover:bg-purple-600 transition-all disabled:opacity-50 shadow-lg shadow-purple-500/20"
                        >
                          {reopening ? 'Reopening...' : 'Reopen Ticket'}
                        </button>
                      </div>
                    ) : (
                      <form onSubmit={handleSendReply} className="space-y-3">
                        <textarea
                          rows={3}
                          maxLength={3000}
                          placeholder="Type your reply to support staff..."
                          value={replyMessage}
                          onChange={(e) => setReplyMessage(e.target.value)}
                          className="w-full bg-[#0d1424] border border-white/10 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-zync-cyan transition-colors resize-none"
                        />
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-text-secondary">
                            Press send to add your message to this ticket
                          </span>
                          <button
                            type="submit"
                            disabled={replying || !replyMessage.trim()}
                            className="px-5 py-2 rounded-lg text-xs font-extrabold bg-zync-cyan text-black hover:brightness-110 disabled:opacity-50 transition-all"
                          >
                            {replying ? 'Sending...' : 'Send Reply'}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-bg-card border border-white/10 rounded-xl p-12 text-center text-text-secondary flex flex-col items-center justify-center h-[500px]">
                  <span className="text-4xl mb-3 opacity-60">📋</span>
                  <h3 className="text-base font-bold text-white mb-1">Select a Ticket</h3>
                  <p className="text-xs max-w-xs">
                    Choose a ticket from the left column to read its reply history or send a follow-up response.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Support;
