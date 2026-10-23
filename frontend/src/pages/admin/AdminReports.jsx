import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../../config/api';
const validReasons = [
  'Toxic or abusive behavior',
  'Harassment',
  'Spam',
  'Threatening behavior',
  'Cheating/scamming',
  'Inappropriate messages',
  'Other'
];

const AdminReports = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Pagination & Filtering
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState('');
  const [reporterFilter, setReporterFilter] = useState('');
  const [reportedUserFilter, setReportedUserFilter] = useState('');
  
  // Selected report for details
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [reportDetails, setReportDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const [moderationFormVisible, setModerationFormVisible] = useState(false);
  const [modAction, setModAction] = useState('warning');
  const [modReason, setModReason] = useState('');
  const [modNotes, setModNotes] = useState('');
  const [modDays, setModDays] = useState(7);
  const [modError, setModError] = useState('');
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmModal, setConfirmModal] = useState({ 
    visible: false, 
    isOpen: false, 
    title: '', 
    message: '', 
    actionText: 'Confirm', 
    onConfirm: null, 
    isDestructive: false 
  });

  useEffect(() => {
    fetchReports();
  }, [page, statusFilter, reasonFilter, reporterFilter, reportedUserFilter]);

  const fetchReports = async () => {
    try {
      setLoading(true);
      setError('');
      const token = await currentUser.getIdToken();
      
      const queryParams = new URLSearchParams({
        page,
        limit: 20
      });
      
      if (statusFilter) queryParams.append('status', statusFilter);
      if (reasonFilter) queryParams.append('reason', reasonFilter);
      if (reporterFilter) queryParams.append('reporter', reporterFilter);
      if (reportedUserFilter) queryParams.append('reportedUser', reportedUserFilter);

      const response = await fetch(`${API_URL}/admin/reports?${queryParams.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to fetch reports');
      
      const data = await response.json();
      setReports(data.reports || []);
      setTotalPages(data.pagination?.totalPages || 1);
    } catch (err) {
      console.error(err);
      setError('Could not load reports. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchReportDetails = async (id) => {
    try {
      setDetailsLoading(true);
      setSelectedReportId(id);
      const token = await currentUser.getIdToken();
      
      const response = await fetch(`${API_URL}/admin/reports/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) throw new Error('Failed to fetch report details');
      
      const data = await response.json();
      setReportDetails(data);
    } catch (err) {
      console.error(err);
      alert('Could not load report details.');
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleCloseModal = () => {
    setSelectedReportId(null);
    setReportDetails(null);
    setModerationFormVisible(false);
    setModAction('warning');
    setModReason('');
    setModNotes('');
    setModError('');
    setConfirmModal({ visible: false, isOpen: false, title: '', message: '', actionText: 'Confirm', onConfirm: null, isDestructive: false });
  };

  const handleUpdateStatus = async (newStatus) => {
    try {
      setIsSubmitting(true);
      const token = await currentUser.getIdToken();
      
      const response = await fetch(`${API_URL}/admin/reports/${selectedReportId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update report status');
      }
      
      const data = await response.json();
      setReportDetails(data.report);
      fetchReports(); // Refresh the list behind the modal
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      setIsSubmitting(false);
      setConfirmModal({ visible: false, isOpen: false, title: '', message: '', actionText: 'Confirm', onConfirm: null, isDestructive: false });
    }
  };

  const requestUpdateStatus = (newStatus) => {
    setConfirmModal({
      visible: true,
      isOpen: true,
      title: 'Update Report Status',
      message: `Are you sure you want to mark this report as ${newStatus}?`,
      actionText: 'Update Status',
      isDestructive: false,
      onConfirm: () => handleUpdateStatus(newStatus)
    });
  };

  const submitModerationAction = async (isDismiss = false) => {
    if (isSubmitting) return;
    try {
      setIsSubmitting(true);
      setModError('');
      const token = await currentUser.getIdToken();
      let expiresAt;
      
      const actionTypeToUse = isDismiss ? 'report_dismissed' : modAction;

      if (actionTypeToUse === 'temporary_suspension') {
        const d = new Date();
        d.setDate(d.getDate() + parseInt(modDays, 10));
        expiresAt = d.toISOString();
      }

      const reasonToUse = isDismiss ? 'No violation found' : modReason.trim();

      const targetUserId = reportDetails?.reportedUser?._id || reportDetails?.reportedUser;
      if (!targetUserId) {
        throw new Error('No reported user associated with this report');
      }
      
      const resAction = await fetch(`${API_URL}/admin/moderation-actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          affectedUserId: targetUserId,
          actionType: actionTypeToUse,
          reason: reasonToUse,
          notes: modNotes.trim() || undefined,
          relatedReportId: reportDetails._id,
          expiresAt
        })
      });

      if (!resAction.ok) {
        const errorData = await resAction.json();
        throw new Error(errorData.message || 'Failed to create moderation action');
      }

      // Close the moderation form and reset fields
      setModerationFormVisible(false);
      setModReason('');
      setModNotes('');
      setModError('');

      // Refresh both the detailed report in modal and the reports table
      await fetchReportDetails(selectedReportId);
      fetchReports();
    } catch (err) {
      console.error('Moderation action submission failed:', err);
      setModError(err.message || 'Failed to apply moderation action');
      if (isDismiss) {
        alert(err.message || 'Failed to dismiss report');
      }
    } finally {
      setIsSubmitting(false);
      setConfirmModal({ visible: false, isOpen: false, title: '', message: '', actionText: 'Confirm', onConfirm: null, isDestructive: false });
    }
  };

  const requestDismissReport = () => {
    setConfirmModal({
      visible: true,
      isOpen: true,
      title: 'Dismiss Report',
      message: `Are you sure you want to dismiss this report? The reported user will not be penalized.`,
      actionText: 'Dismiss Report',
      isDestructive: false,
      onConfirm: () => submitModerationAction(true)
    });
  };

  const [messageComposer, setMessageComposer] = useState({
    visible: false,
    recipientType: '', // 'reporter' or 'reportedUser'
    text: '',
    isSending: false
  });

  const handleSendMessage = async () => {
    if (!messageComposer.text.trim()) return;
    try {
      setMessageComposer(prev => ({ ...prev, isSending: true }));
      const token = await currentUser.getIdToken();
      
      const response = await fetch(`${API_URL}/admin/reports/${selectedReportId}/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          recipientType: messageComposer.recipientType,
          message: messageComposer.text
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to send message');
      }
      
      const data = await response.json();
      setMessageComposer({ visible: false, recipientType: '', text: '', isSending: false });
      
      if (window.confirm('Message sent successfully. Go to chat?')) {
        navigate(`/chat?conversation=${data.conversationId}`);
      }
    } catch (err) {
      console.error(err);
      alert(err.message);
      setMessageComposer(prev => ({ ...prev, isSending: false }));
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'pending': return 'bg-yellow-500/20 text-yellow-400';
      case 'reviewed': return 'bg-blue-500/20 text-blue-400';
      case 'resolved': return 'bg-green-500/20 text-green-400';
      case 'dismissed': return 'bg-gray-500/20 text-gray-400';
      default: return 'bg-white/10 text-white';
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 text-text-primary">
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight mb-2">
          Reports
        </h1>
        <p className="text-text-secondary">
          Review user-submitted reports and moderation evidence.
        </p>
      </div>

      {error && (
        <div className="flex items-center justify-between text-red-500 bg-red-500/10 p-4 rounded-lg">
          <span>{error}</span>
          <button onClick={fetchReports} className="text-sm font-bold underline hover:text-red-400">Retry</button>
        </div>
      )}

      <div className="bg-[#0A0F1E]/80 backdrop-blur border border-white/10 rounded-xl p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <select 
            value={statusFilter} 
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none text-sm appearance-none"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>

          <select 
            value={reasonFilter} 
            onChange={(e) => { setReasonFilter(e.target.value); setPage(1); }}
            className="bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none text-sm appearance-none"
          >
            <option value="">All Reasons</option>
            {validReasons.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Filter by Reporter ID..."
            value={reporterFilter}
            onChange={(e) => { setReporterFilter(e.target.value); setPage(1); }}
            className="bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-zync-cyan focus:ring-1 focus:ring-zync-cyan text-sm"
          />

          <input
            type="text"
            placeholder="Filter by Reported User ID..."
            value={reportedUserFilter}
            onChange={(e) => { setReportedUserFilter(e.target.value); setPage(1); }}
            className="bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-zync-cyan focus:ring-1 focus:ring-zync-cyan text-sm"
          />
        </div>

        {loading ? (
          <div className="text-center py-8 text-zync-cyan animate-pulse font-bold tracking-widest">LOADING REPORTS...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-black/40 text-text-secondary uppercase tracking-widest text-xs">
                <tr>
                  <th className="px-4 py-3 rounded-tl-lg">Reported User</th>
                  <th className="px-4 py-3">Reporter</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Evidence</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 rounded-tr-lg">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {reports.map(report => (
                  <tr key={report._id} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3 font-medium text-white">
                      {report.reportedUser?.displayName || report.reportedUser?.email || report.reportedUser?._id || 'Unknown'}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {report.reporter?.displayName || report.reporter?.email || report.reporter?._id || 'Unknown'}
                    </td>
                    <td className="px-4 py-3 text-white truncate max-w-[150px]" title={report.reason}>
                      {report.reason}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${getStatusColor(report.status)}`}>
                        {report.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {report.evidenceMessageCount} msgs
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {new Date(report.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <button 
                        onClick={() => fetchReportDetails(report._id)}
                        className="text-zync-cyan hover:text-white font-bold text-xs"
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
                {reports.length === 0 && (
                  <tr>
                    <td colSpan="7" className="px-4 py-8 text-center text-text-secondary">No reports found.</td>
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

      {/* Report Details Modal */}
      {selectedReportId && reportDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-bg-card w-full max-w-3xl rounded-xl border border-white/10 p-6 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-start mb-4 border-b border-white/10 pb-4 shrink-0">
              <div>
                <h2 className="text-2xl font-bold text-white mb-1">Report Details</h2>
                <div className="text-xs text-text-secondary break-all">ID: {reportDetails._id}</div>
              </div>
              <button onClick={handleCloseModal} className="text-white/50 hover:text-white p-2">✕</button>
            </div>

            {detailsLoading ? (
              <div className="text-center py-8 text-zync-cyan font-bold tracking-widest animate-pulse">
                LOADING DETAILS...
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-2 space-y-6">
                
                {/* Status & Reason */}
                <div className="grid grid-cols-2 gap-4 text-sm bg-black/20 p-4 rounded-lg border border-white/5">
                  <div>
                    <span className="text-text-secondary block mb-1">Status</span>
                    <span className={`px-2 py-1 rounded text-xs font-bold ${getStatusColor(reportDetails.status)} inline-block`}>
                      {reportDetails.status}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-secondary block mb-1">Reason</span>
                    <span className="font-bold text-white">{reportDetails.reason}</span>
                  </div>
                  <div>
                    <span className="text-text-secondary block mb-1">Created</span>
                    <span className="text-white">{new Date(reportDetails.createdAt).toLocaleString()}</span>
                  </div>
                  {reportDetails.moderationAction && (
                    <div>
                      <span className="text-text-secondary block mb-1">Moderation Action</span>
                      <span className="font-bold text-white">{reportDetails.moderationAction}</span>
                    </div>
                  )}
                </div>

                {/* Status Actions */}
                {reportDetails.status === 'pending' && (
                  <div className="flex justify-end gap-3">
                    <button 
                      onClick={() => requestUpdateStatus('reviewed')}
                      disabled={isSubmitting}
                      className="px-4 py-2 bg-zync-cyan hover:bg-cyan-400 text-black font-bold rounded-lg text-sm transition-colors disabled:opacity-50"
                    >
                      {isSubmitting ? 'Starting...' : 'Start Review'}
                    </button>
                  </div>
                )}
                
                {reportDetails.status === 'reviewed' && (
                  <div className="bg-black/30 p-4 rounded-lg border border-white/10 space-y-4">
                    {!moderationFormVisible ? (
                      <div className="flex justify-between items-center">
                        <div className="text-sm text-text-secondary">
                          Review complete. Select an outcome:
                        </div>
                        <div className="flex gap-3">
                          <button 
                            onClick={requestDismissReport}
                            disabled={isSubmitting}
                            className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-bold rounded-lg text-sm transition-colors border border-white/20 disabled:opacity-50"
                          >
                            Dismiss Report
                          </button>
                          <button 
                            onClick={() => setModerationFormVisible(true)}
                            disabled={isSubmitting}
                            className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 font-bold rounded-lg text-sm transition-colors border border-red-500/30 disabled:opacity-50"
                          >
                            Take Moderation Action
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex justify-between items-center">
                          <h3 className="font-bold text-white">Apply Moderation Action</h3>
                          <div className="text-xs text-text-secondary">
                            Target: <span className="font-bold text-red-400">{reportDetails.reportedUser?.displayName || reportDetails.reportedUser?.email || 'Reported User'}</span>
                          </div>
                        </div>

                        {modError && (
                          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-lg text-xs">
                            {modError}
                          </div>
                        )}
                        
                        <div>
                          <label className="block text-xs font-bold text-text-secondary mb-1">Action Type</label>
                          <select
                            value={modAction}
                            onChange={(e) => setModAction(e.target.value)}
                            disabled={isSubmitting}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-zync-cyan text-sm disabled:opacity-50"
                          >
                            <option value="warning">Warning Only</option>
                            <option value="temporary_suspension">Temporary Suspension</option>
                            <option value="permanent_suspension">Permanent Suspension</option>
                          </select>
                        </div>

                        {modAction === 'temporary_suspension' && (
                          <div>
                            <label className="block text-xs font-bold text-text-secondary mb-1">Suspension Duration (Days)</label>
                            <input
                              type="number"
                              min="1"
                              max="365"
                              value={modDays}
                              onChange={(e) => setModDays(e.target.value)}
                              disabled={isSubmitting}
                              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-zync-cyan text-sm disabled:opacity-50"
                            />
                          </div>
                        )}

                        <div>
                          <label className="block text-xs font-bold text-text-secondary mb-1">Reason (Visible to User)</label>
                          <input
                            type="text"
                            value={modReason}
                            onChange={(e) => setModReason(e.target.value)}
                            placeholder="e.g. Violation of community guidelines regarding harassment."
                            disabled={isSubmitting}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-zync-cyan text-sm disabled:opacity-50"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-text-secondary mb-1">Internal Notes (Admins Only)</label>
                          <textarea
                            value={modNotes}
                            onChange={(e) => setModNotes(e.target.value)}
                            placeholder="Optional notes for other admins..."
                            rows="2"
                            disabled={isSubmitting}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-zync-cyan text-sm disabled:opacity-50"
                          />
                        </div>

                        <div className="flex justify-end gap-3 pt-2">
                          <button 
                            onClick={() => {
                              setModerationFormVisible(false);
                              setModError('');
                            }}
                            disabled={isSubmitting}
                            className="px-4 py-2 bg-transparent text-text-secondary hover:text-white font-bold rounded-lg text-sm transition-colors disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button 
                            onClick={() => submitModerationAction(false)}
                            disabled={!modReason.trim() || isSubmitting}
                            className="px-4 py-2 bg-red-500 hover:bg-red-400 disabled:bg-red-500/50 text-white font-bold rounded-lg text-sm transition-colors"
                          >
                            {isSubmitting ? 'Applying...' : 'Confirm Action'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Description */}
                {reportDetails.description && (
                  <div>
                    <h3 className="font-bold text-white mb-2 text-sm uppercase tracking-wider text-text-secondary">Description</h3>
                    <div className="bg-white/5 p-4 rounded-lg text-sm text-white whitespace-pre-wrap">
                      {reportDetails.description}
                    </div>
                  </div>
                )}

                {/* Users involved */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-black/20 border border-white/5 p-4 rounded-lg flex flex-col justify-between">
                    <div>
                      <h3 className="font-bold text-xs uppercase tracking-wider text-text-secondary mb-3">Reporter</h3>
                      {reportDetails.reporter ? (
                        <div className="text-sm">
                          <div className="font-bold text-white">{reportDetails.reporter.displayName}</div>
                          <div className="text-text-secondary">{reportDetails.reporter.email}</div>
                          <div className="text-xs text-text-secondary mt-1 opacity-50 break-all">{reportDetails.reporter._id}</div>
                        </div>
                      ) : (
                        <div className="text-sm text-text-secondary italic">Unknown</div>
                      )}
                    </div>
                    {reportDetails.reporter && (
                      <div className="mt-4">
                        <button
                          onClick={() => setMessageComposer({ visible: true, recipientType: 'reporter', text: '', isSending: false })}
                          className="px-3 py-1.5 bg-zync-cyan/20 hover:bg-zync-cyan/30 text-zync-cyan border border-zync-cyan/30 rounded text-xs font-bold transition-colors w-full"
                        >
                          Message Reporter
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="bg-black/20 border border-white/5 p-4 rounded-lg border-l-4 border-l-red-500/50 flex flex-col justify-between">
                    <div>
                      <h3 className="font-bold text-xs uppercase tracking-wider text-text-secondary mb-3">Reported User</h3>
                      {reportDetails.reportedUser ? (
                        <div className="text-sm">
                          <div className="font-bold text-white">{reportDetails.reportedUser.displayName}</div>
                          <div className="text-text-secondary">{reportDetails.reportedUser.email}</div>
                          <div className="text-xs text-text-secondary mt-1 opacity-50 break-all">{reportDetails.reportedUser._id}</div>
                        </div>
                      ) : (
                        <div className="text-sm text-text-secondary italic">Unknown</div>
                      )}
                    </div>
                    {reportDetails.reportedUser && (
                      <div className="mt-4">
                        <button
                          onClick={() => setMessageComposer({ visible: true, recipientType: 'reportedUser', text: '', isSending: false })}
                          className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 rounded text-xs font-bold transition-colors w-full"
                        >
                          Message Reported User
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Evidence Snapshot */}
                <div>
                  <h3 className="font-bold text-white mb-1 uppercase tracking-wider text-sm flex items-center gap-2">
                    Conversation Evidence
                  </h3>
                  <p className="text-xs text-yellow-500/80 mb-3 italic">
                    Evidence captured when report was submitted.
                  </p>
                  
                  {reportDetails.evidenceMessages && reportDetails.evidenceMessages.length > 0 ? (
                    <div className="space-y-3 bg-[#080B14] p-4 rounded-lg border border-white/5">
                      {reportDetails.evidenceMessages.map((msg, idx) => {
                        let senderLabel = 'Unknown Participant';
                        let isReported = false;
                        let isReporter = false;

                        if (reportDetails.reporter && msg.senderId === reportDetails.reporter._id) {
                          senderLabel = 'REPORTER';
                          isReporter = true;
                        } else if (reportDetails.reportedUser && msg.senderId === reportDetails.reportedUser._id) {
                          senderLabel = 'REPORTED USER';
                          isReported = true;
                        }

                        return (
                          <div 
                            key={idx} 
                            className={`p-3 rounded-lg border ${
                              isReported 
                                ? 'bg-red-500/5 border-red-500/20' 
                                : isReporter 
                                  ? 'bg-blue-500/5 border-blue-500/20' 
                                  : 'bg-white/5 border-white/10'
                            }`}
                          >
                            <div className="flex justify-between items-center mb-1">
                              <span className={`text-[10px] font-bold tracking-widest ${
                                isReported ? 'text-red-400' : isReporter ? 'text-blue-400' : 'text-text-secondary'
                              }`}>
                                {senderLabel}
                              </span>
                              <span className="text-[10px] text-text-secondary">
                                {new Date(msg.timestamp).toLocaleString()}
                              </span>
                            </div>
                            <div className="text-sm text-white break-words whitespace-pre-wrap">
                              {msg.text}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="bg-white/5 p-4 rounded-lg text-sm text-text-secondary italic">
                      No conversation evidence available for this report.
                    </div>
                  )}

                  {/* Moderation History */}
                  {reportDetails.moderationActions && reportDetails.moderationActions.length > 0 && (
                    <div className="mt-6">
                      <h3 className="font-bold text-white mb-2 uppercase tracking-wider text-sm flex items-center gap-2">
                        Moderation Action History
                      </h3>
                      <div className="space-y-3 bg-[#080B14] p-4 rounded-lg border border-white/5">
                        {reportDetails.moderationActions.map((action, idx) => (
                          <div key={idx} className="p-3 rounded-lg border border-white/10 bg-white/5">
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-bold text-red-400 uppercase tracking-wider">
                                {action.actionType.replace('_', ' ')}
                              </span>
                              <span className="text-[10px] text-text-secondary">
                                {new Date(action.createdAt).toLocaleString()}
                              </span>
                            </div>
                            <div className="text-sm text-white font-medium mb-1">
                              Reason: {action.reason}
                            </div>
                            {action.notes && (
                              <div className="text-xs text-text-secondary italic">
                                Notes: {action.notes}
                              </div>
                            )}
                            {action.admin && (
                              <div className="text-[11px] text-text-secondary mt-1">
                                Applied by: {action.admin.displayName || action.admin.email || 'Admin'}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Message Composer Modal */}
      {messageComposer.visible && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-bg-card w-full max-w-md rounded-xl border border-white/10 p-6 shadow-2xl flex flex-col">
            <h3 className="text-xl font-bold text-white mb-2">
              Message {messageComposer.recipientType === 'reporter' ? 'Reporter' : 'Reported User'}
            </h3>
            <p className="text-text-secondary text-xs mb-4">
              This will send a direct message from you (Super Admin) to the user using the ZYNC chat system.
            </p>
            <textarea
              className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-zync-cyan text-sm mb-4 resize-none"
              rows="4"
              placeholder="Type your message here..."
              value={messageComposer.text}
              onChange={(e) => setMessageComposer(prev => ({ ...prev, text: e.target.value }))}
              disabled={messageComposer.isSending}
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setMessageComposer({ visible: false, recipientType: '', text: '', isSending: false })}
                disabled={messageComposer.isSending}
                className="px-4 py-2 bg-transparent text-text-secondary hover:text-white font-bold rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSendMessage}
                disabled={messageComposer.isSending || !messageComposer.text.trim()}
                className="px-4 py-2 bg-zync-cyan hover:bg-cyan-400 text-black font-bold rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {messageComposer.isSending ? 'Sending...' : 'Send Message'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {(confirmModal.visible || confirmModal.isOpen) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-bg-card w-full max-w-md rounded-xl border border-white/10 p-6 shadow-2xl flex flex-col">
            <h3 className="text-xl font-bold text-white mb-2">{confirmModal.title}</h3>
            <p className="text-text-secondary text-sm mb-6">{confirmModal.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmModal({ visible: false, isOpen: false, actionText: 'Confirm', onConfirm: null, title: '', message: '', isDestructive: false })}
                disabled={isSubmitting}
                className="px-4 py-2 bg-transparent text-text-secondary hover:text-white font-bold rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirmModal.onConfirm) {
                    confirmModal.onConfirm();
                  }
                }}
                disabled={isSubmitting}
                className={`px-4 py-2 font-bold rounded-lg text-sm transition-colors ${
                  confirmModal.isDestructive 
                    ? 'bg-red-500 hover:bg-red-400 text-white' 
                    : 'bg-zync-cyan hover:bg-cyan-400 text-black'
                }`}
              >
                {isSubmitting ? 'Confirming...' : (confirmModal.actionText || 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminReports;
