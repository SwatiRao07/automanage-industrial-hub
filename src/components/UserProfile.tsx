import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';

const UserProfile: React.FC = () => {
  const { user, signOutUser } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    await signOutUser();
    setIsSigningOut(false);
  };

  if (!user) return null;

  return (
    <div className="flex items-center gap-4">
      {/* User Avatar */}
      {user.photoURL ? (
        <img
          src={user.photoURL}
          alt={user.displayName || user.email || 'User'}
          className="w-8 h-8 rounded-full border-2 border-gray-200"
        />
      ) : (
        <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center">
          <span className="text-sm font-medium text-white">
            {user.displayName?.[0] || user.email?.[0] || 'U'}
          </span>
        </div>
      )}
      
      {/* User Info */}
      <div className="hidden md:block text-right">
        <p className="text-sm font-medium text-gray-900 leading-tight">
          {user.displayName || 'User'}
        </p>
        <p className="text-xs text-gray-500 leading-tight">
          {user.email}
        </p>
      </div>

      {/* Sign Out Button */}
      <button
        onClick={handleSignOut}
        disabled={isSigningOut}
        className="text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 px-3 py-1 rounded-md transition-colors duration-200 disabled:opacity-50"
      >
        {isSigningOut ? 'Signing out...' : 'Sign out'}
      </button>
    </div>
  );
};

export default UserProfile; 