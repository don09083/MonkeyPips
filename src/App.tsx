/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './firebase';
import { AuthView } from './components/AuthView';
import { DashboardView } from './components/DashboardView';
import { MonkeyChatAccount } from './services/monkeyChatService';

const SESSION_STORAGE_KEY = 'monkeychat_active_profile_v1';

export default function App() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(
    auth.currentUser
  );
  const [authReady, setAuthReady] = useState(false);
  const [activeAccount, setActiveAccount] = useState<MonkeyChatAccount | null>(
    () => {
      try {
        const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (!saved) return null;
        const parsed = JSON.parse(saved) as MonkeyChatAccount;
        return {
          ...parsed,
          storageMode: parsed.storageMode || 'browser',
        };
      } catch {
        return null;
      }
    }
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const handleAuthenticated = (account: MonkeyChatAccount) => {
    setActiveAccount(account);
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(account));
    } catch {
      // Ignore storage quota errors
    }
  };

  const handleAccountUpdated = (updated: MonkeyChatAccount) => {
    setActiveAccount(updated);
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore storage quota errors
    }
  };

  const handleLogout = () => {
    setActiveAccount(null);
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#323437] text-[#d1d0c5] flex items-center justify-center p-6">
        <div className="bg-[#2c2e31] border border-[#444444] rounded-lg px-6 py-4 text-xs font-mono text-[#646669]">
          Initializing MonkeyChat session...
        </div>
      </div>
    );
  }

  if (!activeAccount) {
    return (
      <AuthView
        firebaseUser={firebaseUser}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  return (
    <DashboardView
      account={activeAccount}
      onAccountUpdated={handleAccountUpdated}
      onConfirmLogout={handleLogout}
    />
  );
}
