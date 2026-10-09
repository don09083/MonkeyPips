import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Cloud,
  Copy,
  HardDrive,
  Hash,
  Home,
  Link2,
  Lock,
  LogOut,
  Maximize2,
  Minimize2,
  RefreshCw,
  Send,
  Share2,
  Sparkles,
  Unlock,
  Users,
} from 'lucide-react';
import { IdentityGender } from '../data/japaneseIdentities';
import {
  bindBrowserAccountToGmail,
  ChatMessageRecord,
  ensureActiveAccountRoomRegistered,
  generateAndSaveRandomIdentity,
  getRoomRecord,
  joinRoomByCode,
  MonkeyChatAccount,
  RoomMemberRecord,
  RoomRecord,
  sendRoomMessage,
  setRoomLock,
  subscribeToRoom,
  subscribeToRoomMembers,
  subscribeToRoomMessages,
  syncLocalStorageWithServer,
  syncRoomStateToCloud,
} from '../services/monkeyChatService';
import { AvatarDisplay } from './AvatarDisplay';

interface DashboardViewProps {
  account: MonkeyChatAccount;
  onAccountUpdated: (updated: MonkeyChatAccount) => void;
  onConfirmLogout: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  account,
  onAccountUpdated,
  onConfirmLogout,
}) => {
  // Upon logging in, the user is automatically shown their own personal chat room by default
  const [activeRoomCode, setActiveRoomCode] = useState<string>(
    account.roomCode
  );
  const [activeRoom, setActiveRoom] = useState<RoomRecord | null>(null);
  const [roomMembers, setRoomMembers] = useState<RoomMemberRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessageRecord[]>([]);

  // Chat Only Mode (toggled by top-right button icon or Alt + H shortcut)
  const [chatOnlyMode, setChatOnlyMode] = useState(false);

  // Top-right "Join other room?" state
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joinRoomError, setJoinRoomError] = useState<string | null>(null);
  const [joiningRoom, setJoiningRoom] = useState(false);

  // Room Owner Lock Modal state
  const [showLockModal, setShowLockModal] = useState(false);
  const [lockPasswordInput, setLockPasswordInput] = useState('');
  const [lockPasswordConfirm, setLockPasswordConfirm] = useState('');
  const [lockError, setLockError] = useState<string | null>(null);
  const [savingLock, setSavingLock] = useState(false);
  const [lockSuccessMsg, setLockSuccessMsg] = useState<string | null>(null);

  // Non-owner password prompt modal when joining locked room
  const [showPasswordPromptModal, setShowPasswordPromptModal] = useState(false);
  const [pendingJoinRoomCode, setPendingJoinRoomCode] = useState('');
  const [roomPasswordInput, setRoomPasswordInput] = useState('');
  const [passwordPromptError, setPasswordPromptError] = useState<string | null>(null);
  const [verifyingPassword, setVerifyingPassword] = useState(false);

  // Random Identity Modal / Selector state
  const [showGenderPrompt, setShowGenderPrompt] = useState(false);
  const [selectedGender, setSelectedGender] = useState<IdentityGender>(
    account.gender
  );
  const [generatingIdentity, setGeneratingIdentity] = useState(false);
  const [identityFeedback, setIdentityFeedback] = useState<string | null>(null);

  // Bind Account to Gmail state
  const [bindingGmail, setBindingGmail] = useState(false);
  const [bindFeedback, setBindFeedback] = useState<string | null>(null);
  const [bindError, setBindError] = useState<string | null>(null);

  // Copy Room Code / Share state
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Chat composer state
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  // Logout confirmation modal state
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Keyboard shortcut: Alt + H toggles "Chat Only" view
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault();
        setChatOnlyMode((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Check URL query parameter `?room=MC-XXXXXX` on initial mount if shared via link
  useEffect(() => {
    ensureActiveAccountRoomRegistered(account);
    syncLocalStorageWithServer();

    const params = new URLSearchParams(window.location.search);
    const sharedRoom = params.get('room');
    if (sharedRoom && sharedRoom.trim().toUpperCase() !== account.roomCode) {
      setJoinCodeInput(sharedRoom.trim().toUpperCase());
    }
  }, [account]);

  // Real-time listeners for active room metadata, members, and messages
  // Re-subscribes automatically if activeRoomCode or account.storageMode changes
  useEffect(() => {
    syncRoomStateToCloud(activeRoomCode);

    const unsubRoom = subscribeToRoom(activeRoomCode, (roomData) => {
      setActiveRoom(roomData);
    });
    const unsubMembers = subscribeToRoomMembers(activeRoomCode, (members) => {
      setRoomMembers(members);
    });
    const unsubMessages = subscribeToRoomMessages(activeRoomCode, (msgs) => {
      setMessages(msgs);
    });

    return () => {
      unsubRoom();
      unsubMembers();
      unsubMessages();
    };
  }, [activeRoomCode, account.storageMode]);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleCopyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(account.roomCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleCopyShareLink = async () => {
    try {
      const shareUrl = `${window.location.origin}${window.location.pathname}?room=${account.roomCode}`;
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleJoinOtherRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinRoomError(null);

    const trimmed = joinCodeInput.trim().toUpperCase();
    if (!trimmed) {
      setJoinRoomError('There is no existing room for that code.');
      return;
    }

    setJoiningRoom(true);
    try {
      // Check if room exists and if it is password locked
      const targetRoom = await getRoomRecord(trimmed);
      if (!targetRoom) {
        setJoinRoomError('There is no existing room for that code.');
        setJoiningRoom(false);
        return;
      }

      const isOwner =
        targetRoom.ownerUsername === account.usernameId ||
        targetRoom.ownerUid === account.ownerUid;

      // If locked and not owner, trigger password prompt modal
      if (targetRoom.isLocked && !isOwner) {
        setPendingJoinRoomCode(targetRoom.roomCode);
        setRoomPasswordInput('');
        setPasswordPromptError(null);
        setShowPasswordPromptModal(true);
        setJoiningRoom(false);
        return;
      }

      const joinedRoom = await joinRoomByCode({
        rawRoomCode: trimmed,
        account,
      });
      setActiveRoomCode(joinedRoom.roomCode);
      setJoinCodeInput('');
      setJoinRoomError(null);
    } catch (err) {
      if (err instanceof Error && err.message === 'ROOM_LOCKED') {
        setPendingJoinRoomCode(trimmed);
        setRoomPasswordInput('');
        setPasswordPromptError(null);
        setShowPasswordPromptModal(true);
      } else {
        setJoinRoomError('There is no existing room for that code.');
      }
    } finally {
      setJoiningRoom(false);
    }
  };

  const handleUnlockAndJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordPromptError(null);
    if (!roomPasswordInput.trim()) {
      setPasswordPromptError('Please enter the room password.');
      return;
    }

    setVerifyingPassword(true);
    try {
      const joinedRoom = await joinRoomByCode({
        rawRoomCode: pendingJoinRoomCode,
        account,
        roomPassword: roomPasswordInput.trim(),
      });
      setActiveRoomCode(joinedRoom.roomCode);
      setShowPasswordPromptModal(false);
      setJoinCodeInput('');
      setRoomPasswordInput('');
      setPasswordPromptError(null);
      setJoinRoomError(null);
    } catch (err) {
      if (err instanceof Error && err.message === 'INCORRECT_ROOM_PASSWORD') {
        setPasswordPromptError('Incorrect room password. Please try again.');
      } else {
        setPasswordPromptError('Could not join room. Please check the password.');
      }
    } finally {
      setVerifyingPassword(false);
    }
  };

  const handleSaveRoomLock = async (e: React.FormEvent) => {
    e.preventDefault();
    setLockError(null);
    setLockSuccessMsg(null);
    if (!lockPasswordInput.trim()) {
      setLockError('Please enter a password.');
      return;
    }
    if (lockPasswordInput !== lockPasswordConfirm) {
      setLockError('Passwords do not match.');
      return;
    }

    setSavingLock(true);
    try {
      const targetCode = account.roomCode;
      const updated = await setRoomLock({
        roomCode: targetCode,
        isLocked: true,
        password: lockPasswordInput.trim(),
        account,
      });
      if (activeRoomCode === targetCode) {
        setActiveRoom(updated);
      }
      setLockSuccessMsg('Room locked with password successfully.');
      setLockPasswordInput('');
      setLockPasswordConfirm('');
      setTimeout(() => {
        setLockSuccessMsg(null);
        setShowLockModal(false);
      }, 1400);
    } catch (err) {
      setLockError(err instanceof Error ? err.message : 'Failed to lock room.');
    } finally {
      setSavingLock(false);
    }
  };

  const handleUnlockRoom = async () => {
    setLockError(null);
    setLockSuccessMsg(null);
    setSavingLock(true);
    try {
      const targetCode = account.roomCode;
      const updated = await setRoomLock({
        roomCode: targetCode,
        isLocked: false,
        account,
      });
      if (activeRoomCode === targetCode) {
        setActiveRoom(updated);
      }
      setLockSuccessMsg('Room lock removed successfully.');
      setTimeout(() => {
        setLockSuccessMsg(null);
        setShowLockModal(false);
      }, 1400);
    } catch (err) {
      setLockError(err instanceof Error ? err.message : 'Failed to unlock room.');
    } finally {
      setSavingLock(false);
    }
  };

  const handleSwitchToPersonalRoom = () => {
    setJoinRoomError(null);
    setActiveRoomCode(account.roomCode);
  };

  const handleGenerateRandomIdentity = async (genderChoice: IdentityGender) => {
    setGeneratingIdentity(true);
    setIdentityFeedback(null);
    try {
      const updatedAccount = await generateAndSaveRandomIdentity({
        account,
        chosenGender: genderChoice,
        activeRoomCode,
      });
      onAccountUpdated(updatedAccount);
      setSelectedGender(updatedAccount.gender);
      setShowGenderPrompt(false);
      setIdentityFeedback(
        `Identity updated to ${updatedAccount.displayName}`
      );
      setTimeout(() => setIdentityFeedback(null), 3500);
    } catch (err) {
      setIdentityFeedback(
        err instanceof Error
          ? err.message
          : 'Could not update random identity.'
      );
    } finally {
      setGeneratingIdentity(false);
    }
  };

  const handleBindToGmail = async () => {
    setBindingGmail(true);
    setBindError(null);
    setBindFeedback(null);
    try {
      const boundAccount = await bindBrowserAccountToGmail(account);
      onAccountUpdated(boundAccount);
      setBindFeedback(
        `Account bound to Gmail${
          boundAccount.boundEmail ? ` (${boundAccount.boundEmail})` : ''
        }`
      );
      setTimeout(() => setBindFeedback(null), 4000);
    } catch (err) {
      setBindError(
        err instanceof Error
          ? err.message
          : 'Could not bind account to Gmail. Please try again.'
      );
    } finally {
      setBindingGmail(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setChatError(null);
    const trimmed = messageText.trim();
    if (!trimmed) return;

    setSendingMessage(true);
    try {
      const participantUids = roomMembers.map((m) => m.userUid);
      const roomOwnerUid =
        activeRoom?.ownerUid ||
        account.ownerUid ||
        `browser_${account.usernameId}`;
      await sendRoomMessage({
        roomCode: activeRoomCode,
        roomOwnerUid,
        account,
        text: trimmed,
        knownParticipantUids: participantUids,
      });
      setMessageText('');
    } catch (err) {
      setChatError(
        err instanceof Error ? err.message : 'Failed to send message.'
      );
    } finally {
      setSendingMessage(false);
    }
  };

  const formatTime = (ms: number): string => {
    const date = new Date(ms);
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const isOwnPersonalRoom = activeRoomCode === account.roomCode;

  return (
    <div
      className={
        chatOnlyMode
          ? 'min-h-screen bg-[#000000] text-[#d1d0c5] flex flex-col font-chococooky'
          : 'min-h-screen bg-[#323437] text-[#d1d0c5] flex flex-col'
      }
    >
      {/* Top Bar Contract: Brand (left) — Nav Links (center) — "Join other room?" & Logout (top-right) */}
      {!chatOnlyMode && (
        <header className="w-full bg-[#2c2e31] border-b border-[#444444] px-6 py-3.5">
          <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-4">
            {/* Zone 1: Single text element wordmark */}
            <a
              href="#dashboard"
              onClick={(e) => {
                e.preventDefault();
                handleSwitchToPersonalRoom();
              }}
              className="text-xl font-bold tracking-tight text-[#e2b714] whitespace-nowrap shrink-0"
            >
              MonkeyChat
            </a>

            {/* Zone 2: Clean text navigation links */}
            <nav className="hidden xl:flex items-center gap-6 text-sm font-medium text-[#646669]">
              <button
                type="button"
                onClick={handleSwitchToPersonalRoom}
                className={`transition-colors duration-150 whitespace-nowrap cursor-pointer hover:text-[#d1d0c5] ${
                  isOwnPersonalRoom
                    ? 'text-[#e2b714] underline underline-offset-8'
                    : ''
                }`}
              >
                Personal Room ({account.roomCode})
              </button>
              <button
                type="button"
                onClick={() => setShowGenderPrompt((prev) => !prev)}
                className="transition-colors duration-150 whitespace-nowrap cursor-pointer hover:text-[#d1d0c5]"
              >
                Random Identity
              </button>
              <button
                type="button"
                onClick={handleCopyRoomCode}
                className="transition-colors duration-150 whitespace-nowrap cursor-pointer hover:text-[#d1d0c5]"
              >
                Copy My Code
              </button>
              <span className="text-xs font-mono text-[#646669] whitespace-nowrap">
                Active: #{activeRoomCode}
              </span>
            </nav>

            {/* Zone 3: Top-right corner "Join other room?" section + Logout button */}
            <div className="flex flex-wrap items-center gap-3">
              <form
                onSubmit={handleJoinOtherRoom}
                className="flex items-center gap-2 bg-[#323437] border border-[#444444] rounded-md px-3 py-1.5"
              >
                <label
                  htmlFor="join-other-room-input"
                  className="text-xs font-medium text-[#646669] whitespace-nowrap"
                >
                  Join other room?
                </label>
                <input
                  id="join-other-room-input"
                  type="text"
                  value={joinCodeInput}
                  onChange={(e) => {
                    setJoinCodeInput(e.target.value);
                    if (joinRoomError) setJoinRoomError(null);
                  }}
                  placeholder="Enter room code..."
                  maxLength={32}
                  className="w-36 sm:w-40 px-2 py-1 text-xs font-mono bg-[#2c2e31] border border-[#444444] rounded text-[#d1d0c5] placeholder-[#646669] focus:outline-none focus:border-[#e2b714]"
                />
                <button
                  type="submit"
                  disabled={joiningRoom}
                  className="px-3 py-1 text-xs font-semibold bg-[#e2b714] text-[#323437] rounded hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  {joiningRoom ? 'Joining...' : 'Join'}
                </button>
              </form>

              <button
                type="button"
                onClick={() => setShowLogoutModal(true)}
                className="px-3.5 py-2 text-xs font-semibold bg-[#323437] text-[#d1d0c5] border border-[#444444] rounded-md hover:border-[#e2b714] hover:text-[#e2b714] transition-colors duration-150 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Logout</span>
              </button>
            </div>
          </div>

          {/* Join Room Error Prompt */}
          {joinRoomError && (
            <div className="max-w-[1440px] mx-auto mt-2.5 flex items-center justify-end">
              <div
                role="alert"
                className="px-3.5 py-2 rounded-md bg-[#323437] border border-[#e2b714] text-xs text-[#e2b714] flex items-center gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-medium">{joinRoomError}</span>
                <button
                  type="button"
                  onClick={() => setJoinRoomError(null)}
                  className="ml-2 text-[#646669] hover:text-[#d1d0c5] cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </header>
      )}

      {/* Main Workspace Grid (1440px Desktop Presence or Chat-Only View) */}
      <main
        className={
          chatOnlyMode
            ? 'flex-1 w-full h-screen p-0 m-0 flex flex-col'
            : 'flex-1 w-full max-w-[1440px] mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch'
        }
      >
        {/* Left Sidebar: Personal Profile, Random Identity Generator, Gmail Binding, Room Code & Participants (4 cols) */}
        {!chatOnlyMode && (
          <aside className="lg:col-span-4 flex flex-col gap-6">
          {/* 1. Personal Profile & Random Identity Card */}
          <section className="bg-[#2c2e31] border border-[#444444] rounded-lg p-5 space-y-5">
            <div className="flex items-center justify-between border-b border-[#444444] pb-3.5">
              <div>
                <h2 className="text-sm font-semibold text-[#d1d0c5]">
                  Personal Profile
                </h2>
                <p className="text-xs text-[#646669]">
                  @{account.username} · Auto-generated Japanese Persona
                </p>
              </div>
              <Sparkles className="w-4 h-4 text-[#e2b714] shrink-0" />
            </div>

            {/* Current Identity Display (Read-Only: Users cannot manually type display name or upload avatar) */}
            <div className="flex items-center gap-4">
              <AvatarDisplay
                avatarId={account.avatarId}
                displayName={account.displayName}
                size="xl"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs text-[#646669]">
                  Generated Japanese Name (Read-only)
                </p>
                <p
                  className="text-base font-bold text-[#d1d0c5] truncate"
                  title={account.displayName}
                >
                  {account.displayName}
                </p>
                <p className="text-xs font-mono text-[#646669]">
                  Gender: {account.gender} · Avatar: {account.avatarId}
                </p>
              </div>
            </div>

            {/* "Generate Random Identity" Button & Gender Prompt */}
            <div className="space-y-3 pt-1">
              <button
                type="button"
                onClick={() => setShowGenderPrompt((prev) => !prev)}
                disabled={generatingIdentity}
                className="w-full py-2.5 px-4 text-xs font-semibold bg-[#e2b714] text-[#323437] rounded-md hover:opacity-90 transition-opacity duration-150 flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${
                    generatingIdentity ? 'animate-spin' : ''
                  }`}
                />
                <span>Generate Random Identity</span>
              </button>

              {showGenderPrompt && (
                <div className="p-3.5 rounded-md bg-[#323437] border border-[#444444] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#d1d0c5]">
                      Choose gender for your random Japanese identity:
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowGenderPrompt(false)}
                      className="text-xs text-[#646669] hover:text-[#d1d0c5] cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {(['male', 'female', 'neutral'] as IdentityGender[]).map(
                      (g) => (
                        <button
                          key={g}
                          type="button"
                          disabled={generatingIdentity}
                          onClick={() => handleGenerateRandomIdentity(g)}
                          className={`py-2 px-3 text-xs font-semibold rounded border transition-colors duration-150 capitalize whitespace-nowrap cursor-pointer ${
                            selectedGender === g
                              ? 'bg-[#e2b714] text-[#323437] border-[#e2b714]'
                              : 'bg-[#2c2e31] text-[#d1d0c5] border-[#444444] hover:border-[#e2b714]'
                          }`}
                        >
                          {g}
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}

              {identityFeedback && (
                <p className="text-xs text-[#e2b714] font-mono">
                  {identityFeedback}
                </p>
              )}
            </div>

            {/* Account Storage Mode & Option to Bind Account to Gmail */}
            <div className="pt-4 border-t border-[#444444] space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#d1d0c5] flex items-center gap-1.5">
                  {account.storageMode === 'gmail' ? (
                    <Cloud className="w-3.5 h-3.5 text-[#e2b714]" />
                  ) : (
                    <HardDrive className="w-3.5 h-3.5 text-[#e2b714]" />
                  )}
                  <span>Account Storage</span>
                </span>
                <span className="font-mono text-[#646669] truncate max-w-[180px]">
                  {account.storageMode === 'gmail'
                    ? `Gmail Bound${
                        account.boundEmail ? ` · ${account.boundEmail}` : ''
                      }`
                    : 'Browser Storage (No Email)'}
                </span>
              </div>

              {account.storageMode === 'browser' && (
                <button
                  type="button"
                  disabled={bindingGmail}
                  onClick={handleBindToGmail}
                  className="w-full py-2 px-3 text-xs font-semibold bg-[#323437] text-[#d1d0c5] border border-[#e2b714] rounded-md hover:bg-[#e2b714] hover:text-[#323437] transition-colors duration-150 flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>
                    {bindingGmail
                      ? 'Binding to Gmail...'
                      : 'Bind Account to Gmail'}
                  </span>
                </button>
              )}

              {bindFeedback && (
                <p className="text-xs text-[#e2b714] font-mono">
                  {bindFeedback}
                </p>
              )}
              {bindError && (
                <p className="text-xs text-[#e2b714] font-mono">{bindError}</p>
              )}
            </div>

            {/* Permanent Personal Chat Room Code & One-Click Copy/Share */}
            <div className="pt-4 border-t border-[#444444] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#d1d0c5]">
                  Your Permanent Chat Room Code
                </span>
                <span className="text-xs font-mono text-[#646669]">
                  1 Room / User
                </span>
              </div>

              <div className="flex items-center justify-between px-3.5 py-2.5 rounded-md bg-[#323437] border border-[#444444]">
                <span className="text-base font-mono font-bold tracking-wider text-[#e2b714]">
                  {account.roomCode}
                </span>
                <button
                  type="button"
                  onClick={handleCopyRoomCode}
                  className="px-3 py-1 text-xs font-semibold bg-[#2c2e31] text-[#d1d0c5] border border-[#444444] rounded hover:border-[#e2b714] hover:text-[#e2b714] transition-colors duration-150 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  {copiedCode ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#e2b714]" />
                      <span className="text-[#e2b714]">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Click to Copy / Share</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleCopyShareLink}
                  className="flex-1 py-2 px-3 text-xs font-medium bg-[#323437] text-[#d1d0c5] border border-[#444444] rounded-md hover:border-[#e2b714] transition-colors duration-150 flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5 text-[#e2b714]" />
                  <span>
                    {copiedLink ? 'Share Link Copied!' : 'Copy Share Link'}
                  </span>
                </button>

                {!isOwnPersonalRoom && (
                  <button
                    type="button"
                    onClick={handleSwitchToPersonalRoom}
                    className="py-2 px-3 text-xs font-semibold bg-[#e2b714] text-[#323437] rounded-md hover:opacity-90 transition-opacity duration-150 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                  >
                    <Home className="w-3.5 h-3.5" />
                    <span>My Room</span>
                  </button>
                )}
              </div>

              {/* Room Owner Lock / Unlock Action on sidebar card */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setLockError(null);
                    setLockSuccessMsg(null);
                    setLockPasswordInput('');
                    setLockPasswordConfirm('');
                    setShowLockModal(true);
                  }}
                  className="w-full py-2 px-3 text-xs font-semibold bg-[#323437] text-[#d1d0c5] border border-[#444444] rounded-md hover:border-[#e2b714] hover:text-[#e2b714] transition-colors duration-150 flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
                >
                  {activeRoom?.isLocked && isOwnPersonalRoom ? (
                    <>
                      <Lock className="w-3.5 h-3.5 text-[#e2b714]" />
                      <span>Room Password Protected (Click to edit)</span>
                    </>
                  ) : (
                    <>
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Lock Personal Room with Password</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>

          {/* 2. Connected Room Participants List */}
          <section className="bg-[#2c2e31] border border-[#444444] rounded-lg p-5 flex-1 flex flex-col">
            <div className="flex items-center justify-between border-b border-[#444444] pb-3.5 mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-[#e2b714]" />
                <h2 className="text-sm font-semibold text-[#d1d0c5]">
                  Room Session Members
                </h2>
              </div>
              <span className="text-xs font-mono text-[#646669]">
                {roomMembers.length}{' '}
                {roomMembers.length === 1 ? 'member' : 'members'}
              </span>
            </div>

            <div className="space-y-3 overflow-y-auto max-h-[260px] pr-1">
              {roomMembers.length === 0 ? (
                <p className="text-xs text-[#646669] py-4 text-center">
                  Syncing room participants...
                </p>
              ) : (
                roomMembers.map((member) => {
                  const isMe = member.memberId === account.usernameId;
                  const isRoomOwner =
                    activeRoom && member.memberId === activeRoom.ownerUsername;
                  return (
                    <div
                      key={member.memberId}
                      className="flex items-center gap-3 p-2.5 rounded-md bg-[#323437] border border-[#444444]"
                    >
                      <AvatarDisplay
                        avatarId={member.avatarId}
                        displayName={member.displayName}
                        size="sm"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-[#d1d0c5] truncate">
                          {member.displayName}
                        </p>
                        <p className="text-[11px] font-mono text-[#646669] truncate">
                          @{member.username}
                          {isRoomOwner ? ' · Room Owner' : ''}
                          {isMe ? ' · You' : ''}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </aside>
        )}

        {/* Right Main Column: Real-Time Chat Room Stream (8 cols or Fullscreen) */}
        <section
          style={{
            fontFamily:
              "'Choco cooky', 'chococooky font', 'Choco Cooky', 'Chococooky', cursive, sans-serif",
          }}
          className={
            chatOnlyMode
              ? 'w-full h-full min-h-screen bg-[#000000] text-[#d1d0c5] flex flex-col justify-between font-chococooky relative overflow-hidden'
              : 'lg:col-span-8 bg-[#000000] text-[#d1d0c5] border border-[#222222] rounded-lg flex flex-col justify-between h-[calc(100vh-140px)] min-h-[560px] font-chococooky relative overflow-hidden'
          }
        >
          {/* Top-Right Toggle Button when in Chat-Only Mode */}
          {chatOnlyMode && (
            <button
              type="button"
              onClick={() => setChatOnlyMode(false)}
              className="absolute top-4 right-4 z-20 p-2 text-[#d1d0c5] hover:text-[#ffffff] transition-colors cursor-pointer"
              title="Exit Chat Only view (Alt + H)"
              aria-label="Exit Chat Only view"
            >
              <Minimize2 className="w-5 h-5 text-[#d1d0c5]" />
            </button>
          )}

          {/* Active Chat Room Header - Hidden when Chat Only view is triggered */}
          {!chatOnlyMode && (
            <div className="px-6 py-4 border-b border-[#222222] flex flex-wrap items-center justify-between gap-3 bg-[#000000] text-[#d1d0c5] shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded flex items-center justify-center text-[#888888]">
                  <Hash className="w-5 h-5 text-[#888888]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-base font-bold text-[#f2efde] tracking-wide">
                      {activeRoomCode}
                    </h1>
                    <span className="text-xs text-[#555555]">·</span>
                    <span className="text-xs text-[#a0a0a0] font-medium">
                      {isOwnPersonalRoom
                        ? 'Your Personal Room'
                        : 'Joined Group Room'}
                    </span>
                    {activeRoom?.isLocked && (
                      <span className="flex items-center gap-1 text-[11px] text-[#a0a0a0] border border-[#333333] px-2 py-0.5 rounded">
                        <Lock className="w-3 h-3 text-[#a0a0a0]" />
                        <span>Password Protected</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#777777]">
                    {activeRoom
                      ? `Owned by ${activeRoom.ownerDisplayName} (@${activeRoom.ownerUsername})`
                      : 'Connecting to room session...'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!isOwnPersonalRoom && (
                  <button
                    type="button"
                    onClick={handleSwitchToPersonalRoom}
                    className="px-3 py-1 text-xs text-[#d1d0c5] border border-[#333333] rounded hover:border-[#666666] hover:bg-[#111111] transition-colors whitespace-nowrap cursor-pointer"
                  >
                    Return to My Room
                  </button>
                )}

                {/* 1. TOP-RIGHT CHAT TOGGLE BUTTON (and Alt + H shortcut) */}
                <button
                  type="button"
                  onClick={() => setChatOnlyMode(true)}
                  className="p-1.5 rounded text-[#d1d0c5] hover:text-[#ffffff] hover:bg-[#111111] transition-colors cursor-pointer"
                  title="Chat Only view (Alt + H)"
                  aria-label="Enter Chat Only view"
                >
                  <Maximize2 className="w-5 h-5 text-[#d1d0c5]" />
                </button>
              </div>
            </div>
          )}

          {/* Chat Message Stream - pure black background, light gray text, anchored flex-1 */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 bg-[#000000] space-y-4 font-chococooky text-[#d1d0c5] flex flex-col">
            {messages.length === 0 ? (
              <div className="flex-1 flex items-end pb-2">
                <p className="text-xs text-[#555555] font-chococooky">
                  No messages yet in #{activeRoomCode}. Type below to start chatting...
                </p>
              </div>
            ) : (
              messages.map((msg) => {
                const isSender = msg.senderUsername === account.usernameId;
                return (
                  <div
                    key={msg.messageId}
                    className="flex items-start gap-3 justify-start text-left"
                  >
                    <div className="w-8 h-8 rounded-full border border-[#333333] overflow-hidden grayscale contrast-125 bg-[#111111] shrink-0 flex items-center justify-center text-[#d1d0c5]">
                      <AvatarDisplay
                        avatarId={msg.senderAvatarId}
                        displayName={msg.senderDisplayName}
                        size="sm"
                      />
                    </div>

                    {/* Left aligned, light gray text on pure black background */}
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-bold text-[#f2efde]">
                          {msg.senderDisplayName}
                        </span>
                        <span className="text-[#777777] text-[11px]">
                          @{msg.senderUsername}
                        </span>
                        {isSender && (
                          <span className="text-[#e2b714] font-bold text-[11px]">
                            (You)
                          </span>
                        )}
                        <span className="text-[#666666] text-[11px]">
                          {formatTime(msg.createdAtMs)}
                        </span>
                      </div>

                      <p className="text-sm text-[#d1d0c5] leading-relaxed whitespace-pre-wrap break-words font-chococooky">
                        {msg.text}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Composer Footer - at the bottom, pure black background, light gray text */}
          <div className="p-4 bg-[#000000] mt-auto shrink-0 font-chococooky border-t border-[#1a1a1a]">
            {chatError && (
              <p className="text-xs text-[#e2b714] mb-2 font-mono">
                {chatError}
              </p>
            )}
            <form
              onSubmit={handleSendMessage}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                maxLength={1000}
                placeholder="Type here. . . "
                className="flex-1 bg-transparent px-2 py-2 text-sm text-[#d1d0c5] placeholder-[#666666] placeholder:text-[#666666] border-none outline-none focus:outline-none focus:ring-0 transition-colors font-chococooky"
              />
              <button
                type="submit"
                disabled={sendingMessage || !messageText.trim()}
                aria-label="Send message"
                className="p-2 text-[#d1d0c5] hover:text-[#ffffff] disabled:opacity-30 transition-opacity cursor-pointer flex items-center justify-center shrink-0"
              >
                <Send className="w-5 h-5 text-[#d1d0c5]" />
              </button>
            </form>
          </div>
        </section>
      </main>

      {/* Room Owner Lock Modal */}
      {showLockModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="lock-modal-title"
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 font-chococooky"
        >
          <div className="w-full max-w-md bg-[#2c2e31] border border-[#444444] rounded-lg p-6 space-y-4 text-[#d1d0c5]">
            <div className="flex items-center justify-between border-b border-[#444444] pb-3">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#e2b714]" />
                <h3
                  id="lock-modal-title"
                  className="text-base font-bold text-[#d1d0c5]"
                >
                  Room Password Lock
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowLockModal(false);
                  setLockError(null);
                  setLockSuccessMsg(null);
                }}
                className="text-xs text-[#646669] hover:text-[#d1d0c5] cursor-pointer"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-[#646669] leading-relaxed">
              Lock your personal chat room (
              <span className="font-mono text-[#e2b714]">
                {account.roomCode}
              </span>
              ) with a password. Non-owners will be required to enter this
              password before joining.
            </p>

            {activeRoom?.isLocked && (
              <div className="p-3 rounded bg-[#323437] border border-[#444444] flex items-center justify-between">
                <span className="text-xs text-[#e2b714] font-medium flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Currently Password Protected</span>
                </span>
                <button
                  type="button"
                  disabled={savingLock}
                  onClick={handleUnlockRoom}
                  className="px-3 py-1 text-xs font-semibold bg-[#2c2e31] text-[#d1d0c5] border border-[#444444] rounded hover:border-[#e2b714] hover:text-[#e2b714] transition-colors cursor-pointer"
                >
                  {savingLock ? 'Unlocking...' : 'Remove Lock'}
                </button>
              </div>
            )}

            <form onSubmit={handleSaveRoomLock} className="space-y-3">
              <div className="space-y-1">
                <label
                  htmlFor="lock-password-input"
                  className="text-xs text-[#d1d0c5]"
                >
                  {activeRoom?.isLocked
                    ? 'Change Password'
                    : 'Set Room Password'}
                </label>
                <input
                  id="lock-password-input"
                  type="password"
                  value={lockPasswordInput}
                  onChange={(e) => setLockPasswordInput(e.target.value)}
                  placeholder="Enter a secure password..."
                  className="w-full px-3 py-2 text-xs bg-[#323437] border border-[#444444] rounded text-[#d1d0c5] placeholder-[#646669] focus:outline-none focus:border-[#e2b714]"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="lock-password-confirm"
                  className="text-xs text-[#d1d0c5]"
                >
                  Confirm Password
                </label>
                <input
                  id="lock-password-confirm"
                  type="password"
                  value={lockPasswordConfirm}
                  onChange={(e) => setLockPasswordConfirm(e.target.value)}
                  placeholder="Repeat room password..."
                  className="w-full px-3 py-2 text-xs bg-[#323437] border border-[#444444] rounded text-[#d1d0c5] placeholder-[#646669] focus:outline-none focus:border-[#e2b714]"
                />
              </div>

              {lockError && (
                <p className="text-xs text-[#e2b714] font-mono">{lockError}</p>
              )}
              {lockSuccessMsg && (
                <p className="text-xs text-[#e2b714] font-mono">
                  {lockSuccessMsg}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowLockModal(false);
                    setLockError(null);
                    setLockSuccessMsg(null);
                  }}
                  className="px-3.5 py-1.5 text-xs bg-[#323437] text-[#d1d0c5] border border-[#444444] rounded hover:border-[#d1d0c5] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingLock || !lockPasswordInput.trim()}
                  className="px-4 py-1.5 text-xs font-semibold bg-[#e2b714] text-[#323437] rounded hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
                >
                  {savingLock ? 'Saving...' : 'Save Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password Prompt Modal for Non-Owner joining locked room */}
      {showPasswordPromptModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="password-prompt-title"
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 font-chococooky"
        >
          <div className="w-full max-w-sm bg-[#2c2e31] border border-[#444444] rounded-lg p-6 space-y-4 text-[#d1d0c5]">
            <div className="flex items-center gap-2 border-b border-[#444444] pb-3">
              <Lock className="w-4 h-4 text-[#e2b714]" />
              <h3
                id="password-prompt-title"
                className="text-base font-bold text-[#d1d0c5]"
              >
                Room Password Required
              </h3>
            </div>

            <p className="text-xs text-[#646669] leading-relaxed">
              Room{' '}
              <span className="font-mono text-[#e2b714]">
                #{pendingJoinRoomCode}
              </span>{' '}
              is password protected by its owner. Please enter the password to
              gain entry.
            </p>

            <form onSubmit={handleUnlockAndJoin} className="space-y-3">
              <input
                type="password"
                autoFocus
                value={roomPasswordInput}
                onChange={(e) => {
                  setRoomPasswordInput(e.target.value);
                  if (passwordPromptError) setPasswordPromptError(null);
                }}
                placeholder="Enter room password..."
                className="w-full px-3 py-2 text-xs bg-[#323437] border border-[#444444] rounded text-[#d1d0c5] placeholder-[#646669] focus:outline-none focus:border-[#e2b714]"
              />

              {passwordPromptError && (
                <p className="text-xs text-[#e2b714] font-mono">
                  {passwordPromptError}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowPasswordPromptModal(false);
                    setRoomPasswordInput('');
                    setPasswordPromptError(null);
                  }}
                  className="px-3.5 py-1.5 text-xs bg-[#323437] text-[#d1d0c5] border border-[#444444] rounded hover:border-[#d1d0c5] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={verifyingPassword || !roomPasswordInput.trim()}
                  className="px-4 py-1.5 text-xs font-semibold bg-[#e2b714] text-[#323437] rounded hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer"
                >
                  {verifyingPassword ? 'Verifying...' : 'Unlock & Join'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Logout Confirmation Modal ("Are you sure you want to log out?" with Confirm/Cancel actions) */}
      {showLogoutModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="logout-modal-title"
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-sm bg-[#2c2e31] border border-[#444444] rounded-lg p-6 space-y-5">
            <div className="space-y-2">
              <h3
                id="logout-modal-title"
                className="text-base font-bold text-[#d1d0c5]"
              >
                Are you sure you want to log out?
              </h3>
              <p className="text-xs text-[#646669] leading-relaxed">
                Your permanent chat room ({account.roomCode}) and generated
                Japanese identity ({account.displayName}) will remain saved in{' '}
                {account.storageMode === 'gmail'
                  ? 'Gmail cloud storage'
                  : 'browser storage'}
                .
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowLogoutModal(false)}
                className="px-4 py-2 text-xs font-semibold bg-[#323437] text-[#d1d0c5] border border-[#444444] rounded-md hover:border-[#d1d0c5] transition-colors whitespace-nowrap cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLogoutModal(false);
                  onConfirmLogout();
                }}
                className="px-4 py-2 text-xs font-semibold bg-[#e2b714] text-[#323437] rounded-md hover:opacity-90 transition-opacity whitespace-nowrap cursor-pointer"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
