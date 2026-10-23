import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { onIdTokenChanged } from 'firebase/auth';
import { auth } from '../config/firebase';
import { useAuth } from './AuthContext';
import { useNavigate } from 'react-router-dom';

const SocketContext = createContext({
  socket: null,
  isConnected: false
});

export const useSocket = () => {
  return useContext(SocketContext);
};

const SOCKET_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

export const SocketProvider = ({ children }) => {
  const { currentUser, userProfile, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  const socketRef = useRef(null);
  const connectedUidRef = useRef(null);
  const connectedRoleRef = useRef(null);
  const isAdminRef = useRef(isAdmin);
  isAdminRef.current = isAdmin;

  useEffect(() => {
    // If not authenticated or profile not yet loaded, ensure disconnected
    if (!currentUser || !userProfile) {
      if (socketRef.current) {
        if (socketRef.current.connected) {
          try {
            socketRef.current.emit('auth:logout');
          } catch (e) {
            // Safe fallback if already closing
          }
        }
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
        setIsConnected(false);
      }
      connectedUidRef.current = null;
      connectedRoleRef.current = null;
      return;
    }

    // If already connected for this exact Firebase user and role, do nothing
    if (
      socketRef.current &&
      connectedUidRef.current === currentUser.uid &&
      connectedRoleRef.current === userProfile.role
    ) {
      return;
    }

    // If user or role changed, tear down prior socket instance
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
      setSocket(null);
      setIsConnected(false);
    }

    connectedUidRef.current = currentUser.uid;
    connectedRoleRef.current = userProfile.role;

    const socketInstance = io(SOCKET_URL, {
      auth: async (cb) => {
        try {
          if (!currentUser) {
            return cb({ error: 'AUTH_REQUIRED' });
          }
          const token = await currentUser.getIdToken();
          cb({ token });
        } catch (err) {
          // Never send raw Firebase errors or invalid tokens
          cb({ error: 'AUTH_TOKEN_UNAVAILABLE' });
        }
      },
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    });

    socketRef.current = socketInstance;
    setSocket(socketInstance);

    const onConnect = () => {
      setIsConnected(true);
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    const onConnectError = (err) => {
      setIsConnected(false);
      const code = err.data?.code || err.message;
      // Prevent uncontrolled reconnect loops on unrecoverable authentication errors
      if (
        code === 'AUTH_REQUIRED' ||
        code === 'AUTH_TOKEN_UNAVAILABLE' ||
        code === 'INVALID_TOKEN' ||
        code === 'USER_NOT_FOUND' ||
        code === 'CORS_ORIGIN_DENIED'
      ) {
        socketInstance.disconnect();
      }
    };

    const onStatusChanged = ({ accountStatus }) => {
      if (accountStatus === 'suspended' && !isAdminRef.current) {
        navigate('/account-suspended');
      }
    };

    socketInstance.on('connect', onConnect);
    socketInstance.on('disconnect', onDisconnect);
    socketInstance.on('connect_error', onConnectError);
    socketInstance.on('account:status_changed', onStatusChanged);

    return () => {
      socketInstance.off('connect', onConnect);
      socketInstance.off('disconnect', onDisconnect);
      socketInstance.off('connect_error', onConnectError);
      socketInstance.off('account:status_changed', onStatusChanged);
      socketInstance.disconnect();
      socketRef.current = null;
      connectedUidRef.current = null;
      connectedRoleRef.current = null;
    };
  }, [currentUser, userProfile, isAdmin, navigate]);

  // Token change listener: reconnect when a fresh token becomes available
  useEffect(() => {
    if (!auth) return;

    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      if (user && socketRef.current && !socketRef.current.connected) {
        // Deliberate reconnect when authentication state or token updates
        socketRef.current.connect();
      }
    });

    return unsubscribe;
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};
