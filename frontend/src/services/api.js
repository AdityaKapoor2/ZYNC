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

export const getMatches = async (token) => {
  return fetchWithAuth('/matches', token, { method: 'GET' });
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
