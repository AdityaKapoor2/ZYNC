import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { getProfile, getPresenceStatus, setVisibilityPreference, getConnectionRequests, getInbox, getUnreadNotificationCount } from '../services/api';
import { handleNotificationStorageEvent } from '../services/notificationSync';
import zyncLogo from '../assets/zync-logo.png';

const Navbar = () => {
  const { currentUser, logout, isAdmin } = useAuth();
  const { socket, isConnected } = useSocket();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [displayName, setDisplayName] = useState(currentUser?.email || 'User');
  const dropdownRef = useRef(null);

  // Presence State: preference and connection state are strictly separated
  const [visibilityPreference, setVisibilityPreferenceState] = useState('online');
  const [presenceLoading, setPresenceLoading] = useState(false);
  const [presenceError, setPresenceError] = useState('');

  // Notifications State
  const [hasNotifications, setHasNotifications] = useState(false); // for connection requests and unread inbox
  const [unreadCount, setUnreadCount] = useState(0); // for in-app notifications
  const seenNotificationIdsRef = useRef(new Set());

  // Clear seen notification cache when user context changes
  useEffect(() => {
    seenNotificationIdsRef.current.clear();
  }, [currentUser]);

  const checkInboxNotifications = useCallback(async () => {
    if (!currentUser) return;
    try {
      const token = await currentUser.getIdToken();
      const [requests, inboxItems] = await Promise.all([
        getConnectionRequests(token).catch(() => []),
        getInbox(token).catch(() => [])
      ]);
      const hasPendingReqs = Array.isArray(requests) && requests.length > 0;
      const hasUnreadInbox = Array.isArray(inboxItems) && inboxItems.some(
        c => Boolean(c.isUnread)
      );
      setHasNotifications(hasPendingReqs || hasUnreadInbox);
    } catch (e) {
      console.error('Failed to fetch pending requests / inbox items', e);
    }
  }, [currentUser]);

  // Reconcile authoritative unread notifications count from backend
  const refreshUnreadNotificationCount = useCallback(async () => {
    if (!currentUser) {
      setUnreadCount(0);
      return;
    }
    try {
      const token = await currentUser.getIdToken();
      const unreadRes = await getUnreadNotificationCount(token);
      if (unreadRes && typeof unreadRes.count === 'number') {
        setUnreadCount(Math.max(0, unreadRes.count));
      }
    } catch (e) {
      console.error('Failed to fetch unread notification count', e);
    }
  }, [currentUser]);

  // Reconcile inbox notifications on path change or socket reconnection
  useEffect(() => {
    checkInboxNotifications();
  }, [checkInboxNotifications, location.pathname, isConnected]);

  // Realtime notification update when incoming message activity arrives or conversations are marked read
  useEffect(() => {
    if (!socket) return;
    const handleInboxActivity = () => {
      checkInboxNotifications();
    };
    const handleInboxRead = () => {
      checkInboxNotifications();
    };

    socket.on('inbox:activity', handleInboxActivity);
    socket.on('inbox:read', handleInboxRead);

    return () => {
      socket.off('inbox:activity', handleInboxActivity);
      socket.off('inbox:read', handleInboxRead);
    };
  }, [socket, checkInboxNotifications]);

  // Realtime notification:new event listener
  useEffect(() => {
    if (!socket || !currentUser) return;

    const handleNewNotification = (notification) => {
      if (!notification || !notification._id) return;

      // Prevent duplicate-event overcounting if delivered repeatedly
      if (seenNotificationIdsRef.current.has(notification._id)) {
        return;
      }
      seenNotificationIdsRef.current.add(notification._id);
      if (seenNotificationIdsRef.current.size > 200) {
        const first = seenNotificationIdsRef.current.values().next().value;
        seenNotificationIdsRef.current.delete(first);
      }

      // Optimistically increment badge for immediate UI feedback
      setUnreadCount((prev) => prev + 1);

      // Reconcile with authoritative count from server
      refreshUnreadNotificationCount();
    };

    const handleNotificationRead = (data) => {
      if (!data?._id) return;
      setUnreadCount((prev) => Math.max(0, prev - 1));
      refreshUnreadNotificationCount();
    };

    const handleNotificationReadAll = () => {
      setUnreadCount(0);
      refreshUnreadNotificationCount();
    };

    socket.on('notification:new', handleNewNotification);
    socket.on('notification:read', handleNotificationRead);
    socket.on('notification:read_all', handleNotificationReadAll);

    return () => {
      socket.off('notification:new', handleNewNotification);
      socket.off('notification:read', handleNotificationRead);
      socket.off('notification:read_all', handleNotificationReadAll);
    };
  }, [socket, currentUser, refreshUnreadNotificationCount]);

  // Listen for custom inbox read events (e.g. Chat.jsx marking conversation read)
  useEffect(() => {
    window.addEventListener('inboxReadStateChanged', checkInboxNotifications);
    return () => {
      window.removeEventListener('inboxReadStateChanged', checkInboxNotifications);
    };
  }, [checkInboxNotifications]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch user profile for display name and initial status
  useEffect(() => {
    let isMounted = true;
    const fetchName = async () => {
      if (currentUser) {
        try {
          const token = await currentUser.getIdToken();
          const profile = await getProfile(token);
          if (isMounted && profile?.displayName) {
            setDisplayName(profile.displayName);
          }
          
          // Fetch authoritative presence preference
          const presence = await getPresenceStatus(token);
          if (isMounted && presence?.visibilityPreference) {
            setVisibilityPreferenceState(presence.visibilityPreference);
          }

          // Fetch pending requests & inbox items
          await checkInboxNotifications();

          // Fetch unread notifications count
          if (isMounted) {
            await refreshUnreadNotificationCount();
          }
        } catch {
          // Fallback to email or google display name
          if (isMounted && currentUser.displayName) {
            setDisplayName(currentUser.displayName);
          }
        }
      } else {
        setUnreadCount(0);
      }
    };
    fetchName();

    const handleNotificationRead = () => {
      // Decrement unread count locally when an event fires
      setUnreadCount(prev => Math.max(0, prev - 1));
      refreshUnreadNotificationCount();
    };

    const handleAllRead = () => {
      setUnreadCount(0);
      refreshUnreadNotificationCount();
    };

    window.addEventListener('notificationRead', handleNotificationRead);
    window.addEventListener('notificationsAllRead', handleAllRead);

    return () => { 
      isMounted = false; 
      window.removeEventListener('notificationRead', handleNotificationRead);
      window.removeEventListener('notificationsAllRead', handleAllRead);
    };
  }, [currentUser, checkInboxNotifications, refreshUnreadNotificationCount]);

  // Refresh authoritative presence status from server
  const refreshPresence = useCallback(async () => {
    if (!currentUser) return;
    try {
      const token = await currentUser.getIdToken();
      const presence = await getPresenceStatus(token);
      if (presence?.visibilityPreference) {
        setVisibilityPreferenceState(presence.visibilityPreference);
      }
    } catch (e) {
      console.error('Failed to refresh authoritative presence status', e);
    }
  }, [currentUser]);

  // Reconcile presence preference and unread notification count on reconnect
  const wasConnectedRef = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) {
      refreshPresence();
      refreshUnreadNotificationCount();
    }
    wasConnectedRef.current = isConnected;
  }, [isConnected, refreshPresence, refreshUnreadNotificationCount]);

  // Multi-tab synchronization: sync on window focus and local storage changes
  useEffect(() => {
    const handleStorage = (e) => {
      if (e.key === 'zync_visibility_preference' && e.newValue) {
        if (['online', 'invisible'].includes(e.newValue)) {
          setVisibilityPreferenceState(e.newValue);
        }
      }
      handleNotificationStorageEvent(e, currentUser?.uid);
    };

    const handleFocus = () => {
      refreshPresence();
      refreshUnreadNotificationCount();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleFocus);
    };
  }, [currentUser, refreshPresence, refreshUnreadNotificationCount]);

  // Self-directed presence:update listener
  // The saved preference must NEVER be inferred from presence:update events alone.
  // Instead, refresh authoritative state from the server on self update.
  useEffect(() => {
    if (!socket || !currentUser) return;
    const handlePresenceUpdate = (data) => {
      if (!data?.userId) return;
      if (currentUser.uid && data.userId.toString() === currentUser.uid.toString()) {
        refreshPresence();
      }
    };
    socket.on('presence:update', handlePresenceUpdate);
    return () => {
      socket.off('presence:update', handlePresenceUpdate);
    };
  }, [socket, currentUser, refreshPresence]);

  // Toggle user visibility preference between 'online' and 'invisible'
  const handleToggleVisibility = async (targetPreference) => {
    if (presenceLoading || !currentUser) return;
    const nextPref = targetPreference || (visibilityPreference === 'online' ? 'invisible' : 'online');
    if (nextPref === visibilityPreference) return;

    try {
      setPresenceLoading(true);
      setPresenceError('');
      const token = await currentUser.getIdToken();
      const res = await setVisibilityPreference(token, nextPref);
      // Update local preference only after server confirms success
      const confirmedPref = res?.visibilityPreference || nextPref;
      setVisibilityPreferenceState(confirmedPref);
      try {
        localStorage.setItem('zync_visibility_preference', confirmedPref);
      } catch (e) {
        // Ignore localStorage quota or private browsing errors
      }
    } catch (err) {
      console.error('Failed to update visibility preference:', err);
      setPresenceError(err.message || 'Failed to update visibility preference');
      // Retain previous preference on error; allow retry
    } finally {
      setPresenceLoading(false);
    }
  };

  const handleLogoutConfirm = async () => {
    setLogoutModalOpen(false);
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Failed to log out', error);
    }
  };

  const getInitial = (name) => {
    if (!name) return 'U';
    return name.charAt(0).toUpperCase();
  };

  const isActive = (path) => location.pathname === path;

  const linkClass = (path) => 
    `text-sm font-bold tracking-wide transition-colors ${isActive(path) ? 'text-white' : 'text-text-secondary hover:text-white'}`;

  return (
    <>
      <nav className="w-full py-4 md:py-6 px-4 md:px-8 flex justify-between items-center border-b border-border-subtle bg-bg-primary/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3 md:gap-6">
          <Link to="/dashboard" className="flex items-center gap-2 md:gap-3">
            <img src={zyncLogo} alt="ZYNC Logo" className="w-8 h-8 md:w-10 md:h-10 object-contain" />
            <span className="text-xl font-extrabold tracking-tight text-white hidden md:block">ZYNC</span>
          </Link>
          <div className="flex items-center gap-4 md:gap-6 ml-2 md:ml-4">
            <Link to="/notifications" className={`relative flex items-center gap-1.5 ${linkClass('/notifications')}`}>
              🔔 <span>Notifications</span>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-2.5 flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-zync-cyan text-black text-[10px] font-extrabold shadow-lg">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
            <Link to="/inbox" className={`relative ${linkClass('/inbox')}`}>
              Inbox
              {hasNotifications && (
                <span className="absolute -top-1 -right-2.5 w-2 h-2 rounded-full bg-zync-cyan"></span>
              )}
            </Link>
            <Link to="/connections" className={linkClass('/connections')}>Connections</Link>
          </div>
        </div>

        <div className="flex items-center gap-3 md:gap-6">
          {currentUser && (
            <div className="hidden md:flex items-center gap-3 pr-4 border-r border-border-subtle">
              <span 
                data-testid="desktop-presence-status"
                className={`text-xs font-bold uppercase tracking-widest flex items-center gap-1.5 ${
                  visibilityPreference === 'invisible'
                    ? 'text-purple-300'
                    : isConnected
                      ? 'text-white'
                      : 'text-text-secondary'
                }`}
              >
                {visibilityPreference === 'invisible' ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shadow-[0_0_8px_rgba(192,132,252,0.5)]"></span>
                ) : isConnected ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-zync-cyan animate-pulse shadow-[0_0_8px_rgba(0,255,255,0.5)]"></span>
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
                )}
                {visibilityPreference === 'invisible' 
                  ? 'Invisible' 
                  : isConnected 
                    ? 'Online' 
                    : 'Offline'}
              </span>
              
              <button 
                onClick={() => handleToggleVisibility()}
                disabled={presenceLoading}
                aria-label={`Toggle visibility from ${visibilityPreference}`}
                title={`Preference: ${visibilityPreference}. Click to switch to ${visibilityPreference === 'online' ? 'invisible' : 'online'}.`}
                className={`relative w-10 h-5 rounded-full transition-colors focus:outline-none ${
                  visibilityPreference === 'online' ? 'bg-zync-cyan border border-zync-cyan' : 'bg-bg-secondary border border-border-subtle'
                } disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed`}
              >
                <span className={`absolute top-[3px] left-[3px] w-3 h-3 rounded-full transition-transform ${
                  visibilityPreference === 'online' ? 'bg-bg-primary translate-x-5' : 'bg-text-secondary translate-x-0'
                }`}></span>
              </button>
            </div>
          )}

          <div className="relative" ref={dropdownRef}>
          <button 
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="w-10 h-10 rounded-full bg-bg-secondary border border-border-subtle flex items-center justify-center text-white font-bold hover:border-zync-blue transition-colors focus:outline-none"
          >
            {getInitial(displayName)}
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 mt-3 w-56 bg-bg-card border border-border-subtle rounded-md shadow-2xl overflow-hidden py-2 z-50">
              <div className="px-4 py-3 border-b border-border-subtle mb-1">
                <p className="text-sm text-white font-bold truncate">{displayName}</p>
                <p className="text-xs text-text-secondary truncate">{currentUser?.email}</p>
              </div>

              {/* Mobile / Dropdown Visibility Control */}
              <div className="px-4 py-2 border-b border-border-subtle flex items-center justify-between">
                <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">Status</span>
                <button
                  onClick={() => handleToggleVisibility()}
                  disabled={presenceLoading}
                  aria-label={`Toggle visibility from ${visibilityPreference}`}
                  className={`text-xs font-bold px-2.5 py-1 rounded border transition-colors flex items-center gap-1.5 ${
                    visibilityPreference === 'invisible'
                      ? 'border-purple-500/50 text-purple-300 bg-purple-500/10 hover:bg-purple-500/20'
                      : isConnected
                        ? 'border-zync-cyan/50 text-zync-cyan bg-zync-cyan/10 hover:bg-zync-cyan/20'
                        : 'border-border-subtle text-text-secondary bg-bg-secondary hover:text-white'
                  } disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    visibilityPreference === 'invisible'
                      ? 'bg-purple-400'
                      : isConnected
                        ? 'bg-zync-cyan'
                        : 'bg-gray-500'
                  }`}></span>
                  {visibilityPreference === 'invisible' ? 'Invisible' : isConnected ? 'Online' : 'Offline'}
                </button>
              </div>
              {presenceError && (
                <div className="px-4 py-1 text-[11px] text-red-400 border-b border-border-subtle">
                  {presenceError}
                </div>
              )}
              <Link 
                to="/dashboard" 
                onClick={() => setDropdownOpen(false)}
                className="block px-4 py-2 text-sm text-text-secondary hover:bg-bg-secondary hover:text-white transition-colors"
              >
                View Profile
              </Link>
              <Link 
                to="/onboarding?edit=true" 
                onClick={() => setDropdownOpen(false)}
                className="block px-4 py-2 text-sm text-text-secondary hover:bg-bg-secondary hover:text-white transition-colors"
              >
                Edit Profile
              </Link>
              <Link 
                to="/support" 
                onClick={() => setDropdownOpen(false)}
                className="block px-4 py-2 text-sm text-text-secondary hover:bg-bg-secondary hover:text-white transition-colors"
              >
                Contact Support
              </Link>
              {isAdmin && (
                <Link 
                  to="/admin" 
                  onClick={() => setDropdownOpen(false)}
                  className="block px-4 py-2 text-sm font-bold text-zync-cyan hover:bg-bg-secondary hover:brightness-110 transition-colors"
                >
                  Admin Portal
                </Link>
              )}
              <div className="border-t border-border-subtle my-1"></div>
              <button 
                onClick={() => {
                  setDropdownOpen(false);
                  setLogoutModalOpen(true);
                }}
                className="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-bg-secondary hover:text-white transition-colors"
              >
                Log Out
              </button>
            </div>
          )}
        </div>
        </div>
      </nav>

      {/* Logout Confirmation Modal */}
      {logoutModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-bg-card w-full max-w-sm rounded-xl border border-border-subtle p-6 shadow-2xl relative">
            <h3 className="text-xl font-extrabold text-white mb-2 tracking-tight">Log out?</h3>
            <p className="text-sm text-text-secondary mb-6">Are you sure you want to log out of ZYNC?</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setLogoutModalOpen(false)}
                className="flex-1 py-2.5 rounded font-bold text-sm border border-border-subtle text-text-secondary hover:text-white hover:border-gray-500 transition-colors uppercase tracking-widest"
              >
                Cancel
              </button>
              <button 
                onClick={handleLogoutConfirm}
                className="flex-1 py-2.5 rounded font-bold text-sm bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 transition-all text-white uppercase tracking-widest"
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export function computeEffectivePresence({ visibilityPreference, isConnected }) {
  const pref = visibilityPreference || 'online';
  if (pref === 'invisible') {
    return {
      label: 'Invisible',
      preference: 'invisible',
      isConnected: Boolean(isConnected),
      badgeColor: 'purple'
    };
  }
  return {
    label: isConnected ? 'Online' : 'Offline',
    preference: 'online',
    isConnected: Boolean(isConnected),
    badgeColor: isConnected ? 'cyan' : 'gray'
  };
}

export default Navbar;

