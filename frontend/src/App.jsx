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

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/connections" element={<Connections />} />
          <Route path="/player/:id" element={<PlayerProfile />} />
          <Route path="/chat/:userId" element={<Chat />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
