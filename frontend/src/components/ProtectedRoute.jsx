import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ children }) => {
  const { currentUser, userProfile, isAdmin } = useAuth();
  const location = useLocation();

  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // If user profile is suspended, and not admin, block access to protected routes
  if (userProfile?.accountStatus === 'suspended' && !isAdmin) {
    return <Navigate to="/account-suspended" replace />;
  }

  return children ? children : <Outlet />;
};

export default ProtectedRoute;
