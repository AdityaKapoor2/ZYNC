import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getProfile, getPresenceStatus, setOnlineStatus, setOfflineStatus, getConnectionRequests } from '../services/api';
import zyncLogo from '../assets/zync-logo.png';

const Navbar = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [logoutModalOpen, setLogoutModalOpen] = useState(false);
  const [displayName, setDisplayName] = useState(currentUser?.email || 'User');
  const dropdownRef = useRef(null);

  // Presence State
  const [isOnline, setIsOnline] = useState(false);
  const [onlineUntil, setOnlineUntil] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState('');
  const [presenceLoading, setPresenceLoading] = useState(false);

  // Notifications State
  const [hasNotifications, setHasNotifications] = useState(false);

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

  // Fetch user profile for display name if available
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
          
          // Fetch presence status
          const presence = await getPresenceStatus(token);
          if (isMounted) {
            setIsOnline(presence.isOnline);
            setOnlineUntil(presence.onlineUntil ? new Date(presence.onlineUntil) : null);
          }

          // Fetch notifications (pending requests)
          try {
            const requests = await getConnectionRequests(token);
            if (isMounted && Array.isArray(requests) && requests.length > 0) {
              setHasNotifications(true);
            }
          } catch (e) {
            console.error('Failed to fetch notifications', e);
          }
        } catch (err) {
          // Fallback to email or google display name
          if (isMounted && currentUser.displayName) {
            setDisplayName(currentUser.displayName);
          }
        }
      }
    };
    fetchName();
    return () => { isMounted = false; };
  }, [currentUser]);

  // Countdown Timer
  useEffect(() => {
    if (!isOnline || !onlineUntil) {
      setTimeRemaining('');
      return;
    }

    const intervalId = setInterval(() => {
      const now = new Date();
      const diff = onlineUntil - now;
      
      if (diff <= 0) {
        setIsOnline(false);
        setOnlineUntil(null);
        setTimeRemaining('');
        clearInterval(intervalId);
      } else {
        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);
        setTimeRemaining(`${minutes}:${seconds < 10 ? '0' : ''}${seconds}`);
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [isOnline, onlineUntil]);

  const handleTogglePresence = async () => {
    if (presenceLoading || !currentUser) return;
    try {
      setPresenceLoading(true);
      const token = await currentUser.getIdToken();
      if (isOnline) {
        await setOfflineStatus(token);
        setIsOnline(false);
        setOnlineUntil(null);
        setTimeRemaining('');
      } else {
        const res = await setOnlineStatus(token);
        setIsOnline(res.isOnline);
        setOnlineUntil(new Date(res.onlineUntil));
      }
    } catch (err) {
      console.error(err);
      alert('Failed to update presence status.');
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
              <span className={`text-xs font-bold uppercase tracking-widest flex items-center gap-1.5 ${isOnline ? 'text-white' : 'text-text-secondary'}`}>
                {isOnline ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-zync-cyan animate-pulse shadow-[0_0_8px_rgba(0,255,255,0.5)]"></span>
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500"></span>
                )}
                {isOnline ? 'Online' : 'Offline'}
              </span>
              
              <button 
                onClick={handleTogglePresence}
                disabled={presenceLoading}
                className={`relative w-10 h-5 rounded-full transition-colors focus:outline-none ${
                  isOnline ? 'bg-zync-cyan border border-zync-cyan' : 'bg-bg-secondary border border-border-subtle'
                } disabled:opacity-50`}
              >
                <span className={`absolute top-[3px] left-[3px] w-3 h-3 rounded-full transition-transform ${
                  isOnline ? 'bg-bg-primary translate-x-5' : 'bg-text-secondary translate-x-0'
                }`}></span>
              </button>

              {isOnline && timeRemaining && (
                <span className="text-xs font-bold text-zync-cyan tracking-widest ml-1">{timeRemaining}</span>
              )}
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

export default Navbar;
