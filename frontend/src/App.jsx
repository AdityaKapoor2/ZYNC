import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Onboarding from './pages/Onboarding';
import Discover from './pages/Discover';
import Connections from './pages/Connections';
import PlayerProfile from './pages/PlayerProfile';
import Chat from './pages/Chat';
import Inbox from './pages/Inbox';
import AdminRoute from './components/AdminRoute';
import AdminLayout from './layouts/AdminLayout';
import AdminOverview from './pages/admin/AdminOverview';
import AdminUsers from './pages/admin/AdminUsers';
import AdminReports from './pages/admin/AdminReports';
import AdminNotifications from './pages/admin/AdminNotifications';
import AdminTickets from './pages/admin/AdminTickets';
import ProtectedRoute from './components/ProtectedRoute';
import AccountSuspended from './pages/AccountSuspended';
import Notifications from './pages/Notifications';
import Support from './pages/Support';
import { SocketProvider } from './context/SocketContext';

function App() {
  return (
    <AuthProvider>
      <Router>
        <SocketProvider>
          <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/account-suspended" element={<AccountSuspended />} />
          
          <Route element={<ProtectedRoute />}>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/inbox" element={<Inbox />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/connections" element={<Connections />} />
            <Route path="/player/:id" element={<PlayerProfile />} />
            <Route path="/chat/:userId" element={<Chat />} />
            <Route path="/support" element={<Support />} />
          </Route>
          <Route path="/admin" element={
            <AdminRoute>
              <AdminLayout />
            </AdminRoute>
          }>
            <Route index element={<AdminOverview />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="reports" element={<AdminReports />} />
            <Route path="tickets" element={<AdminTickets />} />
            <Route path="notifications" element={<AdminNotifications />} />
          </Route>
        </Routes>
        </SocketProvider>
      </Router>
    </AuthProvider>
  );
}

export default App;
