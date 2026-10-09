import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  ensureVerifiedFirebaseUser,
  handleFirestoreError,
  OperationType,
} from '../firebase';
import {
  generateRandomJapaneseIdentity,
  IdentityGender,
} from '../data/japaneseIdentities';
import {
  generateMessageId,
  generateUniqueRoomCode,
  hashPassword,
  hashSecurityAnswer,
  normalizeRoomCode,
  normalizeUsernameId,
  validateRoomCodeFormat,
  validateUsername,
} from '../utils/security';

export type AccountStorageMode = 'browser' | 'gmail';

export interface MonkeyChatAccount {
  usernameId: string;
  username: string;
  displayName: string;
  gender: IdentityGender;
  avatarId: string;
  securityQuestion: string;
  roomCode: string;
  ownerUid: string;
  storageMode: AccountStorageMode;
  boundEmail?: string;
}

export interface RoomRecord {
  roomCode: string;
  ownerUid: string;
  ownerUsername: string;
  ownerDisplayName: string;
  ownerAvatarId: string;
  status: 'active' | 'archived';
  isLocked?: boolean;
  passwordHash?: string;
}

export interface RoomMemberRecord {
  memberId: string;
  roomCode: string;
  userUid: string;
  username: string;
  displayName: string;
  gender: IdentityGender;
  avatarId: string;
  memberUids: string[];
  joinedAtMs: number;
}

export interface ChatMessageRecord {
  messageId: string;
  roomCode: string;
  senderUid: string;
  senderUsername: string;
  senderDisplayName: string;
  senderAvatarId: string;
  text: string;
  memberUids: string[];
  createdAtMs: number;
}

interface StoredBrowserAccount extends MonkeyChatAccount {
  passwordHash: string;
  securityAnswerHash: string;
  createdAtMs: number;
  updatedAtMs: number;
}

const LOCAL_ACCOUNTS_KEY = 'monkeychat_browser_accounts_v1';
const LOCAL_ROOMS_KEY = 'monkeychat_browser_rooms_v1';
const LOCAL_MEMBERS_KEY = 'monkeychat_browser_members_v1';
const LOCAL_MESSAGES_KEY = 'monkeychat_browser_messages_v1';
const BROADCAST_CHANNEL_NAME = 'monkeychat_realtime_sync_v1';

// In-memory caches synced from Express Server & Firestore so multi-tab and cross-instance state never drops
const memoryRoomsCache: Record<string, RoomRecord> = {};
const memoryMembersCache: Record<string, Record<string, RoomMemberRecord>> = {};
const memoryMessagesCache: Record<string, Record<string, ChatMessageRecord>> =
  {};

type RealtimeBusEvent = {
  type:
    | 'ROOMS_UPDATED'
    | 'MEMBERS_UPDATED'
    | 'MESSAGES_UPDATED'
    | 'ACCOUNTS_UPDATED';
  roomCode?: string;
};

let broadcastChannel: BroadcastChannel | null = null;
const localListeners = new Set<(ev: RealtimeBusEvent) => void>();

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || !('BroadcastChannel' in window)) {
    return null;
  }
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    broadcastChannel.onmessage = (event: MessageEvent<RealtimeBusEvent>) => {
      localListeners.forEach((listener) => listener(event.data));
    };
  }
  return broadcastChannel;
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (
      e.key === LOCAL_ROOMS_KEY ||
      e.key === LOCAL_MEMBERS_KEY ||
      e.key === LOCAL_MESSAGES_KEY ||
      e.key === LOCAL_ACCOUNTS_KEY
    ) {
      localListeners.forEach((listener) =>
        listener({ type: 'MESSAGES_UPDATED' })
      );
    }
  });
}

function emitLocalBus(event: RealtimeBusEvent) {
  localListeners.forEach((listener) => listener(event));
  try {
    getBroadcastChannel()?.postMessage(event);
  } catch {
    // Ignore broadcast errors
  }
}

function subscribeLocalBus(
  listener: (ev: RealtimeBusEvent) => void
): () => void {
  getBroadcastChannel();
  localListeners.add(listener);
  return () => {
    localListeners.delete(listener);
  };
}

function readJsonMap<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function writeJsonMap<T>(key: string, data: Record<string, T>): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Ignore quota errors
  }
}

function getLocalAccounts(): Record<string, StoredBrowserAccount> {
  return readJsonMap<StoredBrowserAccount>(LOCAL_ACCOUNTS_KEY);
}

function saveLocalAccount(account: StoredBrowserAccount): void {
  const all = getLocalAccounts();
  all[account.usernameId] = account;
  writeJsonMap(LOCAL_ACCOUNTS_KEY, all);
  emitLocalBus({ type: 'ACCOUNTS_UPDATED' });
}

function getLocalRooms(): Record<string, RoomRecord> {
  const stored = readJsonMap<RoomRecord>(LOCAL_ROOMS_KEY);
  return { ...memoryRoomsCache, ...stored };
}

function saveLocalRoom(room: RoomRecord): void {
  const code = room.roomCode.trim().toUpperCase();
  const normalized: RoomRecord = { ...room, roomCode: code };
  memoryRoomsCache[code] = normalized;
  const all = readJsonMap<RoomRecord>(LOCAL_ROOMS_KEY);
  all[code] = normalized;
  writeJsonMap(LOCAL_ROOMS_KEY, all);
  emitLocalBus({ type: 'ROOMS_UPDATED', roomCode: code });
}

function getLocalMembersByRoom(): Record<
  string,
  Record<string, RoomMemberRecord>
> {
  const stored = readJsonMap<Record<string, RoomMemberRecord>>(
    LOCAL_MEMBERS_KEY
  );
  const merged: Record<string, Record<string, RoomMemberRecord>> = {};
  for (const [rCode, map] of Object.entries(memoryMembersCache)) {
    merged[rCode] = { ...map };
  }
  for (const [rCode, map] of Object.entries(stored)) {
    merged[rCode] = { ...(merged[rCode] || {}), ...map };
  }
  return merged;
}

function saveLocalMember(member: RoomMemberRecord): void {
  const code = member.roomCode.trim().toUpperCase();
  const normalized: RoomMemberRecord = { ...member, roomCode: code };
  if (!memoryMembersCache[code]) {
    memoryMembersCache[code] = {};
  }
  memoryMembersCache[code][member.memberId] = normalized;

  const all = readJsonMap<Record<string, RoomMemberRecord>>(LOCAL_MEMBERS_KEY);
  if (!all[code]) {
    all[code] = {};
  }
  all[code][member.memberId] = normalized;
  writeJsonMap(LOCAL_MEMBERS_KEY, all);
  emitLocalBus({ type: 'MEMBERS_UPDATED', roomCode: code });
}

function getLocalMessagesByRoom(): Record<string, ChatMessageRecord[]> {
  const stored = readJsonMap<ChatMessageRecord[]>(LOCAL_MESSAGES_KEY);
  const merged: Record<string, ChatMessageRecord[]> = {};
  const allRoomCodes = new Set([
    ...Object.keys(memoryMessagesCache),
    ...Object.keys(stored),
  ]);

  for (const rCode of allRoomCodes) {
    const byId = new Map<string, ChatMessageRecord>();
    const memMap = memoryMessagesCache[rCode] || {};
    for (const msg of Object.values(memMap)) {
      byId.set(msg.messageId, msg);
    }
    const storedList = stored[rCode] || [];
    if (Array.isArray(storedList)) {
      for (const msg of storedList) {
        if (msg && msg.messageId) {
          byId.set(msg.messageId, msg);
        }
      }
    }
    const list = Array.from(byId.values());
    list.sort((a, b) => a.createdAtMs - b.createdAtMs);
    merged[rCode] = list;
  }
  return merged;
}

function saveLocalMessage(message: ChatMessageRecord): void {
  const code = message.roomCode.trim().toUpperCase();
  const normalized: ChatMessageRecord = { ...message, roomCode: code };
  if (!memoryMessagesCache[code]) {
    memoryMessagesCache[code] = {};
  }
  memoryMessagesCache[code][normalized.messageId] = normalized;

  const all = readJsonMap<ChatMessageRecord[]>(LOCAL_MESSAGES_KEY);
  const list = Array.isArray(all[code]) ? [...all[code]] : [];
  if (!list.some((m) => m.messageId === normalized.messageId)) {
    list.push(normalized);
    list.sort((a, b) => a.createdAtMs - b.createdAtMs);
    all[code] = list;
    writeJsonMap(LOCAL_MESSAGES_KEY, all);
  }
  // Always emit on the local bus so active React subscribers update even if another tab already wrote to localStorage
  emitLocalBus({ type: 'MESSAGES_UPDATED', roomCode: code });
}

