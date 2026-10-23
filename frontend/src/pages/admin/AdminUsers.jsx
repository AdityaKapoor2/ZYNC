import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../../config/api';
const AdminUsers = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Pagination & Filtering
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  
  // Selected user for details
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userDetails, setUserDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [moderationHistory, setModerationHistory] = useState([]);

  useEffect(() => {
    fetchUsers();
  }, [page, search, statusFilter, roleFilter]);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const token = await currentUser.getIdToken();
      
      const queryParams = new URLSearchParams({
        page,
        limit: 20
      });
      
      if (search) queryParams.append('search', search);
      if (statusFilter) queryParams.append('status', statusFilter);
      if (roleFilter) queryParams.append('role', roleFilter);

      const response = await fetch(`${API_URL}/admin/users?${queryParams.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to fetch users');
      
      const data = await response.json();
      setUsers(data.users || []);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      console.error(err);
      setError('Could not load users.');
    } finally {
      setLoading(false);
    }
  };

  const fetchUserDetails = async (id) => {
    try {
      setDetailsLoading(true);
      setSelectedUserId(id);
      const token = await currentUser.getIdToken();
      
      const response = await fetch(`${API_URL}/admin/users/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to fetch user details');
      
      const data = await response.json();
      setUserDetails(data);

      const modRes = await fetch(`${API_URL}/admin/moderation-actions?affectedUser=${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (modRes.ok) {
        const modData = await modRes.json();
        setModerationHistory(modData.actions || []);
      }
    } catch (err) {
      console.error(err);
      alert('Could not load user details.');
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleStatusChange = async (userId, newStatus) => {
    if (!window.confirm(`Are you sure you want to change this user's status to ${newStatus}?`)) {
      return;
    }

    try {
      const token = await currentUser.getIdToken();
      const response = await fetch(`${API_URL}/admin/users/${userId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update status');
      }

      alert(`Status updated to ${newStatus}`);
      
      // Update local state
      if (userDetails && userDetails._id === userId) {
        setUserDetails({ ...userDetails, accountStatus: newStatus });
      }
      
      setUsers(users.map(u => u._id === userId ? { ...u, accountStatus: newStatus } : u));
    } catch (err) {
      console.error(err);
      alert(`Error: ${err.message}`);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 text-text-primary">
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight mb-2">
          User Management
        </h1>
        <p className="text-text-secondary">
          View, search, and manage ZYNC user accounts.
        </p>
      </div>

      {error && <div className="text-red-500 bg-red-500/10 p-4 rounded-lg">{error}</div>}

      <div className="bg-[#0A0F1E]/80 backdrop-blur border border-white/10 rounded-xl p-6">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="flex-1 bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-zync-cyan focus:ring-1 focus:ring-zync-cyan text-sm"
          />
          
          <select 
            value={statusFilter} 
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none text-sm appearance-none"
          >
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>

          <select 
            value={roleFilter} 
            onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
            className="bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none text-sm appearance-none"
          >
            <option value="">All Roles</option>
            <option value="user">User</option>
            <option value="super_admin">Super Admin</option>
          </select>
        </div>

        {loading ? (
          <div className="text-center py-8 text-zync-cyan animate-pulse font-bold tracking-widest">LOADING USERS...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-black/40 text-text-secondary uppercase tracking-widest text-xs">
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">Display Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Reputation</th>
                  <th className="px-4 py-3 rounded-tr-lg">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {users.map(user => (
                  <tr key={user._id} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 font-medium text-white">{user.displayName}</td>
                    <td className="px-4 py-3 text-text-secondary">{user.email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${user.role === 'super_admin' ? 'bg-zync-purple/20 text-zync-purple' : 'bg-white/10 text-text-secondary'}`}>
                        {user.role}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${user.accountStatus === 'suspended' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                        {user.accountStatus || 'active'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {user.reputation ? `${user.reputation.score} (${user.reputation.count})` : '0 (0)'}
                    </td>
                    <td className="px-4 py-3">
                      <button 
                        onClick={() => fetchUserDetails(user._id)}
                        className="text-zync-cyan hover:text-white font-bold text-xs"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan="6" className="px-4 py-8 text-center text-text-secondary">No users found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between mt-6">
          <button 
            disabled={page <= 1} 
            onClick={() => setPage(p => p - 1)}
            className="px-4 py-2 bg-white/5 rounded text-sm disabled:opacity-50 hover:bg-white/10"
          >
            Previous
          </button>
          <span className="text-sm text-text-secondary">Page {page} of {totalPages}</span>
          <button 
            disabled={page >= totalPages} 
            onClick={() => setPage(p => p + 1)}
            className="px-4 py-2 bg-white/5 rounded text-sm disabled:opacity-50 hover:bg-white/10"
          >
            Next
          </button>
        </div>
      </div>

      {/* User Details Modal */}
      {selectedUserId && userDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-bg-card w-full max-w-2xl rounded-xl border border-white/10 p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-start mb-6 border-b border-white/10 pb-4">
              <div>
                <h2 className="text-2xl font-bold text-white">{userDetails.displayName}</h2>
                <p className="text-text-secondary">{userDetails.email}</p>
              </div>
              <button onClick={() => setSelectedUserId(null)} className="text-white/50 hover:text-white">✕</button>
            </div>

            {detailsLoading ? (
              <div className="text-center py-4">Loading details...</div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-text-secondary block">Role</span><span className="font-bold text-white">{userDetails.role}</span></div>
                  <div><span className="text-text-secondary block">Status</span><span className={`font-bold ${userDetails.accountStatus === 'suspended' ? 'text-red-400' : 'text-green-400'}`}>{userDetails.accountStatus || 'active'}</span></div>
                  <div><span className="text-text-secondary block">Joined</span><span className="text-white">{new Date(userDetails.createdAt).toLocaleDateString()}</span></div>
                  <div><span className="text-text-secondary block">Connections</span><span className="text-white">{userDetails.connectionsCount || 0}</span></div>
                </div>

                <div>
                  <h3 className="font-bold text-white mb-2 border-b border-white/10 pb-1">Moderation History</h3>
                  {moderationHistory && moderationHistory.length > 0 ? (
                    <div className="space-y-3">
                      {moderationHistory.map((mod, i) => (
                        <div key={i} className="bg-white/5 p-3 rounded border border-white/10">
                          <div className="flex justify-between items-start mb-1">
                            <span className="font-bold text-red-400 text-sm uppercase tracking-wide">
                              {mod.actionType.replace('_', ' ')}
                            </span>
                            <span className="text-xs text-text-secondary">
                              {new Date(mod.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="text-sm text-white mb-2">
                            <span className="text-text-secondary">Reason:</span> {mod.reason}
                          </div>
                          {mod.notes && (
                            <div className="text-xs text-text-secondary border-t border-white/10 pt-2 mt-2">
                              <span className="font-bold">Admin Notes:</span> {mod.notes}
                            </div>
                          )}
                          <div className="text-xs text-text-secondary mt-2 flex flex-col gap-1">
                            {mod.admin && (
                              <div><span className="font-bold">Moderator:</span> {mod.admin.displayName || mod.admin._id || 'Unknown'}</div>
                            )}
                            {mod.relatedReport && (
                              <div><span className="font-bold">Related Report ID:</span> {mod.relatedReport._id || mod.relatedReport}</div>
                            )}
                          </div>
                          {mod.expiresAt && (
                            <div className="text-xs text-yellow-500 mt-1">
                              Expires: {new Date(mod.expiresAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-text-secondary italic">No moderation history.</p>
                  )}
                </div>

                <div>
                  <h3 className="font-bold text-white mb-2 border-b border-white/10 pb-1">Games</h3>
                  {userDetails.games && userDetails.games.length > 0 ? (
                    <div className="space-y-3">
                      {userDetails.games.map((game, i) => (
                        <div key={i} className="bg-white/5 p-3 rounded">
                          <div className="font-bold text-zync-cyan mb-1">{game.gameName}</div>
                          <div className="text-xs text-text-secondary grid grid-cols-2 gap-2">
                            <div>IGN: <span className="text-white">{game.inGameName}</span></div>
                            <div>Skill: <span className="text-white">{game.skillLevel}</span></div>
                            <div>Playstyle: <span className="text-white">{game.playstyle}</span></div>
                            <div>Comms: <span className="text-white">{game.communication}</span></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-text-secondary">No games linked.</p>
                  )}
                </div>

                <div className="pt-4 border-t border-white/10 flex justify-end gap-3">
                  {userDetails.accountStatus === 'suspended' ? (
                    <button 
                      onClick={() => handleStatusChange(userDetails._id, 'active')}
                      className="px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/50 hover:bg-green-500/30 rounded font-bold text-sm"
                    >
                      Reactivate Account
                    </button>
                  ) : (
                    <button 
                      onClick={() => handleStatusChange(userDetails._id, 'suspended')}
                      className="px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30 rounded font-bold text-sm"
                    >
                      Suspend Account
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminUsers;
