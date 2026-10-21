import React from 'react';
import { useAuth } from '../../context/AuthContext';

const StatCard = ({ title, value, placeholder = false }) => (
  <div className="bg-[#0A0F1E]/80 backdrop-blur border border-white/10 rounded-xl p-6 shadow-sm">
    <h3 className="text-sm font-medium text-text-secondary uppercase tracking-wider mb-2">{title}</h3>
    {placeholder ? (
      <p className="text-xl font-bold text-white/30 italic">Coming soon</p>
    ) : (
      <p className="text-3xl font-bold text-white">{value}</p>
    )}
  </div>
);

const AdminOverview = () => {
  const { userProfile } = useAuth();

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight mb-2">
          Admin Overview
        </h1>
        <p className="text-text-secondary">
          Welcome back, {userProfile?.displayName}. This is the ZYNC administrative control panel.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <StatCard title="Total Users" placeholder={true} />
        <StatCard title="Active Users" placeholder={true} />
        <StatCard title="Pending Reports" placeholder={true} />
        <StatCard title="Connections" placeholder={true} />
      </div>

      <div className="bg-[#0A0F1E]/80 backdrop-blur border border-white/10 rounded-xl p-6 md:p-8 mt-8">
        <h2 className="text-lg font-bold text-white mb-4">System Status</h2>
        <div className="flex items-center gap-3 text-sm text-text-secondary">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          ZYNC backend is operational and fully connected to MongoDB.
        </div>
        <p className="mt-4 text-sm text-white/60">
          This portal allows super administrators to manage users, handle reports, and oversee system health. 
          Additional modules will be activated in future updates.
        </p>
      </div>
    </div>
  );
};

export default AdminOverview;
