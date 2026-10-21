import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead
} from '../services/api';

const Notifications = () => {
  const { currentUser } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    fetchNotifications();
    // eslint-disable-next-line
  }, [page]);

  const fetchNotifications = async () => {
    setLoading(true);
    setError('');
    try {
      const token = await currentUser.getIdToken();
      const res = await getUserNotifications(token, page, 20);
      setNotifications(res.notifications);
      setTotalPages(res.totalPages);
      setTotalCount(res.totalCount);
    } catch (err) {
      console.error(err);
      setError('Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  };

  const [pendingReadIds, setPendingReadIds] = useState(new Set());

  const handleMarkAsRead = async (id) => {
    // Prevent duplicate calls while in flight
    if (pendingReadIds.has(id)) return;

    const targetNotif = notifications.find((n) => n._id === id);
    // If notification is already read, do nothing
    if (!targetNotif || targetNotif.read) return;

    setPendingReadIds((prev) => new Set(prev).add(id));
    try {
      const token = await currentUser.getIdToken();
      await markNotificationAsRead(token, id);
      
      // Update local state immediately on success
      setNotifications((prev) =>
        prev.map((n) => (n._id === id ? { ...n, read: true } : n))
      );
      
      // Notify Navbar to decrement count
      window.dispatchEvent(new Event('notificationRead'));
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
      setError('Failed to update notification status. Please try again.');
    } finally {
      setPendingReadIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const token = await currentUser.getIdToken();
      await markAllNotificationsAsRead(token);
      
      // Update local state immediately on success
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, read: true }))
      );
      
      // Notify Navbar that all notifications are read
      window.dispatchEvent(new Event('notificationsAllRead'));
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
      setError('Failed to mark all notifications as read. Please try again.');
    }
  };

  const hasUnread = notifications.some((n) => !n.read);

  return (
    <div className="min-h-screen flex flex-col bg-bg-primary text-text-primary">
      <Navbar />
      
      <main className="flex-1 container mx-auto px-4 py-8 md:py-12 max-w-4xl">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Notifications</h1>
          {hasUnread && (
            <button
              onClick={handleMarkAllAsRead}
              className="px-4 py-2 bg-bg-secondary border border-border-subtle rounded text-sm font-bold text-text-secondary hover:text-white hover:border-zync-cyan transition-colors uppercase tracking-widest"
            >
              Mark all as read
            </button>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-md bg-red-900/50 border border-red-500 text-red-200">
            {error}
          </div>
        )}

        {loading && notifications.length === 0 ? (
          <div className="text-center py-12">
            <span className="inline-block w-8 h-8 rounded-full border-4 border-zync-blue border-t-transparent animate-spin mb-4"></span>
            <p className="text-text-secondary uppercase tracking-widest font-bold text-sm">Loading notifications...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-16 bg-bg-card border border-border-subtle rounded-xl">
            <div className="text-6xl mb-4 opacity-50">📭</div>
            <h3 className="text-xl font-bold text-white mb-2">You're all caught up!</h3>
            <p className="text-text-secondary">You have no new notifications.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {notifications.map((notif) => {
              const isWarning = notif.title && (notif.title.toLowerCase().includes('warning') || notif.title.toLowerCase().includes('moderation'));
              return (
                <div 
                  key={notif._id}
                  onClick={() => !notif.read && handleMarkAsRead(notif._id)}
                  className={`p-6 rounded-xl border transition-all cursor-pointer relative ${
                    notif.read 
                      ? 'bg-bg-card border-border-subtle opacity-70' 
                      : isWarning
                        ? 'bg-bg-card border-amber-500/60 shadow-[0_0_15px_rgba(245,158,11,0.15)]'
                        : 'bg-bg-card border-zync-cyan shadow-[0_0_15px_rgba(0,255,255,0.1)]'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2.5">
                      {!notif.read && (
                        <span 
                          data-testid="unread-blue-dot"
                          className="w-2.5 h-2.5 rounded-full bg-zync-cyan shadow-[0_0_8px_rgba(0,255,255,0.8)] flex-shrink-0 animate-pulse"
                          title="Unread"
                        />
                      )}
                      <h3 className={`text-lg font-bold ${
                        notif.read 
                          ? 'text-white' 
                          : isWarning 
                            ? 'text-amber-400' 
                            : 'text-zync-cyan'
                      }`}>
                        {notif.title}
                      </h3>
                      {isWarning && (
                        <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          Official Warning
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-text-secondary">
                      {new Date(notif.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-text-primary leading-relaxed whitespace-pre-wrap">
                    {notif.message}
                  </p>
                </div>
              );
            })}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="mt-8 flex justify-center gap-4">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-4 py-2 rounded bg-bg-card border border-border-subtle font-bold text-sm disabled:opacity-50 hover:bg-bg-secondary"
                >
                  PREVIOUS
                </button>
                <span className="flex items-center text-sm font-bold text-text-secondary">
                  PAGE {page} OF {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-4 py-2 rounded bg-bg-card border border-border-subtle font-bold text-sm disabled:opacity-50 hover:bg-bg-secondary"
                >
                  NEXT
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default Notifications;