function timestampToMs(val: unknown): number {
  if (val instanceof Timestamp) {
    return val.toMillis();
  }
  if (
    val &&
    typeof val === 'object' &&
    'seconds' in val &&
    typeof (val as { seconds: number }).seconds === 'number'
  ) {
    return (val as { seconds: number }).seconds * 1000;
  }
  return Date.now();
}

function extractMessageCreatedAtMs(
  messageId: string,
  createdAtField: unknown
): number {
  const match = /^msg_(\d{10,15})_/.exec(messageId);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return timestampToMs(createdAtField);
}

/**
 * Ensures a specific room and any locally stored members/messages for that room
 * are pushed to Cloud Firestore so all participants (whether Browser Storage or Gmail,
 * and whether on ais-dev or ais-pre) see each other's messages in real time.
 */
export async function syncRoomStateToCloud(roomCode: string): Promise<void> {
  const code = normalizeRoomCode(roomCode);
  if (!validateRoomCodeFormat(code)) return;

  try {
    // 1. Ensure room document exists in Cloud Firestore
    const roomRef = doc(db, 'rooms', code);
    const roomSnap = await getDoc(roomRef);
    const localRoom = getLocalRooms()[code];

    if (!roomSnap.exists() && localRoom) {
      const ownerUid =
        localRoom.ownerUid || `browser_${localRoom.ownerUsername}`;
      await setDoc(roomRef, {
        roomCode: code,
        ownerUid,
        ownerUsername: localRoom.ownerUsername,
        ownerDisplayName: localRoom.ownerDisplayName.slice(0, 80),
        ownerAvatarId: localRoom.ownerAvatarId,
        status: localRoom.status || 'active',
        isLocked: !!localRoom.isLocked,
        passwordHash: localRoom.passwordHash || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (roomSnap.exists()) {
      const rData = roomSnap.data();
      saveLocalRoom({
        roomCode: code,
        ownerUid: rData.ownerUid,
        ownerUsername: rData.ownerUsername,
        ownerDisplayName: rData.ownerDisplayName,
        ownerAvatarId: rData.ownerAvatarId,
        status: rData.status || 'active',
        isLocked: !!rData.isLocked,
        passwordHash: rData.passwordHash || '',
      });
    }

    // 2. Push any local members for this room that aren't in Firestore yet
    const localMembers = Object.values(getLocalMembersByRoom()[code] || {});
    for (const m of localMembers) {
      try {
        const memberRef = doc(db, 'rooms', code, 'members', m.memberId);
        const memberSnap = await getDoc(memberRef);
        if (!memberSnap.exists()) {
          const userUid = m.userUid || `browser_${m.memberId}`;
          const memberUids = Array.from(
            new Set([
              userUid,
              ...(Array.isArray(m.memberUids) ? m.memberUids : []),
            ])
          )
            .filter(
              (u) => typeof u === 'string' && u.length > 0 && u.length <= 128
            )
            .slice(0, 10);

          await setDoc(memberRef, {
            memberId: m.memberId,
            roomCode: code,
            userUid,
            username: m.username.slice(0, 32),
            displayName: m.displayName.slice(0, 80),
            gender: m.gender,
            avatarId: m.avatarId,
            memberUids: memberUids.length > 0 ? memberUids : [userUid],
            joinedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch {
        // Ignore individual member sync issue
      }
    }

    // 3. Push any local messages for this room (e.g. messages sent while in browser mode) that aren't in Firestore yet
    const localMsgs = getLocalMessagesByRoom()[code] || [];
    for (const msg of localMsgs) {
      try {
        const msgRef = doc(db, 'rooms', code, 'messages', msg.messageId);
        const msgSnap = await getDoc(msgRef);
        if (!msgSnap.exists()) {
          const senderUid = msg.senderUid || `browser_${msg.senderUsername}`;
          const memberUids = Array.from(
            new Set([
              senderUid,
              ...(Array.isArray(msg.memberUids) ? msg.memberUids : []),
            ])
          )
            .filter(
              (u) => typeof u === 'string' && u.length > 0 && u.length <= 128
            )
            .slice(0, 10);

          await setDoc(msgRef, {
            messageId: msg.messageId,
            roomCode: code,
            senderUid,
            senderUsername: msg.senderUsername.slice(0, 32),
            senderDisplayName: msg.senderDisplayName.slice(0, 80),
            senderAvatarId: msg.senderAvatarId,
            text: msg.text.slice(0, 1000),
            memberUids: memberUids.length > 0 ? memberUids : [senderUid],
            createdAt: serverTimestamp(),
          });
        }
      } catch {
        // Ignore individual message sync issue
      }
    }
  } catch {
    // Ignore cloud sync errors if offline
  }
}

/**
 * Pushes any existing browser localStorage state to the backend server AND Cloud Firestore
 * so pre-existing browser accounts, rooms, members, and messages are discoverable everywhere.
 */
export async function syncLocalStorageWithServer(): Promise<void> {
  const localRooms = getLocalRooms();
  const localAccounts = getLocalAccounts();

  // Sync local accounts & rooms to Cloud Firestore as well
  for (const acc of Object.values(localAccounts)) {
    if (acc && acc.usernameId && acc.roomCode) {
      const rCode = normalizeRoomCode(acc.roomCode);
      if (!localRooms[rCode]) {
        saveLocalRoom({
          roomCode: rCode,
          ownerUid: acc.ownerUid || `browser_${acc.usernameId}`,
          ownerUsername: acc.usernameId,
          ownerDisplayName: acc.displayName,
          ownerAvatarId: acc.avatarId,
          status: 'active',
        });
      }
    }
  }

  try {
    const payload = {
      accounts: getLocalAccounts(),
      rooms: getLocalRooms(),
      members: getLocalMembersByRoom(),
      messages: getLocalMessagesByRoom(),
    };
    const res = await fetch('/api/monkeychat/sync-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        rooms?: Record<string, RoomRecord>;
        members?: Record<string, Record<string, RoomMemberRecord>>;
        messages?: Record<string, ChatMessageRecord[]>;
      };
      if (data.rooms) {
        for (const room of Object.values(data.rooms)) {
          if (room && room.roomCode) {
            saveLocalRoom(room);
          }
        }
      }
      if (data.members) {
        for (const roomMembers of Object.values(data.members)) {
          if (roomMembers && typeof roomMembers === 'object') {
            for (const m of Object.values(roomMembers)) {
              if (m && m.memberId) {
                saveLocalMember(m);
              }
            }
          }
        }
      }
      if (data.messages) {
        for (const roomMsgs of Object.values(data.messages)) {
          if (Array.isArray(roomMsgs)) {
            for (const msg of roomMsgs) {
              if (msg && msg.messageId) {
                saveLocalMessage(msg);
              }
            }
          }
        }
      }
    }
  } catch {
    // Ignore network error if offline
  }

  // Also ensure all known local rooms and their messages are synced to Cloud Firestore
  for (const rCode of Object.keys(getLocalRooms())) {
    syncRoomStateToCloud(rCode);
  }
}

if (typeof window !== 'undefined') {
  syncLocalStorageWithServer();
}

/**
 * Ensures the active user's personal room and membership are registered in
 * localStorage, the backend Express server, AND Cloud Firestore (even for Browser Storage accounts).
 */
export async function ensureActiveAccountRoomRegistered(
  account: MonkeyChatAccount
): Promise<void> {
  const code = normalizeRoomCode(account.roomCode);
  const now = Date.now();
  const ownerUid = account.ownerUid || `browser_${account.usernameId}`;

  const roomRecord: RoomRecord = {
    roomCode: code,
    ownerUid,
    ownerUsername: account.usernameId,
    ownerDisplayName: account.displayName,
    ownerAvatarId: account.avatarId,
    status: 'active',
  };

  const memberRecord: RoomMemberRecord = {
    memberId: account.usernameId,
    roomCode: code,
    userUid: ownerUid,
    username: account.username,
    displayName: account.displayName,
    gender: account.gender,
    avatarId: account.avatarId,
    memberUids: [ownerUid],
    joinedAtMs: now,
  };

  saveLocalRoom(roomRecord);
  saveLocalMember(memberRecord);

  try {
    await fetch('/api/monkeychat/ensure-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: {
          ...account,
          roomCode: code,
          ownerUid,
        },
      }),
    });
  } catch {
    // Ignore if server unreachable
  }

  await syncRoomStateToCloud(code);
}

function isPermissionDeniedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  const msg = (err as { message?: string }).message || '';
  return (
    code === 'permission-denied' ||
    msg.includes('Missing or insufficient permissions')
  );
}

/**
 * Validates registration fields before presenting the storage mode choice modal.
 */
export function validateRegistrationInput(params: {
  username: string;
  password: string;
  confirmPassword: string;
  securityQuestion: string;
  securityAnswer: string;
}): string | null {
  const usernameError = validateUsername(params.username);
  if (usernameError) return usernameError;
  if (params.password.length < 4) {
    return 'Password must be at least 4 characters.';
  }
  if (params.password !== params.confirmPassword) {
    return 'Passwords do not match. Please confirm your password.';
  }
  if (params.securityQuestion.trim().length < 5) {
    return 'Please select a valid security question.';
  }
  if (params.securityAnswer.trim().length < 1) {
    return 'Please provide an answer to your security question.';
  }
  return null;
}

/**
 * Registers a new user account using either:
 * - 'browser': Browser-based storage (no email or Google login required, synced via localStorage, Express & Firestore)
 * - 'gmail': Bound to Gmail with Firebase Authentication & Firestore persistence
 */
export async function registerMonkeyChatUser(params: {
  username: string;
  password: string;
  securityQuestion: string;
  securityAnswer: string;
  initialGender: IdentityGender;
  storageMode: AccountStorageMode;
}): Promise<MonkeyChatAccount> {
  const usernameError = validateUsername(params.username);
  if (usernameError) {
    throw new Error(usernameError);
  }
  if (params.password.length < 4) {
    throw new Error('Password must be at least 4 characters.');
  }
  if (params.securityQuestion.trim().length < 5) {
    throw new Error('Please select a valid security question.');
  }
  if (params.securityAnswer.trim().length < 1) {
    throw new Error('Security answer is required.');
  }

  const usernameId = normalizeUsernameId(params.username);
  const cleanUsername = params.username.trim().slice(0, 32);
  const passwordHash = await hashPassword(params.password);
  const securityAnswerHash = await hashSecurityAnswer(params.securityAnswer);
  const safeQuestion = params.securityQuestion.trim().slice(0, 120);
  const identity = generateRandomJapaneseIdentity(params.initialGender);

  // Check local browser accounts first
  const localAccounts = getLocalAccounts();
  if (localAccounts[usernameId]) {
    throw new Error(
      'That username is already registered. Please sign in or choose another username.'
    );
  }

  // Also check Cloud Firestore to prevent duplicate usernames across browsers
  try {
    const existingCloudAcc = await getDoc(doc(db, 'accounts', usernameId));
    if (existingCloudAcc.exists()) {
      throw new Error(
        'That username is already registered. Please sign in or choose another username.'
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('already registered')) {
      throw err;
    }
  }

  // Generate unique room code
  const localRooms = getLocalRooms();
  let roomCode = generateUniqueRoomCode();
  for (let i = 0; i < 6; i++) {
    let takenInCloud = false;
    try {
      const rSnap = await getDoc(doc(db, 'rooms', roomCode));
      takenInCloud = rSnap.exists();
    } catch {
      // Ignore
    }
    if (!localRooms[roomCode] && !takenInCloud) break;
    roomCode = generateUniqueRoomCode();
  }

  // Option A: Browser-Based Storage (No email required)
  if (params.storageMode === 'browser') {
    const localOwnerUid = `browser_${usernameId}`;
    const now = Date.now();

    const storedAccount: StoredBrowserAccount = {
      usernameId,
      username: cleanUsername,
      passwordHash,
      securityQuestion: safeQuestion,
      securityAnswerHash,
      displayName: identity.displayName,
      gender: identity.gender,
      avatarId: identity.avatarId,
      roomCode,
      ownerUid: localOwnerUid,
      storageMode: 'browser',
      createdAtMs: now,
      updatedAtMs: now,
    };

    const roomRecord: RoomRecord = {
      roomCode,
      ownerUid: localOwnerUid,
      ownerUsername: usernameId,
      ownerDisplayName: identity.displayName,
      ownerAvatarId: identity.avatarId,
      status: 'active',
    };

    const memberRecord: RoomMemberRecord = {
      memberId: usernameId,
      roomCode,
      userUid: localOwnerUid,
      username: cleanUsername,
      displayName: identity.displayName,
      gender: identity.gender,
      avatarId: identity.avatarId,
      memberUids: [localOwnerUid],
      joinedAtMs: now,
    };

    // 1. Register on Express server
    try {
      const res = await fetch('/api/monkeychat/accounts/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: storedAccount,
          room: roomRecord,
          member: memberRecord,
        }),
      });
      if (res.status === 409) {
        const errData = (await res.json()) as { error?: string };
        throw new Error(
          errData.error ||
            'That username is already registered. Please sign in or choose another username.'
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('already registered')) {
        throw err;
      }
    }

    // 2. Save in localStorage
    saveLocalAccount(storedAccount);
    saveLocalRoom(roomRecord);
    saveLocalMember(memberRecord);

    // 3. Also write to Cloud Firestore using deterministic browser_<usernameId> identity
    // so users across ais-dev, ais-pre, Incognito, and other browsers can join & chat in real time!
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'accounts', usernameId), {
        usernameId,
        username: cleanUsername,
        passwordHash,
        securityQuestion: safeQuestion,
        securityAnswerHash,
        displayName: identity.displayName,
        gender: identity.gender,
        avatarId: identity.avatarId,
        roomCode,
        ownerUid: localOwnerUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'rooms', roomCode), {
        roomCode,
        ownerUid: localOwnerUid,
        ownerUsername: usernameId,
        ownerDisplayName: identity.displayName,
        ownerAvatarId: identity.avatarId,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(db, 'rooms', roomCode, 'members', usernameId), {
        memberId: usernameId,
        roomCode,
        userUid: localOwnerUid,
        username: cleanUsername,
        displayName: identity.displayName,
        gender: identity.gender,
        avatarId: identity.avatarId,
        memberUids: [localOwnerUid],
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
    } catch {
      // Fallback: localStorage + Express server already saved
    }

    return {
      usernameId,
      username: cleanUsername,
      displayName: identity.displayName,
      gender: identity.gender,
      avatarId: identity.avatarId,
      securityQuestion: safeQuestion,
      roomCode,
      ownerUid: localOwnerUid,
      storageMode: 'browser',
    };
  }

  // Option B: Bind with Gmail (Firebase Authentication & Firestore Cloud Sync)
  const fbUser = await ensureVerifiedFirebaseUser();
  const accountPath = `accounts/${usernameId}`;

  const batch = writeBatch(db);

  const accountRef = doc(db, 'accounts', usernameId);
  batch.set(accountRef, {
    usernameId,
    username: cleanUsername,
    passwordHash,
    securityQuestion: safeQuestion,
    securityAnswerHash,
    displayName: identity.displayName,
    gender: identity.gender,
    avatarId: identity.avatarId,
    roomCode,
    ownerUid: fbUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const roomRef = doc(db, 'rooms', roomCode);
  batch.set(roomRef, {
    roomCode,
    ownerUid: fbUser.uid,
    ownerUsername: usernameId,
    ownerDisplayName: identity.displayName,
    ownerAvatarId: identity.avatarId,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const memberRef = doc(db, 'rooms', roomCode, 'members', usernameId);
  batch.set(memberRef, {
    memberId: usernameId,
    roomCode,
    userUid: fbUser.uid,
    username: cleanUsername,
    displayName: identity.displayName,
    gender: identity.gender,
    avatarId: identity.avatarId,
    memberUids: [fbUser.uid],
    joinedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, accountPath);
  }

  const now = Date.now();
  const boundEmail = fbUser.email || undefined;

  const storedAccount: StoredBrowserAccount = {
    usernameId,
    username: cleanUsername,
    passwordHash,
    securityQuestion: safeQuestion,
    securityAnswerHash,
    displayName: identity.displayName,
    gender: identity.gender,
    avatarId: identity.avatarId,
    roomCode,
    ownerUid: fbUser.uid,
    storageMode: 'gmail',
    boundEmail,
    createdAtMs: now,
    updatedAtMs: now,
  };

  const roomRecord: RoomRecord = {
    roomCode,
    ownerUid: fbUser.uid,
    ownerUsername: usernameId,
    ownerDisplayName: identity.displayName,
    ownerAvatarId: identity.avatarId,
    status: 'active',
  };

  const memberRecord: RoomMemberRecord = {
    memberId: usernameId,
    roomCode,
    userUid: fbUser.uid,
    username: cleanUsername,
    displayName: identity.displayName,
    gender: identity.gender,
    avatarId: identity.avatarId,
    memberUids: [fbUser.uid],
    joinedAtMs: now,
  };

  saveLocalAccount(storedAccount);
  saveLocalRoom(roomRecord);
  saveLocalMember(memberRecord);

  try {
    await fetch('/api/monkeychat/accounts/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: storedAccount,
        room: roomRecord,
        member: memberRecord,
      }),
    });
  } catch {
    // Ignore if server unreachable
  }

  return {
    usernameId,
    username: cleanUsername,
    displayName: identity.displayName,
    gender: identity.gender,
    avatarId: identity.avatarId,
    securityQuestion: safeQuestion,
    roomCode,
    ownerUid: fbUser.uid,
    storageMode: 'gmail',
    boundEmail,
  };
}

/**
 * Binds an existing Browser-Based Storage account to the user's Gmail / Firebase account,
 * migrating their profile, permanent room code, membership, and local room messages to Firestore.
 */
export async function bindBrowserAccountToGmail(
  account: MonkeyChatAccount
): Promise<MonkeyChatAccount> {
  const fbUser = await ensureVerifiedFirebaseUser();
  const usernameId = account.usernameId;
  const localAccounts = getLocalAccounts();
  const storedLocal = localAccounts[usernameId];

  const accountPath = `accounts/${usernameId}`;
  const accountRef = doc(db, 'accounts', usernameId);
  let existingCloudSnap;
  try {
    existingCloudSnap = await getDoc(accountRef);
  } catch (err) {
    if (isPermissionDeniedError(err)) {
      throw new Error(
        'This username is already bound to a different Gmail account in cloud storage.'
      );
    }
    handleFirestoreError(err, OperationType.GET, accountPath);
  }

  const passwordHash =
    storedLocal?.passwordHash || (await hashPassword('default_bound_pw'));
  const securityAnswerHash =
    storedLocal?.securityAnswerHash || (await hashSecurityAnswer('bound'));
  const safeQuestion =
    account.securityQuestion && account.securityQuestion.length >= 5
      ? account.securityQuestion.slice(0, 120)
      : "What was your first pet's name?";

  if (!existingCloudSnap || !existingCloudSnap.exists()) {
    const batch = writeBatch(db);

    batch.set(accountRef, {
      usernameId,
      username: account.username.slice(0, 32),
      passwordHash,
      securityQuestion: safeQuestion,
      securityAnswerHash,
      displayName: account.displayName.slice(0, 80),
      gender: account.gender,
      avatarId: account.avatarId,
      roomCode: account.roomCode,
      ownerUid: fbUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const roomRef = doc(db, 'rooms', account.roomCode);
    batch.set(roomRef, {
      roomCode: account.roomCode,
      ownerUid: fbUser.uid,
      ownerUsername: usernameId,
      ownerDisplayName: account.displayName.slice(0, 80),
      ownerAvatarId: account.avatarId,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const memberRef = doc(
      db,
      'rooms',
      account.roomCode,
      'members',
      usernameId
    );
    batch.set(memberRef, {
      memberId: usernameId,
      roomCode: account.roomCode,
      userUid: fbUser.uid,
      username: account.username.slice(0, 32),
      displayName: account.displayName.slice(0, 80),
      gender: account.gender,
      avatarId: account.avatarId,
      memberUids: [fbUser.uid],
      joinedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, accountPath);
    }
  } else {
    try {
      await updateDoc(accountRef, {
        ownerUid: fbUser.uid,
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Ignore if already updated
    }
  }

  await syncRoomStateToCloud(account.roomCode);

  const boundEmail = fbUser.email || undefined;
  const updatedAccount: MonkeyChatAccount = {
    ...account,
    ownerUid: fbUser.uid,
    storageMode: 'gmail',
    boundEmail,
  };

  if (storedLocal) {
    saveLocalAccount({
      ...storedLocal,
      ownerUid: fbUser.uid,
      storageMode: 'gmail',
      boundEmail,
      updatedAtMs: Date.now(),
    });
  }

  saveLocalRoom({
    roomCode: account.roomCode,
    ownerUid: fbUser.uid,
    ownerUsername: usernameId,
    ownerDisplayName: account.displayName,
    ownerAvatarId: account.avatarId,
    status: 'active',
  });

  saveLocalMember({
    memberId: usernameId,
    roomCode: account.roomCode,
    userUid: fbUser.uid,
    username: account.username,
    displayName: account.displayName,
    gender: account.gender,
    avatarId: account.avatarId,
    memberUids: [fbUser.uid],
    joinedAtMs: Date.now(),
  });

  try {
    await fetch(`/api/monkeychat/accounts/${usernameId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerUid: fbUser.uid,
        storageMode: 'gmail',
        boundEmail,
      }),
    });
  } catch {
    // Ignore server sync error
  }

  return updatedAccount;
}

/**
 * Logs in an existing user with Username and Password.
 * Checks Browser Storage -> Express Server -> Firebase Firestore (without requiring Google Sign-In for browser accounts).
 */
export async function loginMonkeyChatUser(params: {
  username: string;
  password: string;
}): Promise<MonkeyChatAccount> {
  const usernameError = validateUsername(params.username);
  if (usernameError) {
    throw new Error(usernameError);
  }

  const usernameId = normalizeUsernameId(params.username);
  const expectedHash = await hashPassword(params.password);

  // 1. Check Local Browser Storage
  let candidateAcc: StoredBrowserAccount | undefined =
    getLocalAccounts()[usernameId];

  // 2. Check Express Server store
  if (!candidateAcc) {
    try {
      const res = await fetch(`/api/monkeychat/accounts/${usernameId}`);
      if (res.ok) {
        const data = (await res.json()) as { account?: StoredBrowserAccount };
        if (data.account) {
          candidateAcc = data.account;
          saveLocalAccount(data.account);
        }
      }
    } catch {
      // Ignore server lookup failure
    }
  }

  // 3. Check Cloud Firestore directly (works for both Browser Storage and Gmail accounts across instances!)
  if (!candidateAcc) {
    try {
      const snap = await getDoc(doc(db, 'accounts', usernameId));
      if (snap.exists()) {
        const data = snap.data();
        const isBrowserMode = String(data.ownerUid || '').startsWith('browser_');
        candidateAcc = {
          usernameId: data.usernameId,
          username: data.username,
          passwordHash: data.passwordHash,
          securityQuestion: data.securityQuestion,
          securityAnswerHash: data.securityAnswerHash,
          displayName: data.displayName,
          gender: data.gender as IdentityGender,
          avatarId: data.avatarId,
          roomCode: data.roomCode,
          ownerUid: data.ownerUid,
          storageMode: isBrowserMode ? 'browser' : 'gmail',
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        };
        saveLocalAccount(candidateAcc);
      }
    } catch {
      // Ignore Firestore lookup error
    }
  }

  if (!candidateAcc) {
    throw new Error(
      'Account not found. Please check your username or register first.'
    );
  }

  if (candidateAcc.passwordHash !== expectedHash) {
    throw new Error(
      'Invalid password. Please try again or use Forgot Password.'
    );
  }

  const resultAccount: MonkeyChatAccount = {
    usernameId: candidateAcc.usernameId,
    username: candidateAcc.username,
    displayName: candidateAcc.displayName,
    gender: candidateAcc.gender,
    avatarId: candidateAcc.avatarId,
    securityQuestion: candidateAcc.securityQuestion,
    roomCode: candidateAcc.roomCode,
    ownerUid: candidateAcc.ownerUid,
    storageMode: candidateAcc.storageMode || 'browser',
    boundEmail: candidateAcc.boundEmail,
  };

  await ensureActiveAccountRoomRegistered(resultAccount);
  return resultAccount;
}

/**
 * Step 1 of Forgot Password: Verifies username exists in Browser Storage, Server, or Firestore
 * and returns the registered Security Question.
 */
export async function lookupSecurityQuestion(username: string): Promise<{
  usernameId: string;
  username: string;
  securityQuestion: string;
  storageMode: AccountStorageMode;
}> {
  const usernameError = validateUsername(username);
  if (usernameError) {
    throw new Error(usernameError);
  }

  const usernameId = normalizeUsernameId(username);

  // 1. Check Local Browser Storage
  let localAcc: StoredBrowserAccount | undefined =
    getLocalAccounts()[usernameId];

  // 2. Check Express Server
  if (!localAcc) {
    try {
      const res = await fetch(`/api/monkeychat/accounts/${usernameId}`);
      if (res.ok) {
        const data = (await res.json()) as { account?: StoredBrowserAccount };
        if (data.account) {
          localAcc = data.account;
          saveLocalAccount(data.account);
        }
      }
    } catch {
      // Ignore network error
    }
  }

  // 3. Check Cloud Firestore directly
  if (!localAcc) {
    try {
      const snap = await getDoc(doc(db, 'accounts', usernameId));
      if (snap.exists()) {
        const data = snap.data();
        const isBrowserMode = String(data.ownerUid || '').startsWith('browser_');
        localAcc = {
          usernameId: data.usernameId,
          username: data.username,
          passwordHash: data.passwordHash,
          securityQuestion: data.securityQuestion,
          securityAnswerHash: data.securityAnswerHash,
          displayName: data.displayName,
          gender: data.gender as IdentityGender,
          avatarId: data.avatarId,
          roomCode: data.roomCode,
          ownerUid: data.ownerUid,
          storageMode: isBrowserMode ? 'browser' : 'gmail',
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        };
        saveLocalAccount(localAcc);
      }
    } catch {
      // Ignore
    }
  }

  if (!localAcc) {
    throw new Error('No registered account found for that username.');
  }

  return {
    usernameId: localAcc.usernameId,
    username: localAcc.username,
    securityQuestion: localAcc.securityQuestion,
    storageMode: localAcc.storageMode,
  };
}

/**
 * Step 2 of Forgot Password: Verifies the security answer and resets the password
 * in Browser Storage, Express Server, and Cloud Firestore.
 */
export async function verifyAnswerAndResetPassword(params: {
  usernameId: string;
  securityAnswer: string;
  newPassword: string;
}): Promise<void> {
  if (params.newPassword.length < 4) {
    throw new Error('New password must be at least 4 characters.');
  }

  const candidateAnswerHash = await hashSecurityAnswer(params.securityAnswer);
  const newPasswordHash = await hashPassword(params.newPassword);

  let localAcc: StoredBrowserAccount | undefined =
    getLocalAccounts()[params.usernameId];

  if (!localAcc) {
    try {
      const res = await fetch(`/api/monkeychat/accounts/${params.usernameId}`);
      if (res.ok) {
        const data = (await res.json()) as { account?: StoredBrowserAccount };
        if (data.account) {
          localAcc = data.account;
        }
      }
    } catch {
      // Ignore
    }
  }

  if (!localAcc) {
    try {
      const snap = await getDoc(doc(db, 'accounts', params.usernameId));
      if (snap.exists()) {
        const data = snap.data();
        localAcc = {
          usernameId: data.usernameId,
          username: data.username,
          passwordHash: data.passwordHash,
          securityQuestion: data.securityQuestion,
          securityAnswerHash: data.securityAnswerHash,
          displayName: data.displayName,
          gender: data.gender as IdentityGender,
          avatarId: data.avatarId,
          roomCode: data.roomCode,
          ownerUid: data.ownerUid,
          storageMode: String(data.ownerUid || '').startsWith('browser_')
            ? 'browser'
            : 'gmail',
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        };
      }
    } catch {
      // Ignore
    }
  }

  if (!localAcc) {
    throw new Error('Account no longer exists.');
  }

  if (candidateAnswerHash !== localAcc.securityAnswerHash) {
    throw new Error(
      'Incorrect security answer. Please check your answer and try again.'
    );
  }

  const updatedAcc: StoredBrowserAccount = {
    ...localAcc,
    passwordHash: newPasswordHash,
    updatedAtMs: Date.now(),
  };
  saveLocalAccount(updatedAcc);

  try {
    await fetch(`/api/monkeychat/accounts/${params.usernameId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passwordHash: newPasswordHash }),
    });
  } catch {
    // Ignore
  }

  try {
    const accountRef = doc(db, 'accounts', params.usernameId);
    const snap = await getDoc(accountRef);
    if (snap.exists()) {
      await updateDoc(accountRef, {
        passwordHash: newPasswordHash,
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Ignore cloud update error if offline
  }
}

/**
 * Generates a new random Japanese identity for the chosen gender and persists it
 * across Browser Storage, Express Server, and Cloud Firestore.
 */
export async function generateAndSaveRandomIdentity(params: {
  account: MonkeyChatAccount;
  chosenGender: IdentityGender;
  activeRoomCode: string;
}): Promise<MonkeyChatAccount> {
  const newIdentity = generateRandomJapaneseIdentity(
    params.chosenGender,
    params.account.displayName
  );

  // 1. Update Local Browser Storage & broadcast to open tabs
  const localAccounts = getLocalAccounts();
  const localAcc = localAccounts[params.account.usernameId];
  if (localAcc) {
    saveLocalAccount({
      ...localAcc,
      displayName: newIdentity.displayName,
      gender: newIdentity.gender,
      avatarId: newIdentity.avatarId,
      updatedAtMs: Date.now(),
    });
  }

  const localRooms = getLocalRooms();
  if (localRooms[params.account.roomCode]) {
    saveLocalRoom({
      ...localRooms[params.account.roomCode],
      ownerDisplayName: newIdentity.displayName,
      ownerAvatarId: newIdentity.avatarId,
    });
  }

  const allLocalMembers = getLocalMembersByRoom();
  const ownRoomMember =
    allLocalMembers[params.account.roomCode]?.[params.account.usernameId];
  if (ownRoomMember) {
    saveLocalMember({
      ...ownRoomMember,
      displayName: newIdentity.displayName,
      gender: newIdentity.gender,
      avatarId: newIdentity.avatarId,
    });
  }

  if (params.activeRoomCode !== params.account.roomCode) {
    const activeRoomMember =
      allLocalMembers[params.activeRoomCode]?.[params.account.usernameId];
    if (activeRoomMember) {
      saveLocalMember({
        ...activeRoomMember,
        displayName: newIdentity.displayName,
        gender: newIdentity.gender,
        avatarId: newIdentity.avatarId,
      });
    }
  }

  // 2. Update Express Server store
  try {
    await fetch(`/api/monkeychat/accounts/${params.account.usernameId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: newIdentity.displayName,
        gender: newIdentity.gender,
        avatarId: newIdentity.avatarId,
        activeRoomCode: params.activeRoomCode,
      }),
    });
  } catch {
    // Ignore server error
  }

  // 3. Update Cloud Firestore (works for both Browser Storage and Gmail accounts)
  try {
    const accountRef = doc(db, 'accounts', params.account.usernameId);
    const accSnap = await getDoc(accountRef);
    if (accSnap.exists()) {
      await updateDoc(accountRef, {
        displayName: newIdentity.displayName,
        gender: newIdentity.gender,
        avatarId: newIdentity.avatarId,
        updatedAt: serverTimestamp(),
      });
    }

    const ownRoomRef = doc(db, 'rooms', params.account.roomCode);
    const roomSnap = await getDoc(ownRoomRef);
    if (roomSnap.exists()) {
      await updateDoc(ownRoomRef, {
        ownerUid: roomSnap.data().ownerUid,
        ownerDisplayName: newIdentity.displayName,
        ownerAvatarId: newIdentity.avatarId,
        updatedAt: serverTimestamp(),
      });
    }

    const ownMemberRef = doc(
      db,
      'rooms',
      params.account.roomCode,
      'members',
      params.account.usernameId
    );
    const ownMemberSnap = await getDoc(ownMemberRef);
    if (ownMemberSnap.exists()) {
      await updateDoc(ownMemberRef, {
        userUid: ownMemberSnap.data().userUid,
        displayName: newIdentity.displayName,
        gender: newIdentity.gender,
        avatarId: newIdentity.avatarId,
        memberUids: ownMemberSnap.data().memberUids,
        updatedAt: serverTimestamp(),
      });
    }

    if (params.activeRoomCode !== params.account.roomCode) {
      const activeMemberRef = doc(
        db,
        'rooms',
        params.activeRoomCode,
        'members',
        params.account.usernameId
      );
      const activeMemberSnap = await getDoc(activeMemberRef);
      if (activeMemberSnap.exists()) {
        await updateDoc(activeMemberRef, {
          userUid: activeMemberSnap.data().userUid,
          displayName: newIdentity.displayName,
          gender: newIdentity.gender,
          avatarId: newIdentity.avatarId,
          memberUids: activeMemberSnap.data().memberUids,
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch {
    // Ignore Firestore update error if offline
  }

  return {
    ...params.account,
    displayName: newIdentity.displayName,
    gender: newIdentity.gender,
    avatarId: newIdentity.avatarId,
  };
}

/**
 * Sets or removes a password lock on a chat room (only permitted by room owner).
 */
export async function setRoomLock(params: {
  roomCode: string;
  isLocked: boolean;
  password?: string;
  account: MonkeyChatAccount;
}): Promise<RoomRecord> {
  const code = normalizeRoomCode(params.roomCode);
  let passwordHash = '';
  if (params.isLocked) {
    if (!params.password || params.password.length < 1) {
      throw new Error('A password is required to lock your room.');
    }
    passwordHash = await hashPassword(params.password);
  }

  const localRooms = getLocalRooms();
  const current = localRooms[code] || {
    roomCode: code,
    ownerUid: params.account.ownerUid,
    ownerUsername: params.account.usernameId,
    ownerDisplayName: params.account.displayName,
    ownerAvatarId: params.account.avatarId,
    status: 'active' as const,
  };

  const updatedRoom: RoomRecord = {
    ...current,
    isLocked: params.isLocked,
    passwordHash: params.isLocked ? passwordHash : '',
  };
  saveLocalRoom(updatedRoom);

  // Update on Express server
  try {
    await fetch(`/api/monkeychat/rooms/${code}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        isLocked: params.isLocked,
        passwordHash: updatedRoom.passwordHash,
        ownerUsername: params.account.usernameId,
      }),
    });
  } catch {
    // Ignore server error
  }

  // Update in Cloud Firestore
  try {
    const roomRef = doc(db, 'rooms', code);
    const snap = await getDoc(roomRef);
    if (snap.exists()) {
      await updateDoc(roomRef, {
        isLocked: params.isLocked,
        passwordHash: updatedRoom.passwordHash || '',
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(roomRef, {
        roomCode: code,
        ownerUid: params.account.ownerUid,
        ownerUsername: params.account.usernameId,
        ownerDisplayName: params.account.displayName.slice(0, 80),
        ownerAvatarId: params.account.avatarId,
        status: 'active',
        isLocked: params.isLocked,
        passwordHash: updatedRoom.passwordHash || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // Ignore offline error
  }

  return updatedRoom;
}

/**
 * Looks up room metadata (including lock status) across Local Storage, Server, and Firestore.
 */
export async function getRoomRecord(
  roomCode: string
): Promise<RoomRecord | null> {
  const code = normalizeRoomCode(roomCode);
  if (!validateRoomCodeFormat(code)) return null;

  const local = getLocalRooms()[code];
  if (local && local.status === 'active') return local;

  try {
    const res = await fetch(`/api/monkeychat/rooms/${code}`);
    if (res.ok) {
      const data = (await res.json()) as { room?: RoomRecord };
      if (data.room && data.room.status === 'active') {
        saveLocalRoom(data.room);
        return data.room;
      }
    }
  } catch {
    // Ignore network error
  }

  try {
    const snap = await getDoc(doc(db, 'rooms', code));
    if (snap.exists()) {
      const d = snap.data();
      if (d.status === 'active') {
        const r: RoomRecord = {
          roomCode: d.roomCode,
          ownerUid: d.ownerUid,
          ownerUsername: d.ownerUsername,
          ownerDisplayName: d.ownerDisplayName,
          ownerAvatarId: d.ownerAvatarId,
          status: d.status,
          isLocked: !!d.isLocked,
          passwordHash: d.passwordHash || '',
        };
        saveLocalRoom(r);
        return r;
      }
    }
  } catch {
    // Ignore Firestore lookup error
  }

  return null;
}

/**
 * Verifies that a room code exists (in Browser Storage, Express Server, or Cloud Firestore)
 * and adds the user to that room's session so they can chat in real time.
 * If the room is password-locked and user is not owner, requires matching roomPassword.
 */
export async function joinRoomByCode(params: {
  rawRoomCode: string;
  account: MonkeyChatAccount;
  roomPassword?: string;
}): Promise<RoomRecord> {
  const normalizedCode = normalizeRoomCode(params.rawRoomCode);
  if (!validateRoomCodeFormat(normalizedCode)) {
    throw new Error('There is no existing room for that code.');
  }

  let foundRoom: RoomRecord | null = null;
  const roomPasswordHash = params.roomPassword
    ? await hashPassword(params.roomPassword)
    : undefined;

  // 1. Check Local Browser Storage
  const localRoom = getLocalRooms()[normalizedCode];
  if (localRoom && localRoom.status === 'active') {
    foundRoom = localRoom;
  }

  // 2. Check Express Server (enables joining rooms across tabs, Incognito, and separate browsers)
  try {
    const res = await fetch(`/api/monkeychat/rooms/${normalizedCode}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account: params.account,
        roomPasswordHash,
      }),
    });
    if (res.status === 403) {
      const errData = (await res.json()) as { error?: string };
      if (errData.error === 'ROOM_LOCKED') {
        throw new Error('ROOM_LOCKED');
      }
    }
    if (res.ok) {
      const data = (await res.json()) as {
        room: RoomRecord;
        members?: RoomMemberRecord[];
        messages?: ChatMessageRecord[];
      };
      if (data.room && data.room.status === 'active') {
        foundRoom = data.room;
        saveLocalRoom(data.room);
        if (Array.isArray(data.members)) {
          data.members.forEach((m) => saveLocalMember(m));
        }
        if (Array.isArray(data.messages)) {
          data.messages.forEach((msg) => saveLocalMessage(msg));
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'ROOM_LOCKED') {
      throw err;
    }
  }

  // 3. Check Firebase Firestore unconditionally (for both Browser Storage and Gmail users!)
  try {
    const roomSnap = await getDoc(doc(db, 'rooms', normalizedCode));
    if (roomSnap.exists()) {
      const roomData = roomSnap.data();
      if (roomData.status === 'active') {
        foundRoom = {
          roomCode: roomData.roomCode,
          ownerUid: roomData.ownerUid,
          ownerUsername: roomData.ownerUsername,
          ownerDisplayName: roomData.ownerDisplayName,
          ownerAvatarId: roomData.ownerAvatarId,
          status: roomData.status,
          isLocked: !!roomData.isLocked,
          passwordHash: roomData.passwordHash || '',
        };
        saveLocalRoom(foundRoom);
      }
    }
  } catch {
    // Ignore transient Firestore error if already found
  }

  if (!foundRoom) {
    throw new Error('There is no existing room for that code.');
  }

  // Password Lock Enforcement for Non-Owners
  const isOwner =
    foundRoom.ownerUsername === params.account.usernameId ||
    foundRoom.ownerUid === params.account.ownerUid;

  if (foundRoom.isLocked && !isOwner) {
    if (!params.roomPassword) {
      throw new Error('ROOM_LOCKED');
    }
    const candidateHash = await hashPassword(params.roomPassword);
    if (candidateHash !== foundRoom.passwordHash) {
      throw new Error('INCORRECT_ROOM_PASSWORD');
    }
  }

  // Record the joining user as a member in localStorage, Express Server, AND Cloud Firestore
  const userUid =
    params.account.ownerUid || `browser_${params.account.usernameId}`;
  const allowedUids = Array.from(
    new Set([userUid, foundRoom.ownerUid])
  ).slice(0, 10);

  const memberRecord: RoomMemberRecord = {
    memberId: params.account.usernameId,
    roomCode: normalizedCode,
    userUid,
    username: params.account.username,
    displayName: params.account.displayName,
    gender: params.account.gender,
    avatarId: params.account.avatarId,
    memberUids: allowedUids,
    joinedAtMs: Date.now(),
  };

  saveLocalRoom(foundRoom);
  saveLocalMember(memberRecord);

  // Sync member & room to Cloud Firestore unconditionally (so the Owner on ais-dev or ais-pre sees the Joiner immediately!)
  try {
    const roomRef = doc(db, 'rooms', normalizedCode);
    const rSnap = await getDoc(roomRef);
    if (!rSnap.exists()) {
      await setDoc(roomRef, {
        roomCode: normalizedCode,
        ownerUid: foundRoom.ownerUid || `browser_${foundRoom.ownerUsername}`,
        ownerUsername: foundRoom.ownerUsername,
        ownerDisplayName: foundRoom.ownerDisplayName.slice(0, 80),
        ownerAvatarId: foundRoom.ownerAvatarId,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    const memberRef = doc(
      db,
      'rooms',
      normalizedCode,
      'members',
      params.account.usernameId
    );
    const existingMemberSnap = await getDoc(memberRef);
    if (!existingMemberSnap.exists()) {
      await setDoc(memberRef, {
        memberId: params.account.usernameId,
        roomCode: normalizedCode,
        userUid,
        username: params.account.username.slice(0, 32),
        displayName: params.account.displayName.slice(0, 80),
        gender: params.account.gender,
        avatarId: params.account.avatarId,
        memberUids: allowedUids,
        joinedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const prevUids: string[] = Array.isArray(
        existingMemberSnap.data().memberUids
      )
        ? existingMemberSnap.data().memberUids
        : [];
      const mergedUids = Array.from(
        new Set([userUid, foundRoom.ownerUid, ...prevUids])
      ).slice(0, 10);

      await updateDoc(memberRef, {
        userUid,
        displayName: params.account.displayName.slice(0, 80),
        gender: params.account.gender,
        avatarId: params.account.avatarId,
        memberUids: mergedUids,
        updatedAt: serverTimestamp(),
      });
    }

    // Fetch existing Firestore messages & members right away on join
    const msgsSnap = await getDocs(
      collection(db, 'rooms', normalizedCode, 'messages')
    );
    msgsSnap.docs.forEach((d) => {
      const mData = d.data();
      const msgId = mData.messageId || d.id;
      if (mData && mData.text) {
        saveLocalMessage({
          messageId: msgId,
          roomCode: normalizedCode,
          senderUid: mData.senderUid || 'anonymous',
          senderUsername: mData.senderUsername || 'guest',
          senderDisplayName:
            mData.senderDisplayName || mData.senderName || 'Guest',
          senderAvatarId: mData.senderAvatarId || 'jp_neutral_1',
          text: mData.text,
          memberUids: Array.isArray(mData.memberUids)
            ? mData.memberUids
            : [mData.senderUid || 'anonymous'],
          createdAtMs: extractMessageCreatedAtMs(msgId, mData.createdAt),
        });
      }
    });
  } catch {
    // Ignore transient Firestore error
  }

  // Sync discovered room & joined member back to Express server as well
  try {
    await fetch('/api/monkeychat/sync-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rooms: { [normalizedCode]: foundRoom },
        members: {
          [normalizedCode]: { [params.account.usernameId]: memberRecord },
        },
      }),
    });
  } catch {
    // Ignore
  }

  return foundRoom;
}

/**
 * Posts a real-time chat message to the specified room, syncing across
 * Browser Storage, Express Server, AND Cloud Firestore (for both Browser Storage and Gmail users).
 */
export async function sendRoomMessage(params: {
  roomCode: string;
  roomOwnerUid: string;
  account: MonkeyChatAccount;
  text: string;
  knownParticipantUids: string[];
}): Promise<void> {
  const trimmed = params.text.trim().slice(0, 1000);
  if (!trimmed) return;

  const code = normalizeRoomCode(params.roomCode);
  const messageId = generateMessageId();
  const now = Date.now();
  const senderUid =
    params.account.ownerUid || `browser_${params.account.usernameId}`;

  const memberUids = Array.from(
    new Set([senderUid, params.roomOwnerUid, ...params.knownParticipantUids])
  )
    .filter(
      (uid) => typeof uid === 'string' && uid.length > 0 && uid.length <= 128
    )
    .slice(0, 10);

  const safeMemberUids = memberUids.length > 0 ? memberUids : [senderUid];

  const messageRecord: ChatMessageRecord = {
    messageId,
    roomCode: code,
    senderUid,
    senderUsername: params.account.usernameId,
    senderDisplayName: params.account.displayName,
    senderAvatarId: params.account.avatarId,
    text: trimmed,
    memberUids: safeMemberUids,
    createdAtMs: now,
  };

  // 1. Save to Local Browser Storage and broadcast immediately (0ms in same browser)
  saveLocalMessage(messageRecord);

  // 2. Write directly to rooms/{activeRoomCode}/messages/{messageId} in Cloud Firestore first
  const firestoreWritePromise = (async () => {
    try {
      await setDoc(doc(db, 'rooms', code, 'messages', messageId), {
        messageId,
        roomCode: code,
        senderUid,
        senderUsername: params.account.usernameId.slice(0, 32),
        senderDisplayName: params.account.displayName.slice(0, 80),
        senderAvatarId: params.account.avatarId,
        text: trimmed,
        memberUids: safeMemberUids,
        createdAt: serverTimestamp(),
      });

      const roomRef = doc(db, 'rooms', code);
      const roomSnap = await getDoc(roomRef);
      if (!roomSnap.exists()) {
        const localRoom = getLocalRooms()[code];
        await setDoc(roomRef, {
          roomCode: code,
          ownerUid:
            localRoom?.ownerUid ||
            params.roomOwnerUid ||
            `browser_${params.account.usernameId}`,
          ownerUsername: localRoom?.ownerUsername || params.account.usernameId,
          ownerDisplayName: (
            localRoom?.ownerDisplayName || params.account.displayName
          ).slice(0, 80),
          ownerAvatarId: localRoom?.ownerAvatarId || params.account.avatarId,
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const memberRef = doc(
        db,
        'rooms',
        code,
        'members',
        params.account.usernameId
      );
      const memberSnap = await getDoc(memberRef);
      if (!memberSnap.exists()) {
        await setDoc(memberRef, {
          memberId: params.account.usernameId,
          roomCode: code,
          userUid: senderUid,
          username: params.account.username.slice(0, 32),
          displayName: params.account.displayName.slice(0, 80),
          gender: params.account.gender,
          avatarId: params.account.avatarId,
          memberUids: safeMemberUids,
          joinedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch {
      // Do not fail if offline
    }
  })();

  // 3. Send to Express Server so all local tabs/windows also receive it via HTTP sync
  const serverWritePromise = (async () => {
    try {
      await fetch(`/api/monkeychat/rooms/${code}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageRecord }),
      });
    } catch {
      // Ignore if server offline
    }
  })();

  await Promise.all([firestoreWritePromise, serverWritePromise]);

  // 4. Optional @bot hook: Trigger backend /api/chat if message starts with "@bot"
  if (/^@bot\b/i.test(trimmed)) {
    const promptText = trimmed.replace(/^@bot\s*/i, '').trim() || 'Hello!';
    const recentMsgs = (getLocalMessagesByRoom()[code] || []).slice(-10);
    const history = recentMsgs.map((m) => ({
      role: (m.senderUsername === 'monkeybot' ? 'model' : 'user') as
        | 'user'
        | 'model',
      parts: [{ text: `${m.senderDisplayName}: ${m.text}` }],
    }));

    try {
      const botRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history, message: promptText }),
      });
      if (botRes.ok) {
        const botData = (await botRes.json()) as { text?: string };
        const replyText = (botData.text || '').trim().slice(0, 1000);
        if (replyText) {
          const botMsgId = generateMessageId();
          const botRecord: ChatMessageRecord = {
            messageId: botMsgId,
            roomCode: code,
            senderUid: 'browser_monkeybot',
            senderUsername: 'monkeybot',
            senderDisplayName: 'MonkeyBot (@bot)',
            senderAvatarId: 'jp_neutral_1',
            text: replyText,
            memberUids: ['browser_monkeybot', ...safeMemberUids].slice(0, 10),
            createdAtMs: Date.now(),
          };
          saveLocalMessage(botRecord);
          await Promise.all([
            setDoc(doc(db, 'rooms', code, 'messages', botMsgId), {
              messageId: botMsgId,
              roomCode: code,
              senderUid: 'browser_monkeybot',
              senderUsername: 'monkeybot',
              senderDisplayName: 'MonkeyBot (@bot)',
              senderAvatarId: 'jp_neutral_1',
              text: replyText,
              memberUids: botRecord.memberUids,
              createdAt: serverTimestamp(),
            }).catch(() => {}),
            fetch(`/api/monkeychat/rooms/${code}/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: botRecord }),
            }).catch(() => {}),
          ]);
        }
      }
    } catch {
      // Ignore bot error
    }
  }
}

/**
 * Periodically pulls room metadata, members, and messages from the Express Server
 * AND syncs any local messages to Cloud Firestore for real-time multi-user chat.
 */
function startServerRoomPoller(roomCode: string): () => void {
  const code = normalizeRoomCode(roomCode);
  let active = true;

  // Immediately push any pre-existing local messages/members for this room to Cloud Firestore
  syncRoomStateToCloud(code);

  const pollOnce = async () => {
    if (!active) return;
    try {
      const res = await fetch(`/api/monkeychat/rooms/${code}/sync`);
      if (!res.ok || !active) return;
      const data = (await res.json()) as {
        room: RoomRecord | null;
        members: RoomMemberRecord[];
        messages: ChatMessageRecord[];
      };

      if (data.room) {
        saveLocalRoom(data.room);
      }

      if (Array.isArray(data.members)) {
        for (const m of data.members) {
          if (m && m.memberId) {
            saveLocalMember(m);
          }
        }
      }

      if (Array.isArray(data.messages)) {
        for (const msg of data.messages) {
          if (msg && msg.messageId) {
            saveLocalMessage(msg);
          }
        }
      }

      emitLocalBus({ type: 'MESSAGES_UPDATED', roomCode: code });
    } catch {
      // Ignore network poll error
    }
  };

  pollOnce();
  const intervalId = window.setInterval(pollOnce, 1200);

  return () => {
    active = false;
    window.clearInterval(intervalId);
  };
}

/**
 * Subscribes to real-time room metadata updates across Browser Storage, Express Server, and Cloud Firestore.
 */
export function subscribeToRoom(
  roomCode: string,
  onUpdate: (room: RoomRecord | null) => void
): () => void {
  const code = normalizeRoomCode(roomCode);
  let cloudRoom: RoomRecord | null = null;
  let lastSig = '';

  const emitCombined = () => {
    const resolved = cloudRoom || getLocalRooms()[code] || null;
    const sig = JSON.stringify(resolved);
    if (sig !== lastSig) {
      lastSig = sig;
      onUpdate(resolved);
    }
  };

  emitCombined();

  const stopPoller = startServerRoomPoller(code);
  const unsubLocal = subscribeLocalBus((ev) => {
    if (!ev.roomCode || ev.roomCode === code) {
      emitCombined();
    }
  });
  const localCheckTimer = window.setInterval(emitCombined, 1000);

  // Firestore real-time listener (works with long-polling and sync fallbacks)
  let unsubFirestore: () => void = () => {};
  try {
    unsubFirestore = onSnapshot(
      doc(db, 'rooms', code),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          cloudRoom = {
            roomCode: data.roomCode,
            ownerUid: data.ownerUid,
            ownerUsername: data.ownerUsername,
            ownerDisplayName: data.ownerDisplayName,
            ownerAvatarId: data.ownerAvatarId,
            status: data.status,
            isLocked: !!data.isLocked,
            passwordHash: data.passwordHash || '',
          };
          saveLocalRoom(cloudRoom);
        }
        emitCombined();
      },
      () => {
        // Gracefully handle idle disconnects / reconnects without throwing
        emitCombined();
      }
    );
  } catch {
    // Fallback to poller & local bus
  }

  return () => {
    stopPoller();
    unsubLocal();
    window.clearInterval(localCheckTimer);
    try {
      unsubFirestore();
    } catch {
      // Ignore unsubscribe error
    }
  };
}

/**
 * Subscribes to real-time room members across Browser Storage, Express Server, and Cloud Firestore.
 */
export function subscribeToRoomMembers(
  roomCode: string,
  onUpdate: (members: RoomMemberRecord[]) => void
): () => void {
  const code = normalizeRoomCode(roomCode);
  let cloudMembers: RoomMemberRecord[] = [];
  let lastSig = '';

  const emitCombined = () => {
    const localMap = getLocalMembersByRoom()[code] || {};
    const mergedMap = new Map<string, RoomMemberRecord>();

    Object.values(localMap).forEach((m) => {
      if (m && m.memberId) {
        mergedMap.set(m.memberId, m);
      }
    });
    cloudMembers.forEach((m) => {
      if (m && m.memberId) {
        mergedMap.set(m.memberId, m);
      }
    });

    const list = Array.from(mergedMap.values());
    list.sort((a, b) => a.joinedAtMs - b.joinedAtMs);
    const sig = JSON.stringify(
      list.map((m) => `${m.memberId}:${m.displayName}:${m.avatarId}`)
    );
    if (sig !== lastSig) {
      lastSig = sig;
      onUpdate(list);
    }
  };

  emitCombined();

  const unsubLocal = subscribeLocalBus((ev) => {
    if (!ev.roomCode || ev.roomCode === code) {
      emitCombined();
    }
  });
  const localCheckTimer = window.setInterval(emitCombined, 1000);

  // Direct Firestore collection listener on rooms/{activeRoomCode}/members
  let unsubFirestore: () => void = () => {};
  try {
    unsubFirestore = onSnapshot(
      collection(db, 'rooms', code, 'members'),
      (snap) => {
        cloudMembers = snap.docs.map((d) => {
          const data = d.data();
          const m: RoomMemberRecord = {
            memberId: data.memberId || d.id,
            roomCode: data.roomCode || code,
            userUid: data.userUid || `browser_${data.memberId || d.id}`,
            username: data.username || d.id,
            displayName: data.displayName || d.id,
            gender: (data.gender as IdentityGender) || 'neutral',
            avatarId: data.avatarId || 'jp_neutral_1',
            memberUids: Array.isArray(data.memberUids)
              ? data.memberUids
              : [data.userUid || `browser_${d.id}`],
            joinedAtMs: timestampToMs(data.joinedAt),
          };
          saveLocalMember(m);
          return m;
        });
        emitCombined();
      },
      () => {
        // Gracefully handle idle disconnects / reconnects without throwing
        emitCombined();
      }
    );
  } catch {
    // Fallback to poller & local bus
  }

  return () => {
    unsubLocal();
    window.clearInterval(localCheckTimer);
    try {
      unsubFirestore();
    } catch {
      // Ignore unsubscribe error
    }
  };
}

/**
 * Subscribes to real-time chat messages in a room across Browser Storage, Express Server, and Cloud Firestore.
 * Resolves strictly to rooms/{activeRoomCode}/messages so all users meet in the same timeline.
 */
export function subscribeToRoomMessages(
  roomCode: string,
  onUpdate: (messages: ChatMessageRecord[]) => void
): () => void {
  const code = normalizeRoomCode(roomCode);
  let cloudMessages: ChatMessageRecord[] = [];
  let lastSig = '';

  const emitCombined = () => {
    const localList = getLocalMessagesByRoom()[code] || [];
    const mergedMap = new Map<string, ChatMessageRecord>();

    localList.forEach((m) => {
      if (m && m.messageId) {
        mergedMap.set(m.messageId, m);
      }
    });
    cloudMessages.forEach((m) => {
      if (m && m.messageId) {
        mergedMap.set(m.messageId, m);
      }
    });

    const list = Array.from(mergedMap.values());
    list.sort((a, b) => a.createdAtMs - b.createdAtMs);
    const sig = list.map((m) => m.messageId).join('|');
    if (sig !== lastSig || list.length === 0) {
      lastSig = sig;
      onUpdate(list);
    }
  };

  emitCombined();

  const unsubLocal = subscribeLocalBus((ev) => {
    if (!ev.roomCode || ev.roomCode === code) {
      emitCombined();
    }
  });
  const localCheckTimer = window.setInterval(emitCombined, 1000);

  // Direct Firestore collection listener on rooms/{activeRoomCode}/messages
  let unsubFirestore: () => void = () => {};
  try {
    unsubFirestore = onSnapshot(
      collection(db, 'rooms', code, 'messages'),
      (snap) => {
        cloudMessages = snap.docs
          .map((d) => {
            const data = d.data();
            const msgId = data.messageId || d.id;
            if (!data || !data.text) return null;
            const msg: ChatMessageRecord = {
              messageId: msgId,
              roomCode: data.roomCode || code,
              senderUid: data.senderUid || 'anonymous',
              senderUsername: data.senderUsername || 'guest',
              senderDisplayName:
                data.senderDisplayName || data.senderName || 'Guest',
              senderAvatarId: data.senderAvatarId || 'jp_neutral_1',
              text: data.text,
              memberUids: Array.isArray(data.memberUids)
                ? data.memberUids
                : [data.senderUid || 'anonymous'],
              createdAtMs: extractMessageCreatedAtMs(msgId, data.createdAt),
            };
            saveLocalMessage(msg);
            return msg;
          })
          .filter((m): m is ChatMessageRecord => m !== null);
        emitCombined();
      },
      () => {
        // Gracefully handle idle disconnects / reconnects without throwing
        emitCombined();
      }
    );
  } catch {
    // Fallback to poller & local bus
  }

  return () => {
    unsubLocal();
    window.clearInterval(localCheckTimer);
    try {
      unsubFirestore();
    } catch {
      // Ignore unsubscribe error
    }
  };
}
