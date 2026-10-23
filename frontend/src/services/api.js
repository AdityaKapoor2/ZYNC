const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

/**
 * Helper function for making authenticated requests
 */
async function fetchWithAuth(endpoint, token, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...options.headers,
  };

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'API request failed');
  }

  return data;
}

export const verifyAuth = async (token) => {
  return fetchWithAuth('/auth/verify', token, { method: 'POST' });
};

export const getProfile = async (token) => {
  return fetchWithAuth('/profiles/me', token, { method: 'GET' });
};

export const updateProfile = async (token, profileData) => {
  return fetchWithAuth('/profiles/me', token, {
    method: 'PUT',
    body: JSON.stringify(profileData),
  });
};

export const getMatches = async (token, game) => {
  const url = game ? `/matches?game=${encodeURIComponent(game)}` : '/matches';
  return fetchWithAuth(url, token, { method: 'GET' });
};

export const getMatchExplanation = async (token, targetUserId) => {
  return fetchWithAuth(`/matches/${targetUserId}/explanation`, token, { method: 'GET' });
};

// PUBLIC PROFILE
export const getPublicProfile = async (token, userId) => {
  return fetchWithAuth(`/profiles/user/${userId}`, token, { method: 'GET' });
};

// CONNECTIONS
export const getConnections = async (token) => {
  return fetchWithAuth('/connections', token, { method: 'GET' });
};

export const getConnectionRequests = async (token) => {
  return fetchWithAuth('/connections/requests', token, { method: 'GET' });
};

export const getSentConnections = async (token) => {
  return fetchWithAuth('/connections/sent', token, { method: 'GET' });
};

export const sendConnectionRequest = async (token, userId) => {
  return fetchWithAuth(`/connections/request/${userId}`, token, { method: 'POST' });
};

export const acceptConnection = async (token, connectionId) => {
  return fetchWithAuth(`/connections/${connectionId}/accept`, token, { method: 'PUT' });
};

export const rejectConnection = async (token, connectionId) => {
  return fetchWithAuth(`/connections/${connectionId}/reject`, token, { method: 'PUT' });
};

export const removeConnection = async (token, connectionId) => {
  return fetchWithAuth(`/connections/${connectionId}`, token, { method: 'DELETE' });
};

// PRESENCE
export const setOnlineStatus = async (token) => {
  return fetchWithAuth('/presence/online', token, { method: 'POST' });
};

export const setOfflineStatus = async (token) => {
  return fetchWithAuth('/presence/offline', token, { method: 'POST' });
};

export const getPresenceStatus = async (token) => {
  return fetchWithAuth('/presence/me', token, { method: 'GET' });
};

export const setVisibilityPreference = async (token, visibilityPreference) => {
  return fetchWithAuth('/presence/visibility', token, {
    method: 'PUT',
    body: JSON.stringify({ visibilityPreference }),
  });
};

// CHAT
export const getConversations = async (token) => {
  return fetchWithAuth('/chat/conversations', token, { method: 'GET' });
};

export const getInbox = async (token) => {
  return fetchWithAuth('/chat/inbox', token, { method: 'GET' });
};

export const markConversationAsRead = async (token, conversationId, readSeq) => {
  const body = (readSeq !== undefined && readSeq !== null)
    ? JSON.stringify({ readSeq })
    : undefined;
  return fetchWithAuth(`/chat/conversations/${conversationId}/read`, token, {
    method: 'POST',
    body
  });
};

export const getOrCreateConversation = async (token, targetUserId) => {
  return fetchWithAuth(`/chat/conversations/${targetUserId}`, token, { method: 'POST' });
};

export const getMessages = async (token, conversationId, options = {}) => {
  const params = new URLSearchParams();
  if (options.afterSeq !== undefined && options.afterSeq !== null) {
    params.set('afterSeq', String(options.afterSeq));
  }
  if (options.beforeSeq !== undefined && options.beforeSeq !== null) {
    params.set('beforeSeq', String(options.beforeSeq));
  }
  if (options.limit !== undefined && options.limit !== null) {
    params.set('limit', String(options.limit));
  }
  const queryString = params.toString() ? `?${params.toString()}` : '';
  return fetchWithAuth(`/chat/conversations/${conversationId}/messages${queryString}`, token, { method: 'GET' });
};

