import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import Navbar from '../components/Navbar';
import {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead
} from '../services/api';
import { broadcastNotificationAction } from '../services/notificationSync';

export function extractTicketIdentifier(notif) {
  if (!notif) return null;

  // 1. Explicit property if present in payload
  if (typeof notif.ticketNumber === 'string' && notif.ticketNumber.trim()) {
    return notif.ticketNumber.trim();
  }
  if (typeof notif.ticketId === 'string' && notif.ticketId.trim()) {
    return notif.ticketId.trim();
  }

  // 2. Bracketed or word-bounded ticket number in title (e.g. "[TCK-20261023-1001]")
  const title = typeof notif.title === 'string' ? notif.title : '';
  const titleMatch = title.match(/\[(TCK-[A-Za-z0-9-]+)\]/i) || title.match(/\b(TCK-[A-Za-z0-9-]+)\b/i);
  if (titleMatch) {
    return titleMatch[1];
  }

  // 3. Bracketed or word-bounded ticket number in message
  const message = typeof notif.message === 'string' ? notif.message : '';
  const messageMatch = message.match(/\[(TCK-[A-Za-z0-9-]+)\]/i) || message.match(/\b(TCK-[A-Za-z0-9-]+)\b/i);
  if (messageMatch) {
    return messageMatch[1];
  }

  return null;
}

export function isAppealSubmission(notif) {
  if (!notif || typeof notif.title !== 'string') return false;
  return notif.title.trim().toLowerCase() === 'new appeal submitted';
}

