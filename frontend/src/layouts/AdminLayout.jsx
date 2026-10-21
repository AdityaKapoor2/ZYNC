import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import zyncLogo from '../assets/zync-logo.png';

const AdminLayout = () => {
  const { logout, userProfile } = useAuth();
  const location = useLocation();

  const navigation = [
    { name: 'Overview', href: '/admin', active: location.pathname === '/admin' },
    { name: 'Users', href: '/admin/users', active: location.pathname.startsWith('/admin/users') },
    { name: 'Reports', href: '/admin/reports', active: location.pathname.startsWith('/admin/reports') },
    { name: 'Support Tickets', href: '/admin/tickets', active: location.pathname.startsWith('/admin/tickets') },
    { name: 'Notifications', href: '/admin/notifications', active: location.pathname.startsWith('/admin/notifications') },
    { name: 'Analytics', href: '#', active: false, disabled: true },
  ];

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex font-sans">
      {/* Sidebar */}
      <div className="w-64 bg-[#0A0F1E] border-r border-white/10 hidden md:flex flex-col">
        <div className="p-6">
          <Link to="/" className="inline-flex items-center gap-3">
            <div className="w-8 h-8 bg-[#080B14] rounded-lg flex items-center justify-center overflow-hidden border border-white/10">
              <img src={zyncLogo} alt="ZYNC Logo" className="w-full h-full object-contain" />
            </div>
            <span className="text-xl font-bold tracking-widest text-white">
              ZYNC<span className="text-zync-cyan ml-1 text-sm align-top">Admin</span>
            </span>
          </Link>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-4">
          {navigation.map((item) => (
            <Link
              key={item.name}
              to={item.disabled ? '#' : item.href}
              className={`flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                item.active 
                  ? 'bg-white/10 text-white' 
                  : item.disabled 
                    ? 'text-white/30 cursor-not-allowed' 
                    : 'text-text-secondary hover:bg-white/5 hover:text-white'
              }`}
              onClick={(e) => {
                if (item.disabled) e.preventDefault();
              }}
            >
              {item.name}
              {item.disabled && (
                <span className="ml-auto text-[10px] uppercase tracking-wider bg-white/5 px-2 py-0.5 rounded text-white/40">
                  Soon
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-white/10">
          <div className="text-xs text-text-secondary mb-4 px-2">
            Logged in as:<br/>
            <strong className="text-white">{userProfile?.displayName}</strong>
          </div>
          <button
            onClick={logout}
            className="w-full px-4 py-2 text-sm font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-lg transition-colors text-left"
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 bg-[#0A0F1E] border-b border-white/10">
          <Link to="/" className="inline-flex items-center gap-2">
            <div className="w-8 h-8 bg-[#080B14] rounded-lg flex items-center justify-center overflow-hidden border border-white/10">
              <img src={zyncLogo} alt="ZYNC Logo" className="w-full h-full object-contain" />
            </div>
            <span className="text-lg font-bold tracking-widest text-white">ZYNC Admin</span>
          </Link>
          <Link to="/dashboard" className="text-xs font-bold text-zync-cyan hover:text-white transition-colors">
            Back to App
          </Link>
        </div>

        {/* Top Navbar (Desktop) */}
        <header className="hidden md:flex h-16 border-b border-white/10 bg-[#0A0F1E]/50 backdrop-blur items-center justify-end px-8">
          <Link to="/dashboard" className="text-sm font-bold text-zync-cyan hover:text-white transition-colors flex items-center gap-2">
            ← Back to ZYNC App
          </Link>
        </header>

        {/* Main Area */}
        <main className="flex-1 overflow-auto p-4 md:p-8 bg-black/20">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminLayout;
