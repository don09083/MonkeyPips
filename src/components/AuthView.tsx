import React, { useState } from 'react';
import { User } from 'firebase/auth';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  HardDrive,
  KeyRound,
  LogIn,
  RefreshCw,
  ShieldQuestion,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { ensureVerifiedFirebaseUser } from '../firebase';
import {
  generateRandomJapaneseIdentity,
  IdentityGender,
} from '../data/japaneseIdentities';
import {
  AccountStorageMode,
  generateUniqueJapaneseIdentity,
  loginMonkeyChatUser,
  lookupSecurityQuestion,
  MonkeyChatAccount,
  registerMonkeyChatUser,
  validateRegistrationInput,
  verifyAnswerAndResetPassword,
} from '../services/monkeyChatService';
import { SECURITY_QUESTIONS } from '../utils/security';
import { AvatarDisplay } from './AvatarDisplay';

interface AuthViewProps {
  firebaseUser: User | null;
  onAuthenticated: (account: MonkeyChatAccount) => void;
}

type AuthTab = 'login' | 'register' | 'forgot';

export const AuthView: React.FC<AuthViewProps> = ({
  firebaseUser,
  onAuthenticated,
}) => {
  const [activeTab, setActiveTab] = useState<AuthTab>('login');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Login Form State
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Temporary Registration Form State
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regSecurityQuestion, setRegSecurityQuestion] = useState(
    SECURITY_QUESTIONS[0]
  );
  const [regSecurityAnswer, setRegSecurityAnswer] = useState('');
  const [regGender, setRegGender] = useState<IdentityGender>('neutral');

  // Post-click Storage Choice Modal ("Gmail" vs "Browser-Based Storage")
  const [showStorageOptionModal, setShowStorageOptionModal] = useState(false);

  // Preview identity card on auth screen
  const [previewIdentity, setPreviewIdentity] = useState(() =>
    generateRandomJapaneseIdentity('neutral')
  );

  // Forgot Password State
  const [recoveryUsername, setRecoveryUsername] = useState('');
  const [verifiedRecoveryAccount, setVerifiedRecoveryAccount] = useState<{
    usernameId: string;
    username: string;
    securityQuestion: string;
    storageMode: AccountStorageMode;
  } | null>(null);
  const [recoveryAnswer, setRecoveryAnswer] = useState('');
  const [recoveryNewPassword, setRecoveryNewPassword] = useState('');
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState('');

  const switchTab = (tab: AuthTab) => {
    setActiveTab(tab);
    setErrorMsg(null);
    setSuccessMsg(null);
    setShowStorageOptionModal(false);
    if (tab !== 'forgot') {
      setVerifiedRecoveryAccount(null);
      setRecoveryAnswer('');
      setRecoveryNewPassword('');
      setRecoveryConfirmPassword('');
    }
  };

  const handleConnectGoogleSession = async () => {
    setErrorMsg(null);
    setLoading(true);
    try {
      await ensureVerifiedFirebaseUser();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Failed to authorize Gmail session.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!loginUsername.trim() || !loginPassword) {
      setErrorMsg('Please enter both your username and password.');
      return;
    }

    setLoading(true);
    try {
      const account = await loginMonkeyChatUser({
        username: loginUsername,
        password: loginPassword,
      });
      onAuthenticated(account);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to log in. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  /**
   * Step 1 of Registration: Validate fields on clicking "Complete Temporary Registration",
   * then present the two storage options (Browser-Based Storage vs Bind with Gmail).
   */
  const handleRegisterFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    const validationError = validateRegistrationInput({
      username: regUsername,
      password: regPassword,
      confirmPassword: regConfirmPassword,
      securityQuestion: regSecurityQuestion,
      securityAnswer: regSecurityAnswer,
    });

    if (validationError) {
      setErrorMsg(validationError);
      return;
    }

    setShowStorageOptionModal(true);
  };

  // Generating unique identity state for registration
  const [generatingIdentity, setGeneratingIdentity] = useState(false);
  const [identityFeedback, setIdentityFeedback] = useState<string | null>(null);

  /**
   * Step 2 of Registration: Execute registration with the user's selected storage mode
   * ('browser' or 'gmail') using the unique persona guaranteed against the database.
   */
  const handleConfirmRegistrationStorage = async (
    storageMode: AccountStorageMode
  ) => {
    setErrorMsg(null);
    setLoading(true);
    try {
      const account = await registerMonkeyChatUser({
        username: regUsername,
        password: regPassword,
        securityQuestion: regSecurityQuestion,
        securityAnswer: regSecurityAnswer,
        initialGender: regGender,
        displayName: previewIdentity.displayName,
        avatarId: previewIdentity.avatarId,
        storageMode,
      });
      setShowStorageOptionModal(false);
      onAuthenticated(account);
    } catch (err) {
      setShowStorageOptionModal(false);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Registration failed. Please check your details.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateNewUniqueName = async (gender: IdentityGender) => {
    setGeneratingIdentity(true);
    setIdentityFeedback('Verifying database uniqueness...');
    try {
      const uniqueId = await generateUniqueJapaneseIdentity(
        gender,
        previewIdentity.displayName
      );
      setPreviewIdentity(uniqueId);
      setIdentityFeedback('✓ Guaranteed unique Japanese Persona generated');
      setTimeout(() => setIdentityFeedback(null), 3500);
    } catch {
      const fallback = generateRandomJapaneseIdentity(gender, previewIdentity.displayName);
      setPreviewIdentity(fallback);
      setIdentityFeedback(null);
    } finally {
      setGeneratingIdentity(false);
    }
  };

  const handleGenderChangeAndGenerate = async (gender: IdentityGender) => {
    setRegGender(gender);
    await handleGenerateNewUniqueName(gender);
  };

  const handleLookupRecoveryUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!recoveryUsername.trim()) {
      setErrorMsg('Please enter your registered username.');
      return;
    }

    setLoading(true);
    try {
      const found = await lookupSecurityQuestion(recoveryUsername);
      setVerifiedRecoveryAccount(found);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Could not find an account with that username.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!verifiedRecoveryAccount) return;
    if (!recoveryAnswer.trim()) {
      setErrorMsg('Please enter the answer to your security question.');
      return;
    }
    if (recoveryNewPassword.length < 4) {
      setErrorMsg('New password must be at least 4 characters.');
      return;
    }
    if (recoveryNewPassword !== recoveryConfirmPassword) {
      setErrorMsg('New passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await verifyAnswerAndResetPassword({
        usernameId: verifiedRecoveryAccount.usernameId,
        securityAnswer: recoveryAnswer,
        newPassword: recoveryNewPassword,
      });
      setLoginUsername(verifiedRecoveryAccount.username);
      setLoginPassword('');
      setVerifiedRecoveryAccount(null);
      setRecoveryAnswer('');
      setRecoveryNewPassword('');
      setRecoveryConfirmPassword('');
      setActiveTab('login');
      setSuccessMsg(
        'Password successfully reset! You can now log in with your new password.'
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Failed to reset password. Please check your security answer.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePreviewRandomize = (gender: IdentityGender) => {
    setRegGender(gender);
    setPreviewIdentity(
      generateRandomJapaneseIdentity(gender, previewIdentity.displayName)
    );
  };

  return (
    <div className="min-h-screen bg-[#323437] text-[#d1d0c5] flex flex-col">
      {/* Top Bar Contract: 3-Zone Header (Top links removed per request) */}
      <header className="w-full border-b border-[#444444] bg-[#2c2e31] px-6 py-4 flex items-center justify-between">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            switchTab('login');
          }}
          className="text-xl font-bold tracking-tight text-[#e2b714] whitespace-nowrap"
        >
          MonkeyChat
        </a>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3">
          {firebaseUser ? (
            <span className="text-xs font-mono text-[#646669] whitespace-nowrap truncate max-w-[240px]">
              Gmail Connected · {firebaseUser.email || 'Verified'}
            </span>
          ) : (
            <button
              type="button"
              onClick={handleConnectGoogleSession}
              disabled={loading}
              className="px-4 py-2 text-xs font-semibold bg-[#323437] text-[#d1d0c5] border border-[#444444] rounded-md hover:border-[#e2b714] hover:text-[#e2b714] transition-colors duration-150 whitespace-nowrap cursor-pointer"
            >
              Connect Gmail (Optional)
            </button>
          )}
        </div>
      </header>

      {/* Main Content Workspace (1440px baseline container) */}
      <main className="flex-1 w-full max-w-[1200px] mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Editorial Introduction & Architecture (5 cols) */}
        <section
          id="identity-preview"
          className="lg:col-span-5 flex flex-col gap-6 pt-2"
        >
          <div className="space-y-3">
            <p className="text-xs font-mono text-[#e2b714] tracking-wide">
              Browser Storage or Gmail Cloud · Random Japanese Identity
            </p>
            <h1
              className="text-3xl font-bold text-[#d1d0c5] leading-tight"
              style={{ textWrap: 'balance' }}
            >
              distraction-free rooms with automated Japanese identities.
            </h1>
            <p className="text-sm text-[#646669] leading-relaxed">
              Register with either Browser-Based Storage (no email required) or
              bind your account to Gmail for Firebase cloud sync. Every user
              receives a permanent chat room code and a randomly generated,
              duplicate-checked Japanese persona directly configured in the
              registration fields.
            </p>
          </div>

          {/* Architecture Highlights Card */}
          <div className="bg-[#2c2e31] border border-[#444444] rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#444444] pb-3">
              <h2 className="text-sm font-semibold text-[#d1d0c5]">
                Account & Privacy Architecture
              </h2>
              <Sparkles className="w-4 h-4 text-[#e2b714] shrink-0" />
            </div>
            <ul className="space-y-2.5 text-xs text-[#646669]">
              <li className="flex items-start gap-2">
                <span className="text-[#e2b714] font-bold">01.</span>
                <span>
                  <strong className="text-[#d1d0c5]">Unique Japanese Personas:</strong> Guaranteed zero duplicates on the database. Each persona includes authentic Romaji + Kanji and an assigned avatar.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#e2b714] font-bold">02.</span>
                <span>
                  <strong className="text-[#d1d0c5]">Browser-Based Storage:</strong> Instant access with zero email requirements, syncing across open tabs and real-time rooms.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#e2b714] font-bold">03.</span>
                <span>
                  <strong className="text-[#d1d0c5]">Permanent Chat Room:</strong> Every registered account owns 1 personal room with optional password protection.
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* Right Column: Authentication Forms (7 cols) */}
        <section className="lg:col-span-7 bg-[#2c2e31] border border-[#444444] rounded-lg p-6 sm:p-8">
          {/* Segmented Mode Control */}
          <div className="grid grid-cols-3 gap-2 p-1 bg-[#323437] border border-[#444444] rounded-md mb-6">
            <button
              type="button"
              onClick={() => switchTab('login')}
              className={`py-2 px-4 text-xs font-semibold rounded transition-colors duration-150 whitespace-nowrap cursor-pointer ${
                activeTab === 'login'
                  ? 'bg-[#e2b714] text-[#323437]'
                  : 'text-[#646669] hover:text-[#d1d0c5]'
              }`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => switchTab('register')}
              className={`py-2 px-4 text-xs font-semibold rounded transition-colors duration-150 whitespace-nowrap cursor-pointer ${
                activeTab === 'register'
                  ? 'bg-[#e2b714] text-[#323437]'
                  : 'text-[#646669] hover:text-[#d1d0c5]'
              }`}
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => switchTab('forgot')}
              className={`py-2 px-4 text-xs font-semibold rounded transition-colors duration-150 whitespace-nowrap cursor-pointer ${
                activeTab === 'forgot'
                  ? 'bg-[#e2b714] text-[#323437]'
                  : 'text-[#646669] hover:text-[#d1d0c5]'
              }`}
            >
              Forgot Password
            </button>
          </div>

          {/* Status & Error Banners */}
          {errorMsg && (
            <div
              role="alert"
              className="mb-6 p-3.5 rounded-md bg-[#323437] border border-[#e2b714] text-xs text-[#d1d0c5] flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 text-[#e2b714] shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div
              role="status"
              className="mb-6 p-3.5 rounded-md bg-[#323437] border border-[#e2b714] text-xs text-[#d1d0c5] flex items-start gap-2.5"
            >
              <CheckCircle2 className="w-4 h-4 text-[#e2b714] shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* 1. LOGIN FORM */}
          {activeTab === 'login' && (
            <form onSubmit={handleLoginSubmit} className="space-y-5">
              <div className="border-b border-[#444444] pb-4">
                <h2 className="text-lg font-semibold text-[#d1d0c5] flex items-center gap-2">
                  <LogIn className="w-4 h-4 text-[#e2b714]" />
                  <span>Sign in to MonkeyChat</span>
                </h2>
                <p className="text-xs text-[#646669] mt-1">
                  Works with both Browser-Based Storage accounts and Gmail-bound
                  cloud accounts.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="login-username"
                    className="block text-xs font-medium text-[#d1d0c5] mb-1.5"
                  >
                    Username
                  </label>
                  <input
                    id="login-username"
                    type="text"
                    required
                    maxLength={32}
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    placeholder="e.g. satoshi_99"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#323437] border border-[#444444] rounded-md text-[#d1d0c5] placeholder-[#646669] focus:outline-none focus:border-[#e2b714] transition-colors"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="login-password"
                      className="block text-xs font-medium text-[#d1d0c5]"
                    >
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => switchTab('forgot')}
                      className="text-xs text-[#e2b714] hover:underline cursor-pointer"
                    >
                      Forgot Password?
                    </button>
                  </div>
                  <input
                    id="login-password"
                    type="password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#323437] border border-[#444444] rounded-md text-[#d1d0c5] placeholder-[#646669] focus:outline-none focus:border-[#e2b714] transition-colors"
                  />
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full sm:w-auto px-6 py-2.5 text-sm font-semibold bg-[#e2b714] text-[#323437] rounded-md hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  {loading ? 'Signing In...' : 'Login to Personal Room'}
                </button>

                <button
                  type="button"
                  onClick={() => switchTab('register')}
                  className="text-xs text-[#646669] hover:text-[#d1d0c5] transition-colors whitespace-nowrap cursor-pointer"
                >
                  Need an account? Temporary Registration →
                </button>
              </div>
            </form>
          )}

          {/* 2. TEMPORARY REGISTRATION FORM */}
          {activeTab === 'register' && (
            <form onSubmit={handleRegisterFormSubmit} className="space-y-5">
              <div className="border-b border-[#444444] pb-4">
                <h2 className="text-lg font-semibold text-[#d1d0c5] flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-[#e2b714]" />
                  <span>Temporary Registration Form</span>
                </h2>
                <p className="text-xs text-[#646669] mt-1">
                  Fill out your details below. After clicking Complete Temporary
                  Registration, you can choose between Browser-Based Storage (no
                  email needed) or binding with Gmail.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="reg-username"
                    className="block text-xs font-medium text-[#d1d0c5] mb-1.5"
                  >
                    Username
                  </label>
                  <input
                    id="reg-username"
                    type="text"
                    required
                    maxLength={32}
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    placeholder="Letters, numbers, underscores (e.g. kenji_01)"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#323437] border border-[#444444] rounded-md text-[#d1d0c5] placeholder-[#646669] focus:outline-none focus:border-[#e2b714] transition-colors"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="reg-password"
                      className="block text-xs font-medium text-[#d1d0c5] mb-1.5"
                    >
                      Password
                    </label>
                    <input
                      id="reg-password"
                      type="password"
                      required
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Min. 4 characters"
                      className="w-full px-3.5 py-2.5 text-sm bg-[#323437] border border-[#444444] rounded-md text-[#d1d0c5] placeholder-[#646669] focus:outline-none focus:border-[#e2b714] transition-colors"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="reg-confirm-password"
                      className="block text-xs font-medium text-[#d1d0c5] mb-1.5"
                    >
                      Confirm Password
                    </label>
                    <input
                      id="reg-confirm-password"
                      type="password"
                      required
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      className="w-full px-3.5 py-2.5 text-sm bg-[#323437] border border-[#444444] rounded-md text-[#d1d0c5] placeholder-[#646669] focus:outline-none focus:border-[#e2b714] transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reg-security-question"
                    className="block text-xs font-medium text-[#d1d0c5] mb-1.5"
                  >
                    Security Question
                  </label>
                  <select
                    id="reg-security-question"
                    value={regSecurityQuestion}
                    onChange={(e) => setRegSecurityQuestion(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm bg-[#323437] border border-[#444444] rounded-md text-[#d1d0c5] focus:outline-none focus:border-[#e2b714] transition-colors"
                  >
                    {SECURITY_QUESTIONS.map((q) => (
                      <option
                        key={q}
                        value={q}
                        className="bg-[#323437] text-[#d1d0c5]"
                      >
                        {q}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="reg-security-answer"
                    className="block text-xs font-medium text-[#d1d0c5] mb-1.5"
                  >
                    Security Answer
                  </label>
                  <input
                    id="reg-security-answer"
                    type="text"
                    required
                    value={regSecurityAnswer}
                    onChange={(e) => setRegSecurityAnswer(e.target.value)}
                    placeholder="Your answer for password recovery"
                    className="w-full px-3.5 py-2.5 text-sm bg-[#323437] border border-[#444444] rounded-md text-[#d1d0c5] placeholder-[#646669] focus:outline-none focus:border-[#e2b714] transition-colors"
                  />
                </div>

                {/* Transfer of Random Identity System into Registration Fields */}
                <div className="bg-[#2c2e31] border border-[#444444] rounded-lg p-4 space-y-3.5">
                  <div className="flex items-center justify-between border-b border-[#444444] pb-2.5">
                    <div>
                      <span className="text-xs font-semibold text-[#d1d0c5] flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[#e2b714]" />
                        <span>Random Identity System</span>
                      </span>
                      <p className="text-[11px] text-[#646669]">
                        Select gender and generate unique Japanese persona
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-[#e2b714] bg-[#3a3520] px-2 py-0.5 rounded border border-[#e2b714]/40">
                      Zero DB Duplicates
                    </span>
                  </div>

                  {/* Gender Selector Buttons */}
                  <div>
                    <span className="block text-xs font-medium text-[#d1d0c5] mb-1.5">
                      Select Gender for Persona:
                    </span>
                    <div className="grid grid-cols-3 gap-2">
                      {(['male', 'female', 'neutral'] as IdentityGender[]).map(
                        (g) => (
                          <button
                            key={g}
                            type="button"
                            onClick={() => handleGenderChangeAndGenerate(g)}
                            disabled={generatingIdentity}
                            className={`py-1.5 px-3 text-xs font-medium rounded-md border transition-colors capitalize whitespace-nowrap cursor-pointer ${
                              regGender === g
                                ? 'bg-[#e2b714] text-[#323437] border-[#e2b714] font-semibold'
                                : 'bg-[#323437] text-[#d1d0c5] border-[#444444] hover:border-[#e2b714]'
                            }`}
                          >
                            {g}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Current Generated Persona & Small Button to Generate New Name */}
                  <div className="flex items-center justify-between p-3 rounded-md bg-[#323437] border border-[#444444] gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <AvatarDisplay
                        avatarId={previewIdentity.avatarId}
                        displayName={previewIdentity.displayName}
                        size="md"
                      />
                      <div className="min-w-0">
                        <p
                          className="text-sm font-semibold text-[#d1d0c5] truncate"
                          title={previewIdentity.displayName}
                        >
                          {previewIdentity.displayName}
                        </p>
                        <p className="text-[11px] font-mono text-[#646669]">
                          Gender: {previewIdentity.gender} · Assigned Avatar
                        </p>
                      </div>
                    </div>

                    {/* Small button to generate new name based on selected gender */}
                    <button
                      type="button"
                      onClick={() => handleGenerateNewUniqueName(regGender)}
                      disabled={generatingIdentity}
                      className="px-2.5 py-1.5 text-xs font-semibold bg-[#2c2e31] text-[#d1d0c5] border border-[#444444] hover:border-[#e2b714] hover:text-[#e2b714] rounded-md transition-colors flex items-center gap-1.5 shrink-0 whitespace-nowrap cursor-pointer disabled:opacity-50"
                      title="Generate new name based on selected gender (guaranteed no duplicate in database)"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          generatingIdentity ? 'animate-spin text-[#e2b714]' : ''
                        }`}
                      />
                      <span>{generatingIdentity ? 'Checking...' : 'New Name'}</span>
                    </button>
                  </div>

                  {identityFeedback && (
                    <p className="text-xs text-[#e2b714] font-mono">
                      {identityFeedback}
                    </p>
                  )}
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full sm:w-auto px-6 py-2.5 text-sm font-semibold bg-[#e2b714] text-[#323437] rounded-md hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  {loading
                    ? 'Creating Room & Identity...'
                    : 'Complete Temporary Registration'}
                </button>

                <button
                  type="button"
                  onClick={() => switchTab('login')}
                  className="text-xs text-[#646669] hover:text-[#d1d0c5] transition-colors whitespace-nowrap cursor-pointer"
                >
                  Already registered? Sign In →
                </button>
              </div>
            </form>
          )}

          {/* 3. FORGOT PASSWORD LOGIC */}
          {activeTab === 'forgot' && (
            <div className="space-y-5">
              <div className="border-b border-[#444444] pb-4">
                <h2 className="text-lg font-semibold text-[#d1d0c5] flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-[#e2b714]" />
                  <span>Password Recovery via Security Question</span>
                </h2>
                <p className="text-xs text-[#646669] mt-1">
                  Verify your username and answer your registered security
                  question to reset your password.
                </p>
              </div>

              {!verifiedRecoveryAccount ? (
                <form
                  onSubmit={handleLookupRecoveryUsername}
                  className="space-y-4"
                >
                  <div>
                    <label
                      htmlFor="recovery-username"
                      className="block text-xs font-medium text-[#d1d0c5] mb-1.5"
                    >
                      Registered Username
                    </label>
                    <input
                      id="recovery-username"
                      type="text"
                      required
                      maxLength={32}
                      value={recoveryUsername}
                      onChange={(e) => setRecoveryUsername(e.target.value)}
                      placeholder="Enter your username to fetch security question"
                      className="w-full px-3.5 py-2.5 text-sm bg-[#323437] border border-[#444444] rounded-md text-[#d1d0c5] placeholder-[#646669] focus:outline-none focus:border-[#e2b714] transition-colors"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-6 py-2.5 text-sm font-semibold bg-[#e2b714] text-[#323437] rounded-md hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                    >
                      {loading ? 'Verifying...' : 'Verify Username'}
                    </button>

                    <button
                      type="button"
                      onClick={() => switchTab('login')}
                      className="text-xs text-[#646669] hover:text-[#d1d0c5] transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Back to Login
                    </button>
                  </div>
                </form>
              ) : (
                <form
                  onSubmit={handleResetPasswordSubmit}
                  className="space-y-4"
                >
                  <div className="p-3.5 rounded-md bg-[#323437] border border-[#444444] space-y-1">
                    <span className="text-xs text-[#646669] flex items-center gap-1.5">
                      <ShieldQuestion className="w-3.5 h-3.5 text-[#e2b714]" />
                      Registered Security Question for @
                      {verifiedRecoveryAccount.username} (
                      {verifiedRecoveryAccount.storageMode === 'browser'
                        ? 'Browser Storage'
                        : 'Gmail Cloud'}
                      ):
                    </span>
                    <p className="text-sm font-semibold text-[#d1d0c5]">
                      {verifiedRecoveryAccount.securityQuestion}
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="recovery-answer"
                      className="block text-xs font-medium text-[#d1d0c5] mb-1.5"
                    >
                      Your Security Answer
                    </label>
                    <input
                      id="recovery-answer"
                      type="text"
                      required
                      value={recoveryAnswer}
                      onChange={(e) => setRecoveryAnswer(e.target.value)}
                      placeholder="Enter your registered answer"
                      className="w-full px-3.5 py-2.5 text-sm bg-[#323437] border border-[#444444] rounded-md text-[#d1d0c5] placeholder-[#646669] focus:outline-none focus:border-[#e2b714] transition-colors"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="recovery-new-password"
                        className="block text-xs font-medium text-[#d1d0c5] mb-1.5"
                      >
                        New Password
                      </label>
                      <input
                        id="recovery-new-password"
                        type="password"
                        required
                        value={recoveryNewPassword}
                        onChange={(e) => setRecoveryNewPassword(e.target.value)}
                        placeholder="Min. 4 characters"
                        className="w-full px-3.5 py-2.5 text-sm bg-[#323437] border border-[#444444] rounded-md text-[#d1d0c5] placeholder-[#646669] focus:outline-none focus:border-[#e2b714] transition-colors"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="recovery-confirm-password"
                        className="block text-xs font-medium text-[#d1d0c5] mb-1.5"
                      >
                        Confirm New Password
                      </label>
                      <input
                        id="recovery-confirm-password"
                        type="password"
                        required
                        value={recoveryConfirmPassword}
                        onChange={(e) =>
                          setRecoveryConfirmPassword(e.target.value)
                        }
                        placeholder="Confirm new password"
                        className="w-full px-3.5 py-2.5 text-sm bg-[#323437] border border-[#444444] rounded-md text-[#d1d0c5] placeholder-[#646669] focus:outline-none focus:border-[#e2b714] transition-colors"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-6 py-2.5 text-sm font-semibold bg-[#e2b714] text-[#323437] rounded-md hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                    >
                      {loading ? 'Resetting Password...' : 'Reset Password'}
                    </button>

                    <button
                      type="button"
                      onClick={() => setVerifiedRecoveryAccount(null)}
                      className="text-xs text-[#646669] hover:text-[#d1d0c5] transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Change Username
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Subtle Storage Mode Note */}
          <div className="mt-6 pt-4 border-t border-[#444444] flex flex-wrap items-center justify-between gap-2 text-xs text-[#646669]">
            <span>
              No email? Choose Browser-Based Storage during registration and
              bind to Gmail anytime later.
            </span>
          </div>
        </section>
      </main>

      {/* Post-Registration Storage Mode Choice Modal ("Browser-Based Storage" vs "Bind with Gmail") */}
      {showStorageOptionModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="storage-modal-title"
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg bg-[#2c2e31] border border-[#444444] rounded-lg p-6 space-y-5">
            <div className="border-b border-[#444444] pb-4 space-y-1">
              <h3
                id="storage-modal-title"
                className="text-base font-bold text-[#d1d0c5]"
              >
                Choose Account Storage Mode for @{regUsername.trim()}
              </h3>
              <p className="text-xs text-[#646669]">
                Select how you would like to store your account, permanent room
                code, and generated Japanese identity.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Option 1: Browser-Based Storage (No Email Required) */}
              <div className="bg-[#323437] border border-[#444444] rounded-lg p-4 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[#e2b714]">
                    <HardDrive className="w-4 h-4 shrink-0" />
                    <span className="text-xs font-bold text-[#d1d0c5]">
                      Browser-Based Storage
                    </span>
                  </div>
                  <p className="text-xs text-[#646669] leading-relaxed">
                    No email required. Creates your account and permanent chat
                    room directly in this browser. You can bind your account to
                    Gmail anytime later in your profile.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleConfirmRegistrationStorage('browser')}
                  className="w-full py-2.5 px-3 text-xs font-semibold bg-[#e2b714] text-[#323437] rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  {loading ? 'Creating...' : 'Use Browser Storage'}
                </button>
              </div>

              {/* Option 2: Bind with Gmail (Firebase Cloud Storage) */}
              <div className="bg-[#323437] border border-[#444444] rounded-lg p-4 flex flex-col justify-between space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[#e2b714]">
                    <Cloud className="w-4 h-4 shrink-0" />
                    <span className="text-xs font-bold text-[#d1d0c5]">
                      Bind with Gmail
                    </span>
                  </div>
                  <p className="text-xs text-[#646669] leading-relaxed">
                    Link your account with Google / Gmail now to sync your
                    profile, permanent room code, and real-time group chat in
                    Firebase Firestore.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleConfirmRegistrationStorage('gmail')}
                  className="w-full py-2.5 px-3 text-xs font-semibold bg-[#2c2e31] text-[#d1d0c5] border border-[#e2b714] rounded-md hover:bg-[#e2b714] hover:text-[#323437] transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  {loading ? 'Binding Gmail...' : 'Bind with Gmail'}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end pt-2 border-t border-[#444444]">
              <button
                type="button"
                disabled={loading}
                onClick={() => setShowStorageOptionModal(false)}
                className="px-4 py-1.5 text-xs font-medium text-[#646669] hover:text-[#d1d0c5] transition-colors cursor-pointer"
              >
                Cancel / Edit Registration Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