export const sendMessage = async (token, conversationId, text, clientMessageIdOrOptions, senderContext) => {
  let clientMessageId;
  let context = senderContext;
  if (typeof clientMessageIdOrOptions === 'object' && clientMessageIdOrOptions !== null) {
    clientMessageId = clientMessageIdOrOptions.clientMessageId;
    context = clientMessageIdOrOptions.senderContext || context;
  } else if (typeof clientMessageIdOrOptions === 'string') {
    if (clientMessageIdOrOptions === 'user' || clientMessageIdOrOptions === 'admin') {
      context = clientMessageIdOrOptions;
    } else {
      clientMessageId = clientMessageIdOrOptions;
    }
  }

  const body = {
    text,
    ...(clientMessageId ? { clientMessageId } : {}),
    ...(context ? { senderContext: context } : {})
  };
  return fetchWithAuth(`/chat/conversations/${conversationId}/messages`, token, {
    method: 'POST',
    body: JSON.stringify(body)
  });
};

// REPORT
export const submitReport = async (token, reportData) => {
  return fetchWithAuth('/reports', token, {
    method: 'POST',
    body: JSON.stringify(reportData)
  });
};

// RATINGS
export const submitRating = async (token, ratingData) => {
  return fetchWithAuth('/ratings', token, {
    method: 'POST',
    body: JSON.stringify(ratingData)
  });
};

// ADMIN NOTIFICATIONS
export const createAdminNotification = async (token, notificationData) => {
  return fetchWithAuth('/admin/notifications', token, {
    method: 'POST',
    body: JSON.stringify(notificationData),
  });
};

export const getAdminNotificationHistory = async (token, page = 1, limit = 20) => {
  return fetchWithAuth(`/admin/notifications?page=${page}&limit=${limit}`, token);
};

// USER NOTIFICATIONS
export const getUserNotifications = async (token, page = 1, limit = 20) => {
  return fetchWithAuth(`/notifications?page=${page}&limit=${limit}`, token);
};

export const getUnreadNotificationCount = async (token) => {
  return fetchWithAuth('/notifications/unread-count', token);
};

export const markNotificationAsRead = async (token, id) => {
  return fetchWithAuth(`/notifications/${id}/read`, token, {
    method: 'PATCH',
  });
};

export const markAllNotificationsAsRead = async (token) => {
  return fetchWithAuth('/notifications/read-all', token, {
    method: 'PATCH',
  });
};

// SUPPORT / APPEALS
export const submitAppeal = async (token, message) => {
  return fetchWithAuth('/support/appeal', token, {
    method: 'POST',
    body: JSON.stringify({ message })
  });
};

// DEDICATED SUPPORT TICKETS
export const createSupportTicket = async (token, { category, subject, message }) => {
  return fetchWithAuth('/support/tickets', token, {
    method: 'POST',
    body: JSON.stringify({ category, subject, message })
  });
};

export const getUserSupportTickets = async (token) => {
  return fetchWithAuth('/support/tickets', token);
};

export const getSupportTicketDetails = async (token, id) => {
  return fetchWithAuth(`/support/tickets/${id}`, token);
};

export const replySupportTicket = async (token, id, text) => {
  return fetchWithAuth(`/support/tickets/${id}/reply`, token, {
    method: 'POST',
    body: JSON.stringify({ text })
  });
};

// STAFF SUPPORT TICKETS
export const getStaffSupportTickets = async (token, params = {}) => {
  const query = new URLSearchParams(params).toString();
  return fetchWithAuth(`/support/admin/tickets${query ? `?${query}` : ''}`, token);
};

export const updateSupportTicketStaffMeta = async (token, id, meta) => {
  return fetchWithAuth(`/support/admin/tickets/${id}`, token, {
    method: 'PATCH',
    body: JSON.stringify(meta)
  });
};

export const addSupportTicketInternalNote = async (token, id, note) => {
  return fetchWithAuth(`/support/admin/tickets/${id}/notes`, token, {
    method: 'POST',
    body: JSON.stringify({ note })
  });
};