const Notifications = () => {
  const { currentUser, userProfile, isAdmin } = useAuth();
  const { socket, isConnected } = useSocket();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const seenLiveIdsRef = useRef(new Set());

  const fetchNotifications = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError('');
    try {
      const token = await currentUser.getIdToken();
      const res = await getUserNotifications(token, page, 20);
      const items = res?.notifications || [];
      setNotifications(items);
      setTotalPages(res?.totalPages || 1);
      setTotalCount(res?.totalCount || 0);

      // Track loaded IDs to avoid duplicate insertion from concurrent socket events
      items.forEach((n) => {
        if (n?._id) seenLiveIdsRef.current.add(n._id);
      });
    } catch (err) {
      console.error(err);
      setError('Failed to load notifications.');
    } finally {
      setLoading(false);
    }
  }, [currentUser, page]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Reconcile current page after socket reconnects to recover missed notifications
  const wasConnectedRef = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) {
      fetchNotifications();
    }
    wasConnectedRef.current = isConnected;
  }, [isConnected, fetchNotifications]);

  // Realtime notification:new event listener
  useEffect(() => {
    if (!socket) return;

    const handleNewNotification = (notif) => {
      if (!notif || !notif._id) return;

      if (seenLiveIdsRef.current.has(notif._id)) {
        return; // Prevent duplicate display or duplicate total increment
      }
      seenLiveIdsRef.current.add(notif._id);

      if (page === 1) {
        setNotifications((prev) => {
          if (prev.some((n) => n._id === notif._id)) {
            return prev;
          }
          const next = [notif, ...prev];
          return next.length > 20 ? next.slice(0, 20) : next;
        });
        setTotalCount((prev) => {
          const next = prev + 1;
          setTotalPages(Math.max(1, Math.ceil(next / 20)));
          return next;
        });
      } else {
        // On later pages, preserve existing page view but update total count and page ceiling
        setTotalCount((prev) => {
          const next = prev + 1;
          setTotalPages(Math.max(1, Math.ceil(next / 20)));
          return next;
        });
      }
    };

    const handleSocketRead = (data) => {
      const readId = data?._id;
      if (readId) {
        setNotifications((prev) =>
          prev.map((n) => (n._id === readId ? { ...n, read: true } : n))
        );
      }
    };

    const handleSocketReadAll = (data) => {
      const cutoffTime = data?.readAt ? new Date(data.readAt).getTime() : Date.now();
      setNotifications((prev) =>
        prev.map((n) => {
          if (!n.createdAt) return { ...n, read: true };
          const itemTime = new Date(n.createdAt).getTime();
          return itemTime <= cutoffTime ? { ...n, read: true } : n;
        })
      );
    };

    socket.on('notification:new', handleNewNotification);
    socket.on('notification:read', handleSocketRead);
    socket.on('notification:read_all', handleSocketReadAll);

    return () => {
      socket.off('notification:new', handleNewNotification);
      socket.off('notification:read', handleSocketRead);
      socket.off('notification:read_all', handleSocketReadAll);
    };
  }, [socket, page]);

  // Listen for local and cross-tab read events to keep list in sync
  useEffect(() => {
    const handleRead = (e) => {
      const readId = e.detail?.id;
      if (readId) {
        setNotifications((prev) =>
          prev.map((n) => (n._id === readId ? { ...n, read: true } : n))
        );
      }
    };

    const handleAllRead = (e) => {
      const cutoffTime = e.detail?.readAt ? new Date(e.detail.readAt).getTime() : Date.now();
      setNotifications((prev) =>
        prev.map((n) => {
          if (!n.createdAt) return { ...n, read: true };
          const itemTime = new Date(n.createdAt).getTime();
          return itemTime <= cutoffTime ? { ...n, read: true } : n;
        })
      );
    };

    window.addEventListener('notificationRead', handleRead);
    window.addEventListener('notificationsAllRead', handleAllRead);

    return () => {
      window.removeEventListener('notificationRead', handleRead);
      window.removeEventListener('notificationsAllRead', handleAllRead);
    };
  }, []);

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
      
      // Notify Navbar in current tab
      window.dispatchEvent(new CustomEvent('notificationRead', { detail: { id } }));

      // Broadcast to other tabs for this user
      if (currentUser?.uid) {
        broadcastNotificationAction({ type: 'read', id, userId: currentUser.uid });
      }
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
      const res = await markAllNotificationsAsRead(token);
      
      const cutoffTime = res?.readAt ? new Date(res.readAt).getTime() : Date.now();

      // Update local state for eligible items at or before cutoff
      setNotifications((prev) =>
        prev.map((n) => {
          if (!n.createdAt) return { ...n, read: true };
          const itemTime = new Date(n.createdAt).getTime();
          return itemTime <= cutoffTime ? { ...n, read: true } : n;
        })
      );
      
      // Notify Navbar in current tab
      window.dispatchEvent(new CustomEvent('notificationsAllRead', { detail: { readAt: res?.readAt } }));

      // Broadcast to other tabs for this user
      if (currentUser?.uid) {
        broadcastNotificationAction({ type: 'readAll', userId: currentUser.uid, readAt: res?.readAt });
      }
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
      setError('Failed to mark all notifications as read. Please try again.');
    }
  };

  const handleNotificationClick = async (notif) => {
    if (!notif.read) {
      handleMarkAsRead(notif._id);
    }

    const ticketId = extractTicketIdentifier(notif);
    const isAppeal = isAppealSubmission(notif);

    if (!ticketId && !isAppeal) {
      // Unrelated notification: marked as read, preserve normal behavior
      return;
    }

    // Suspended users can only access their appeal interface
    if (userProfile?.accountStatus === 'suspended' && !isAdmin) {
      navigate('/account-suspended');
      return;
    }

    if (ticketId) {
      if (isAdmin) {
        navigate(`/admin/tickets?ticket=${encodeURIComponent(ticketId)}`);
      } else {
        navigate(`/support?ticket=${encodeURIComponent(ticketId)}`);
      }
      return;
    }

    if (isAppeal && isAdmin) {
      navigate('/admin/tickets?category=suspension_appeal');
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
              const ticketId = extractTicketIdentifier(notif);
              const isAppeal = isAppealSubmission(notif);
              const isActionable = Boolean(ticketId || isAppeal);

              return (
                <div 
                  key={notif._id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`p-6 rounded-xl border transition-all cursor-pointer relative ${
                    notif.read 
                      ? 'bg-bg-card border-border-subtle opacity-70 hover:opacity-100' 
                      : isWarning
                        ? 'bg-bg-card border-amber-500/60 shadow-[0_0_15px_rgba(245,158,11,0.15)]'
                        : isActionable
                          ? 'bg-bg-card border-zync-cyan shadow-[0_0_15px_rgba(0,255,255,0.15)] hover:border-zync-cyan/80'
                          : 'bg-bg-card border-zync-cyan shadow-[0_0_15px_rgba(0,255,255,0.1)]'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2.5 flex-wrap">
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
                      {ticketId && (
                        <span 
                          data-testid="ticket-badge"
                          className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-zync-cyan/10 text-zync-cyan border border-zync-cyan/30 flex items-center gap-1"
                        >
                          <span>🎫 {ticketId}</span>
                          <span className="text-[9px] opacity-75">↗</span>
                        </span>
                      )}
                      {isAppeal && !ticketId && (
                        <span 
                          data-testid="appeal-badge"
                          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 flex items-center gap-1"
                        >
                          <span>Appeal Desk</span>
                          <span className="text-[9px] opacity-75">↗</span>
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-text-secondary whitespace-nowrap ml-2">
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
