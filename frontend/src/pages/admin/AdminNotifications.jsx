import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { createAdminNotification, getAdminNotificationHistory } from '../../services/api';

const SUPPORTED_GAMES = ['BGMI', 'Brawl Stars', 'Valorant'];

const generateIdempotencyKey = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'idemp-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
};

const AdminNotifications = () => {
  const { currentUser } = useAuth();
  
  // Form State
  const [audienceType, setAudienceType] = useState('all');
  const [targetGame, setTargetGame] = useState(SUPPORTED_GAMES[0]);
  const [recipientId, setRecipientId] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');

  // Stable idempotency key per intentional submission (retained on retry, refreshed on success)
  const idempotencyKeyRef = useRef(null);
  if (!idempotencyKeyRef.current) {
    idempotencyKeyRef.current = generateIdempotencyKey();
  }
  
  // UI State
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  // History State
  const [history, setHistory] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line
  }, [page]);

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const token = await currentUser.getIdToken();
      const res = await getAdminNotificationHistory(token, page, 20);
      setHistory(res.broadcasts);
      setTotalPages(res.totalPages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const validateForm = () => {
    setError('');
    if (!title.trim()) return 'Title is required.';
    if (!message.trim()) return 'Message is required.';
    if (audienceType === 'individual' && !recipientId.trim()) return 'Recipient ID is required for individual messages.';
    if (title.length > 100) return 'Title must be 100 characters or less.';
    if (message.length > 1000) return 'Message must be 1000 characters or less.';
    return null;
  };

  const handlePreSubmit = (e) => {
    e.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    setConfirmModalOpen(true);
  };

  const handleSend = async () => {
    setConfirmModalOpen(false);
    setSending(true);
    setError('');
    setSuccess('');

    try {
      const token = await currentUser.getIdToken();
      
      const payload = {
        audienceType,
        title: title.trim(),
        message: message.trim(),
        idempotencyKey: idempotencyKeyRef.current,
      };

      if (audienceType === 'game') payload.targetGame = targetGame;
      if (audienceType === 'individual') payload.recipientId = recipientId.trim();

      const res = await createAdminNotification(token, payload);
      
      setSuccess(`Successfully sent notification to ${res.recipientCount} user(s).`);
      
      // Reset form and generate fresh idempotency key for next distinct broadcast
      idempotencyKeyRef.current = generateIdempotencyKey();
      setTitle('');
      setMessage('');
      setRecipientId('');
      setPage(1);
      fetchHistory();

    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to send notification.');
      // idempotencyKeyRef.current is preserved on retry
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h2 className="text-3xl font-extrabold text-white mb-6 uppercase tracking-widest">
        Notifications Management
      </h2>

      {/* Compose Notification */}
      <div className="bg-bg-card border border-border-subtle rounded-xl p-6 mb-10">
        <h3 className="text-xl font-bold text-white mb-4">Compose Broadcast</h3>
        
        {error && (
          <div className="mb-6 p-4 rounded-md bg-red-900/50 border border-red-500 text-red-200">
            {error}
          </div>
        )}
        
        {success && (
          <div className="mb-6 p-4 rounded-md bg-green-900/50 border border-green-500 text-green-200">
            {success}
          </div>
        )}

        <form onSubmit={handlePreSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">
                Audience
              </label>
              <select
                value={audienceType}
                onChange={(e) => setAudienceType(e.target.value)}
                className="w-full bg-bg-secondary border border-border-subtle rounded p-3 text-white focus:outline-none focus:border-zync-cyan transition-colors"
                disabled={sending}
              >
                <option value="all">All Users</option>
                <option value="game">Players of a Game</option>
                <option value="individual">Individual User</option>
              </select>
            </div>

            {audienceType === 'game' && (
              <div>
                <label className="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">
                  Target Game
                </label>
                <select
                  value={targetGame}
                  onChange={(e) => setTargetGame(e.target.value)}
                  className="w-full bg-bg-secondary border border-border-subtle rounded p-3 text-white focus:outline-none focus:border-zync-cyan transition-colors"
                  disabled={sending}
                >
                  {SUPPORTED_GAMES.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
            )}

            {audienceType === 'individual' && (
              <div>
                <label className="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">
                  Recipient User ID (ObjectId)
                </label>
                <input
                  type="text"
                  value={recipientId}
                  onChange={(e) => setRecipientId(e.target.value)}
                  placeholder="e.g. 64abc123..."
                  className="w-full bg-bg-secondary border border-border-subtle rounded p-3 text-white focus:outline-none focus:border-zync-cyan transition-colors"
                  disabled={sending}
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Notification Title"
              maxLength={100}
              className="w-full bg-bg-secondary border border-border-subtle rounded p-3 text-white focus:outline-none focus:border-zync-cyan transition-colors"
              disabled={sending}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-2">
              Message
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your message here..."
              rows={4}
              maxLength={1000}
              className="w-full bg-bg-secondary border border-border-subtle rounded p-3 text-white focus:outline-none focus:border-zync-cyan transition-colors"
              disabled={sending}
            />
          </div>

          <button
            type="submit"
            disabled={sending}
            className="w-full py-3 mt-4 bg-zync-cyan text-black font-bold uppercase tracking-widest rounded hover:brightness-110 transition-all disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Review Broadcast'}
          </button>
        </form>
      </div>

      {/* Broadcast History */}
      <div className="bg-bg-card border border-border-subtle rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border-subtle bg-bg-secondary flex justify-between items-center">
          <h3 className="font-bold text-white uppercase tracking-widest">Broadcast History</h3>
        </div>
        
        {loadingHistory ? (
          <div className="p-8 text-center text-text-secondary uppercase tracking-widest text-sm font-bold">
            Loading history...
          </div>
        ) : history.length === 0 ? (
          <div className="p-8 text-center text-text-secondary">
            No broadcast history found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border-subtle text-xs font-bold text-text-secondary uppercase tracking-widest">
                  <th className="p-4">Date</th>
                  <th className="p-4">Audience</th>
                  <th className="p-4">Title</th>
                  <th className="p-4">Recipients</th>
                  <th className="p-4">Sender</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {history.map((b) => (
                  <tr key={b._id} className="border-b border-border-subtle hover:bg-bg-secondary/50 transition-colors">
                    <td className="p-4 whitespace-nowrap text-text-secondary">
                      {new Date(b.createdAt).toLocaleDateString()}
                    </td>
                    <td className="p-4">
                      <span className="inline-block px-2 py-1 rounded bg-bg-secondary text-zync-cyan text-xs font-bold uppercase">
                        {b.audienceType}
                      </span>
                      {b.targetGame && <span className="ml-2 text-xs text-text-secondary">({b.targetGame})</span>}
                    </td>
                    <td className="p-4 font-bold text-white">{b.title}</td>
                    <td className="p-4 text-text-secondary">{b.recipientCount}</td>
                    <td className="p-4 text-text-secondary">{b.sender?.displayName || 'Unknown Admin'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-border-subtle flex justify-between items-center bg-bg-secondary">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 rounded bg-bg-card border border-border-subtle font-bold text-sm text-text-secondary hover:text-white disabled:opacity-50"
            >
              PREVIOUS
            </button>
            <span className="text-sm font-bold text-text-secondary uppercase tracking-widest">
              PAGE {page} OF {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-4 py-2 rounded bg-bg-card border border-border-subtle font-bold text-sm text-text-secondary hover:text-white disabled:opacity-50"
            >
              NEXT
            </button>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-bg-card w-full max-w-lg rounded-xl border border-border-subtle p-6 shadow-2xl">
            <h3 className="text-xl font-extrabold text-white mb-4 tracking-tight">Confirm Broadcast</h3>
            
            <div className="space-y-4 mb-6">
              <div>
                <span className="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-1">Audience</span>
                <span className="text-white">
                  {audienceType === 'all' && 'All Users'}
                  {audienceType === 'game' && `Players of ${targetGame}`}
                  {audienceType === 'individual' && `Individual User (${recipientId})`}
                </span>
              </div>
              <div>
                <span className="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-1">Title</span>
                <span className="text-white font-bold">{title}</span>
              </div>
              <div>
                <span className="block text-xs font-bold text-text-secondary uppercase tracking-widest mb-1">Message</span>
                <p className="text-text-primary whitespace-pre-wrap text-sm p-3 bg-bg-secondary rounded border border-border-subtle">
                  {message}
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setConfirmModalOpen(false)}
                disabled={sending}
                className="flex-1 py-2.5 rounded font-bold text-sm border border-border-subtle text-text-secondary hover:text-white hover:border-gray-500 transition-colors uppercase tracking-widest"
              >
                Cancel
              </button>
              <button 
                onClick={handleSend}
                disabled={sending}
                className="flex-1 py-2.5 rounded font-bold text-sm bg-zync-cyan hover:bg-zync-blue transition-all text-black uppercase tracking-widest"
              >
                {sending ? 'Sending...' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminNotifications;
