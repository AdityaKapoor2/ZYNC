import React, { useState } from 'react';
import { submitReport } from '../services/api';
import { useAuth } from '../context/AuthContext';

const REPORT_REASONS = [
  'Toxic or abusive behavior',
  'Harassment',
  'Spam',
  'Threatening behavior',
  'Cheating/scamming',
  'Inappropriate messages',
  'Other'
];

const ReportModal = ({ isOpen, onClose, reportedUserId, reportedUserName, conversationId }) => {
  const { currentUser } = useAuth();
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reason) {
      setError('Please select a reason');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');
      const token = await currentUser.getIdToken();
      await submitReport(token, {
        reportedUserId,
        reason,
        description,
        conversationId
      });
      setSuccess('Report submitted successfully. Our moderation team will review it.');
      setTimeout(() => {
        onClose();
        setSuccess('');
        setReason('');
        setDescription('');
      }, 2500);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to submit report');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-bg-card border border-border-subtle rounded-xl w-full max-w-md p-6 relative shadow-2xl shadow-black/50">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-secondary hover:text-white transition-colors"
        >
          ✕
        </button>

        <h2 className="text-2xl font-bold text-red-500 mb-2">Report Player</h2>
        <p className="text-sm text-text-secondary mb-6">
          You are reporting <span className="font-bold text-white">{reportedUserName}</span>. This report will be reviewed by moderation.
        </p>

        {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded mb-4 text-sm">{error}</div>}
        {success && <div className="bg-green-500/10 border border-green-500/30 text-green-400 p-3 rounded mb-4 text-sm">{success}</div>}

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-xs font-bold text-text-secondary mb-2 uppercase tracking-widest">
              Reason <span className="text-red-500">*</span>
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-bg-primary border border-border-subtle rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-colors"
              disabled={isSubmitting || success}
            >
              <option value="">Select a reason...</option>
              {REPORT_REASONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div className="mb-6">
            <label className="block text-xs font-bold text-text-secondary mb-2 uppercase tracking-widest">
              Additional Details (Optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-bg-primary border border-border-subtle rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500 transition-colors min-h-[100px]"
              placeholder="Provide any additional context..."
              disabled={isSubmitting || success}
            />
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-bold text-text-secondary hover:text-white transition-colors"
              disabled={isSubmitting || success}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2 rounded-lg text-sm font-bold bg-red-600 hover:brightness-110 text-white transition-all disabled:opacity-50"
              disabled={isSubmitting || success || !reason}
            >
              {isSubmitting ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ReportModal;
