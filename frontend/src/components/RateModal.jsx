import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { submitRating } from '../services/api';

const RateModal = ({ isOpen, onClose, targetUserId, targetUserName }) => {
  const { currentUser } = useAuth();
  
  const [overall, setOverall] = useState(0);
  const [categories, setCategories] = useState({
    communication: 0,
    teamwork: 0,
    reliability: 0,
    sportsmanship: 0
  });
  const [feedback, setFeedback] = useState('');
  
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!isOpen) return null;

  const handleCategoryChange = (cat, val) => {
    setCategories(prev => ({ ...prev, [cat]: val }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (overall === 0) {
      setError('Please provide an overall rating.');
      return;
    }

    try {
      setSubmitting(true);
      const token = await currentUser.getIdToken();
      await submitRating(token, {
        ratedUserId: targetUserId,
        overall,
        ...categories,
        feedback
      });
      
      setSuccess('Rating submitted successfully!');
      setTimeout(() => {
        onClose();
        setSuccess('');
        setOverall(0);
        setCategories({ communication: 0, teamwork: 0, reliability: 0, sportsmanship: 0 });
        setFeedback('');
      }, 2000);
    } catch (err) {
      setError(err.message || 'Failed to submit rating. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderStars = (value, setter, size = "text-2xl") => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className={`${size} focus:outline-none ${star <= value ? 'text-yellow-400' : 'text-text-secondary'} hover:text-yellow-300 transition-colors`}
            onClick={() => setter(star)}
          >
            ★
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="bg-bg-card w-full max-w-md rounded-xl border border-border-subtle p-6 shadow-2xl relative">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-text-secondary hover:text-white transition-colors text-xl font-bold"
        >
          &times;
        </button>

        <h2 className="text-2xl font-extrabold text-white mb-2 tracking-tight">
          RATE <span className="text-transparent bg-clip-text bg-gradient-to-r from-zync-blue to-zync-cyan uppercase">{targetUserName}</span>
        </h2>
        <p className="text-sm text-text-secondary mb-6">
          Your feedback shapes the ZYNC community. Ratings are averaged to calculate reputation.
        </p>

        {success ? (
          <div className="bg-green-500/10 border border-green-500 text-green-400 p-4 rounded text-center font-bold tracking-widest uppercase">
            {success}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            
            <div className="flex flex-col gap-1 items-center bg-bg-secondary p-4 rounded-lg">
              <label className="text-sm font-bold text-white uppercase tracking-widest">Overall Rating <span className="text-red-500">*</span></label>
              {renderStars(overall, setOverall, "text-4xl")}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-text-secondary uppercase">Communication</label>
                {renderStars(categories.communication, (val) => handleCategoryChange('communication', val))}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-text-secondary uppercase">Teamwork</label>
                {renderStars(categories.teamwork, (val) => handleCategoryChange('teamwork', val))}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-text-secondary uppercase">Reliability</label>
                {renderStars(categories.reliability, (val) => handleCategoryChange('reliability', val))}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-text-secondary uppercase">Sportsmanship</label>
                {renderStars(categories.sportsmanship, (val) => handleCategoryChange('sportsmanship', val))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-text-secondary uppercase tracking-widest">Feedback (Optional)</label>
              <textarea 
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                maxLength={500}
                className="w-full bg-bg-secondary border border-border-subtle rounded p-3 text-white text-sm focus:outline-none focus:border-zync-blue transition-colors min-h-[80px]"
                placeholder="What did you think of playing with this teammate?"
              ></textarea>
            </div>

            {error && (
              <p className="text-red-400 text-xs font-bold text-center bg-red-400/10 p-2 rounded border border-red-400/20">{error}</p>
            )}

            <button 
              type="submit"
              disabled={submitting}
              className="mt-2 w-full py-3 rounded font-bold text-sm bg-gradient-to-r from-zync-blue to-zync-cyan hover:from-blue-500 hover:to-cyan-400 transition-all text-white uppercase tracking-widest disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit Rating'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default RateModal;
