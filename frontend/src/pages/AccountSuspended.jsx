import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Navigate } from 'react-router-dom';
import zyncLogo from '../assets/zync-logo.png';
import { 
  createSupportTicket, 
  getUserSupportTickets, 
  replySupportTicket 
} from '../services/api';

const STATUS_CONFIG = {
  open: { label: 'Under Review', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  in_progress: { label: 'In Progress', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  waiting_on_user: { label: 'Action Required', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
  resolved: { label: 'Decision Reached', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  closed: { label: 'Appeal Closed', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' }
};

const AccountSuspended = () => {
  const { currentUser, userProfile, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  
  const [showAppealForm, setShowAppealForm] = useState(false);
  const [appealMessage, setAppealMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [appealSubmitted, setAppealSubmitted] = useState(false);

  // Existing tickets & thread state
  const [appealTicket, setAppealTicket] = useState(null);
  const [loadingTicket, setLoadingTicket] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  const fetchAppealTicket = async () => {
    if (!currentUser) return;
    try {
      setLoadingTicket(true);
      const token = await currentUser.getIdToken();
      const tickets = await getUserSupportTickets(token);
      if (Array.isArray(tickets) && tickets.length > 0) {
        // find most recent suspension appeal ticket, or fallback to first ticket
        const appeal = tickets.find(t => t.category === 'suspension_appeal') || tickets[0];
        setAppealTicket(appeal);
      }
    } catch (err) {
      console.error('Failed to load appeal ticket:', err);
    } finally {
      setLoadingTicket(false);
    }
  };

  useEffect(() => {
    fetchAppealTicket();
  }, [currentUser]);

  const handleAppealSubmit = async () => {
    if (!appealMessage.trim() || appealMessage.trim().length < 10) {
      setError('Please provide at least 10 characters explaining your appeal.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const token = await currentUser.getIdToken();
      const newTicket = await createSupportTicket(token, {
        category: 'suspension_appeal',
        subject: 'Account Suspension Appeal',
        message: appealMessage.trim(),
        priority: 'high'
      });
      setAppealTicket(newTicket);
      setAppealSubmitted(true);
      setShowAppealForm(false);
      setAppealMessage('');
    } catch (err) {
      setError(err.message || 'Failed to submit appeal. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReplySubmit = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !appealTicket) return;
    setReplying(true);
    setError(null);
    try {
      const token = await currentUser.getIdToken();
      const updated = await replySupportTicket(token, appealTicket._id, replyText.trim());
      setAppealTicket(updated);
      setReplyText('');
    } catch (err) {
      setError(err.message || 'Failed to send reply to staff.');
    } finally {
      setReplying(false);
    }
  };

  // Redirect to login if not authenticated
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  // If user is active or an admin, redirect back to dashboard
  if (userProfile?.accountStatus !== 'suspended' || isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (e) {
      navigate('/login');
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex flex-col items-center justify-center p-4 font-sans relative overflow-y-auto py-12">
      
      <div className="w-full max-w-xl bg-bg-card border border-border-subtle rounded-xl p-6 md:p-8 shadow-2xl relative z-10 flex flex-col items-center text-center">
        
        {/* Small ZYNC Logo */}
        <div className="mb-4">
          <img src={zyncLogo} alt="ZYNC Logo" className="w-8 h-8 object-contain opacity-80" />
        </div>
        
        <div className="text-[10px] font-bold tracking-[0.2em] text-text-secondary uppercase mb-2">
          Enforcement Notice
        </div>

        {/* Status Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-950/30 border border-red-900/30 mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500/80"></span>
          <span className="text-xs font-bold tracking-widest text-red-400 uppercase">Account Suspended</span>
        </div>
        
        <h1 className="text-2xl md:text-3xl font-bold text-white mb-2 tracking-tight">
          Your access has been restricted
        </h1>
        
        <p className="text-text-secondary text-sm md:text-base leading-relaxed text-center mb-5">
          Your account has been suspended due to a violation of the ZYNC Terms of Service. Access to matchmaking and platform features has been disabled.
        </p>
        
        {/* Enforcement Details Card */}
        <div className="w-full bg-black/40 border-t-2 border-t-red-900/50 border-x border-b border-border-subtle rounded-lg p-4 mb-5 text-left">
          <div className="grid grid-cols-2 gap-y-3 gap-x-4">
            <div>
              <div className="text-[10px] font-bold tracking-wider text-text-secondary uppercase mb-1">Status</div>
              <div className="text-xs text-white">Suspended</div>
            </div>
            <div>
              <div className="text-[10px] font-bold tracking-wider text-text-secondary uppercase mb-1">Support Channel</div>
              <div className="text-xs text-zync-cyan font-bold">Dedicated Appeal Desk</div>
            </div>
          </div>
        </div>
        
        {/* Consequence / Evasion Notice */}
        <div className="text-xs text-text-secondary leading-relaxed mb-5 text-center max-w-sm">
          Attempting to bypass a suspension through alternate accounts may result in additional enforcement action.
        </div>

        {error && (
          <div className="w-full mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs text-left">
            {error}
          </div>
        )}
        
        {/* Appeals & Ticket Desk Section */}
        <div className="w-full mb-5">
          {loadingTicket ? (
            <div className="p-4 text-xs text-text-secondary">Checking appeal status...</div>
          ) : appealTicket ? (
            /* Active Appeal Ticket View */
            <div className="w-full bg-black/40 border border-white/10 rounded-xl p-4 text-left space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <div>
                  <div className="text-[10px] text-text-secondary uppercase font-bold tracking-wider">Appeal Case</div>
                  <div className="text-xs font-mono font-bold text-zync-cyan">{appealTicket.ticketNumber}</div>
                </div>
                <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border ${STATUS_CONFIG[appealTicket.status]?.color || 'bg-white/10 text-white'}`}>
                  {STATUS_CONFIG[appealTicket.status]?.label || appealTicket.status}
                </span>
              </div>

              {appealSubmitted && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400 text-xs">
                  ✓ Your appeal has been submitted to the ZYNC Moderation Staff. You can view progress and responses below.
                </div>
              )}

              {/* Message Thread */}
              <div className="max-h-56 overflow-y-auto space-y-3 pr-1">
                {appealTicket.messages?.map((msg, idx) => {
                  const isStaff = msg.senderRole === 'staff';
                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg text-xs leading-relaxed border ${
                        isStaff 
                          ? 'bg-[#0E172A] border-zync-cyan/30 text-white ml-2' 
                          : 'bg-[#18233C] border-white/10 text-white mr-2'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1 font-bold">
                        <span className={isStaff ? 'text-zync-cyan' : 'text-text-secondary'}>
                          {isStaff ? '🛡️ ZYNC Support Staff' : 'Your Appeal'}
                        </span>
                        <span className="text-[10px] text-text-secondary font-normal">
                          {new Date(msg.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap">{msg.message}</p>
                    </div>
                  );
                })}
              </div>

              {/* Follow-up reply box if not closed */}
              {appealTicket.status !== 'closed' ? (
                <form onSubmit={handleReplySubmit} className="pt-2 border-t border-white/10 space-y-2">
                  <textarea
                    rows={2}
                    maxLength={3000}
                    placeholder="Provide additional details or reply to staff..."
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    className="w-full bg-[#0d1424] border border-white/10 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-zync-cyan resize-none"
                    disabled={replying}
                  />
                  <button
                    type="submit"
                    disabled={replying || !replyText.trim()}
                    className="w-full py-2 rounded-lg text-xs font-bold bg-zync-cyan text-black hover:brightness-110 disabled:opacity-50 transition-all"
                  >
                    {replying ? 'Sending...' : 'Send Message to Staff'}
                  </button>
                </form>
              ) : (
                <div className="text-center text-xs text-text-secondary pt-2 border-t border-white/10">
                  This appeal case is closed.
                </div>
              )}
            </div>
          ) : !showAppealForm ? (
            /* Button to open appeal submission */
            <button 
              onClick={() => setShowAppealForm(true)}
              className="w-full py-3 rounded-lg font-bold text-sm bg-bg-secondary hover:bg-[#1f2937] text-white border border-border-subtle transition-colors"
            >
              Submit Appeal
            </button>
          ) : (
            /* Appeal Submission Form */
            <div className="flex flex-col gap-2 w-full text-left bg-black/40 p-4 rounded-xl border border-white/10">
              <label className="text-xs text-text-secondary font-bold uppercase tracking-wider">
                Appeal Statement
              </label>
              <textarea
                value={appealMessage}
                onChange={(e) => setAppealMessage(e.target.value)}
                placeholder="Explain why your suspension should be lifted or provide relevant context..."
                className="w-full h-28 bg-[#0d1424] border border-border-subtle rounded-lg p-3 text-xs text-white focus:outline-none focus:border-zync-cyan resize-none"
                disabled={submitting}
                maxLength={3000}
              />
              <div className="text-right text-[10px] text-text-secondary">
                {appealMessage.length} / 3000
              </div>
              <div className="flex gap-2 mt-1">
                <button 
                  onClick={() => setShowAppealForm(false)}
                  className="flex-1 py-2 rounded-lg font-bold text-xs bg-transparent hover:bg-bg-secondary text-text-secondary border border-border-subtle transition-colors"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAppealSubmit}
                  disabled={submitting || !appealMessage.trim()}
                  className="flex-1 py-2 rounded-lg font-bold text-xs bg-zync-cyan hover:brightness-110 text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-extrabold"
                >
                  {submitting ? 'Submitting...' : 'Submit Appeal'}
                </button>
              </div>
            </div>
          )}
          
          <button 
            onClick={handleLogout}
            className="w-full py-3 mt-3 rounded-lg font-bold text-sm text-text-secondary hover:text-white transition-colors"
          >
            Sign Out
          </button>
        </div>

        {/* Secondary Links */}
        <div className="flex gap-3 text-xs font-medium text-text-secondary">
          <span className="cursor-not-allowed hover:text-text-secondary">Terms of Service</span>
          <span>&middot;</span>
          <span className="cursor-not-allowed hover:text-text-secondary">Community Guidelines</span>
        </div>
      </div>
      
      {/* Footer */}
      <div className="mt-8 text-[10px] font-medium tracking-widest text-white/30 uppercase">
        Issued by ZYNC Trust & Safety
      </div>
    </div>
  );
};

export default AccountSuspended;
