import 'dotenv/config';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { initializeApp } from 'firebase/app';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  initializeFirestore,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(__dirname, '.monkeychat-data.json');
const FIREBASE_CONFIG_FILE = path.join(__dirname, 'firebase-applet-config.json');

interface StoredAccount {
  usernameId: string;
  username: string;
  passwordHash: string;
  securityQuestion: string;
  securityAnswerHash: string;
  displayName: string;
  gender: 'male' | 'female' | 'neutral';
  avatarId: string;
  roomCode: string;
  ownerUid: string;
  storageMode: 'browser' | 'gmail';
  boundEmail?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

interface StoredRoom {
  roomCode: string;
  ownerUid: string;
  ownerUsername: string;
  ownerDisplayName: string;
  ownerAvatarId: string;
  status: 'active' | 'archived';
  isLocked?: boolean;
  passwordHash?: string;
}

interface StoredMember {
  memberId: string;
  roomCode: string;
  userUid: string;
  username: string;
  displayName: string;
  gender: 'male' | 'female' | 'neutral';
  avatarId: string;
  memberUids: string[];
  joinedAtMs: number;
}

interface StoredMessage {
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

interface ServerStore {
  accounts: Record<string, StoredAccount>;
  rooms: Record<string, StoredRoom>;
  members: Record<string, Record<string, StoredMember>>;
  messages: Record<string, StoredMessage[]>;
}

function loadStore(): ServerStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<ServerStore>;
      return {
        accounts: parsed.accounts || {},
        rooms: parsed.rooms || {},
        members: parsed.members || {},
        messages: parsed.messages || {},
      };
    }
  } catch (err) {
    console.error('Failed to read store file:', err);
  }
  return {
    accounts: {},
    rooms: {},
    members: {},
    messages: {},
  };
}

const store: ServerStore = loadStore();

function saveStore(): void {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write store file:', err);
  }
}

// Initialize Cloud Firestore on backend so server store and Firestore stay synchronized across instances
let serverDb: ReturnType<typeof initializeFirestore> | null = null;
try {
  setLogLevel('silent');
  if (fs.existsSync(FIREBASE_CONFIG_FILE)) {
    const fbConfig = JSON.parse(fs.readFileSync(FIREBASE_CONFIG_FILE, 'utf-8'));
    const fbApp = initializeApp(fbConfig, 'monkeychat-server');
    serverDb = initializeFirestore(
      fbApp,
      {
        experimentalForceLongPolling: true,
      },
      fbConfig.firestoreDatabaseId
    );
  }
} catch (err) {
  console.error('Failed to init server Firestore:', err);
}

function extractMsgCreatedAtMs(messageId: string, createdAtVal: unknown): number {
  const match = /^msg_(\d{10,15})_/.exec(messageId);
  if (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  if (createdAtVal instanceof Timestamp) {
    return createdAtVal.toMillis();
  }
  if (
    createdAtVal &&
    typeof createdAtVal === 'object' &&
    'seconds' in createdAtVal &&
    typeof (createdAtVal as { seconds: number }).seconds === 'number'
  ) {
    return (createdAtVal as { seconds: number }).seconds * 1000;
  }
  return Date.now();
}

async function pushRoomToFirestore(roomCode: string): Promise<void> {
  if (!serverDb) return;
  const code = roomCode.trim().toUpperCase();
  const room = store.rooms[code];
  if (!room) return;

  try {
    const roomRef = doc(serverDb, 'rooms', code);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) {
      await setDoc(roomRef, {
        roomCode: code,
        ownerUid: room.ownerUid || `browser_${room.ownerUsername}`,
        ownerUsername: room.ownerUsername,
        ownerDisplayName: room.ownerDisplayName,
        ownerAvatarId: room.ownerAvatarId,
        status: room.status || 'active',
        isLocked: !!room.isLocked,
        passwordHash: room.passwordHash || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(
        roomRef,
        {
          isLocked: !!room.isLocked,
          passwordHash: room.passwordHash || '',
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    const ownerAcc = store.accounts[room.ownerUsername];
    if (ownerAcc) {
      const accRef = doc(serverDb, 'accounts', ownerAcc.usernameId);
      const accSnap = await getDoc(accRef);
      if (!accSnap.exists()) {
        await setDoc(accRef, {
          usernameId: ownerAcc.usernameId,
          username: ownerAcc.username,
          passwordHash: ownerAcc.passwordHash,
          securityQuestion: ownerAcc.securityQuestion,
          securityAnswerHash: ownerAcc.securityAnswerHash,
          displayName: ownerAcc.displayName,
          gender: ownerAcc.gender,
          avatarId: ownerAcc.avatarId,
          roomCode: code,
          ownerUid: ownerAcc.ownerUid || `browser_${ownerAcc.usernameId}`,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    const roomMembers = Object.values(store.members[code] || {});
    for (const m of roomMembers) {
      const memberRef = doc(serverDb, 'rooms', code, 'members', m.memberId);
      const memberSnap = await getDoc(memberRef);
      if (!memberSnap.exists()) {
        const uid = m.userUid || `browser_${m.memberId}`;
        const memberUids = Array.from(
          new Set([uid, ...(Array.isArray(m.memberUids) ? m.memberUids : [])])
        )
          .filter((u) => typeof u === 'string' && u.length > 0 && u.length <= 128)
          .slice(0, 10);
        await setDoc(memberRef, {
          memberId: m.memberId,
          roomCode: code,
          userUid: uid,
          username: m.username,
          displayName: m.displayName,
          gender: m.gender,
          avatarId: m.avatarId,
          memberUids: memberUids.length > 0 ? memberUids : [uid],
          joinedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    const roomMsgs = store.messages[code] || [];
    for (const msg of roomMsgs) {
      const msgRef = doc(serverDb, 'rooms', code, 'messages', msg.messageId);
      const msgSnap = await getDoc(msgRef);
      if (!msgSnap.exists()) {
        const sUid = msg.senderUid || `browser_${msg.senderUsername}`;
        const memberUids = Array.from(
          new Set([
            sUid,
            ...(Array.isArray(msg.memberUids) ? msg.memberUids : []),
          ])
        )
          .filter((u) => typeof u === 'string' && u.length > 0 && u.length <= 128)
          .slice(0, 10);
        await setDoc(msgRef, {
          messageId: msg.messageId,
          roomCode: code,
          senderUid: sUid,
          senderUsername: msg.senderUsername,
          senderDisplayName: msg.senderDisplayName,
          senderAvatarId: msg.senderAvatarId,
          text: msg.text.slice(0, 1000),
          memberUids: memberUids.length > 0 ? memberUids : [sUid],
          createdAt: serverTimestamp(),
        });
      }
    }
  } catch {
    // Ignore transient Firestore sync errors
  }
}

async function pullRoomFromFirestore(roomCode: string): Promise<void> {
  if (!serverDb) return;
  const code = roomCode.trim().toUpperCase();
  let changed = false;

  try {
    const roomSnap = await getDoc(doc(serverDb, 'rooms', code));
    if (roomSnap.exists()) {
      const rData = roomSnap.data();
      if (!store.rooms[code]) {
        store.rooms[code] = {
          roomCode: code,
          ownerUid: rData.ownerUid,
          ownerUsername: rData.ownerUsername,
          ownerDisplayName: rData.ownerDisplayName,
          ownerAvatarId: rData.ownerAvatarId,
          status: rData.status || 'active',
          isLocked: !!rData.isLocked,
          passwordHash: rData.passwordHash || '',
        };
        changed = true;
      } else {
        if (
          store.rooms[code].isLocked !== !!rData.isLocked ||
          store.rooms[code].passwordHash !== (rData.passwordHash || '')
        ) {
          store.rooms[code].isLocked = !!rData.isLocked;
          store.rooms[code].passwordHash = rData.passwordHash || '';
          changed = true;
        }
      }
    }

    const membersSnap = await getDocs(
      collection(serverDb, 'rooms', code, 'members')
    );
    if (!store.members[code]) {
      store.members[code] = {};
    }
    membersSnap.docs.forEach((d) => {
      const mData = d.data();
      if (mData && mData.memberId) {
        const existing = store.members[code][mData.memberId];
        if (
          !existing ||
          existing.displayName !== mData.displayName ||
          existing.avatarId !== mData.avatarId
        ) {
          store.members[code][mData.memberId] = {
            memberId: mData.memberId,
            roomCode: code,
            userUid: mData.userUid,
            username: mData.username,
            displayName: mData.displayName,
            gender: mData.gender,
            avatarId: mData.avatarId,
            memberUids: Array.isArray(mData.memberUids)
              ? mData.memberUids
              : [mData.userUid],
            joinedAtMs: existing?.joinedAtMs || Date.now(),
          };
          changed = true;
        }
      }
    });

    const msgsSnap = await getDocs(
      collection(serverDb, 'rooms', code, 'messages')
    );
    if (!Array.isArray(store.messages[code])) {
      store.messages[code] = [];
    }
    const existingMsgIds = new Set(store.messages[code].map((m) => m.messageId));
    msgsSnap.docs.forEach((d) => {
      const msgData = d.data();
      const msgId = msgData.messageId || d.id;
      if (msgData && msgData.text && !existingMsgIds.has(msgId)) {
        store.messages[code].push({
          messageId: msgId,
          roomCode: code,
          senderUid: msgData.senderUid || 'anonymous',
          senderUsername: msgData.senderUsername || 'guest',
          senderDisplayName:
            msgData.senderDisplayName || msgData.senderName || 'Guest',
          senderAvatarId: msgData.senderAvatarId || 'jp_neutral_1',
          text: msgData.text,
          memberUids: Array.isArray(msgData.memberUids)
            ? msgData.memberUids
            : [msgData.senderUid || 'anonymous'],
          createdAtMs: extractMsgCreatedAtMs(msgId, msgData.createdAt),
        });
        existingMsgIds.add(msgId);
        changed = true;
      }
    });

    if (changed) {
      store.messages[code].sort((a, b) => a.createdAtMs - b.createdAtMs);
      saveStore();
    }
  } catch {
    // Ignore transient Firestore pull errors
  }
}

// On startup, push any pre-existing rooms/accounts/messages from .monkeychat-data.json to Cloud Firestore
async function syncInitialStoreWithFirestore(): Promise<void> {
  for (const roomCode of Object.keys(store.rooms)) {
    await pushRoomToFirestore(roomCode);
    await pullRoomFromFirestore(roomCode);
  }
}

async function startServer() {
  syncInitialStoreWithFirestore();

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Sync client localStorage state to server and Firestore
  app.post('/api/monkeychat/sync-local', async (req, res) => {
    const { accounts, rooms, members, messages } =
      req.body as Partial<ServerStore>;
    let changed = false;
    const touchedRooms = new Set<string>();

    if (accounts && typeof accounts === 'object') {
      for (const [id, acc] of Object.entries(accounts)) {
        if (acc && acc.usernameId) {
          const existing = store.accounts[id];
          if (
            !existing ||
            (acc.updatedAtMs || 0) >= (existing.updatedAtMs || 0)
          ) {
            store.accounts[id] = acc;
            changed = true;
          }
          if (acc.roomCode) {
            touchedRooms.add(acc.roomCode.trim().toUpperCase());
          }
        }
      }
    }

    if (rooms && typeof rooms === 'object') {
      for (const [code, room] of Object.entries(rooms)) {
        if (room && room.roomCode) {
          const upper = code.trim().toUpperCase();
          store.rooms[upper] = { ...room, roomCode: upper };
          touchedRooms.add(upper);
          changed = true;
        }
      }
    }

    if (members && typeof members === 'object') {
      for (const [roomCode, roomMembers] of Object.entries(members)) {
        const upper = roomCode.trim().toUpperCase();
        touchedRooms.add(upper);
        if (!store.members[upper]) {
          store.members[upper] = {};
        }
        if (roomMembers && typeof roomMembers === 'object') {
          for (const [memberId, member] of Object.entries(roomMembers)) {
            if (member && member.memberId) {
              store.members[upper][memberId] = {
                ...member,
                roomCode: upper,
              };
              changed = true;
            }
          }
        }
      }
    }

    if (messages && typeof messages === 'object') {
      for (const [roomCode, roomMsgs] of Object.entries(messages)) {
        const upper = roomCode.trim().toUpperCase();
        touchedRooms.add(upper);
        if (!Array.isArray(store.messages[upper])) {
          store.messages[upper] = [];
        }
        if (Array.isArray(roomMsgs)) {
          const existingIds = new Set(
            store.messages[upper].map((m) => m.messageId)
          );
          for (const msg of roomMsgs) {
            if (msg && msg.messageId && !existingIds.has(msg.messageId)) {
              store.messages[upper].push({ ...msg, roomCode: upper });
              existingIds.add(msg.messageId);
              changed = true;
            }
          }
          store.messages[upper].sort((a, b) => a.createdAtMs - b.createdAtMs);
        }
      }
    }

    if (changed) {
      saveStore();
    }

    for (const rCode of touchedRooms) {
      await pushRoomToFirestore(rCode);
      await pullRoomFromFirestore(rCode);
    }

    res.json({
      ok: true,
      rooms: store.rooms,
      members: store.members,
      messages: store.messages,
    });
  });

  // Ensure an active logged-in account's room and member record exist on server & Firestore
  app.post('/api/monkeychat/ensure-room', async (req, res) => {
    const { account } = req.body as { account?: StoredAccount };
    if (!account || !account.roomCode || !account.usernameId) {
      res.status(400).json({ error: 'Invalid account payload' });
      return;
    }

    const code = account.roomCode.trim().toUpperCase();
    if (!store.rooms[code]) {
      store.rooms[code] = {
        roomCode: code,
        ownerUid: account.ownerUid || `browser_${account.usernameId}`,
        ownerUsername: account.usernameId,
        ownerDisplayName: account.displayName,
        ownerAvatarId: account.avatarId,
        status: 'active',
      };
    } else if (store.rooms[code].ownerUsername === account.usernameId) {
      store.rooms[code].ownerDisplayName = account.displayName;
      store.rooms[code].ownerAvatarId = account.avatarId;
    }

    if (!store.members[code]) {
      store.members[code] = {};
    }
    store.members[code][account.usernameId] = {
      memberId: account.usernameId,
      roomCode: code,
      userUid: account.ownerUid || `browser_${account.usernameId}`,
      username: account.username,
      displayName: account.displayName,
      gender: account.gender,
      avatarId: account.avatarId,
      memberUids: [account.ownerUid || `browser_${account.usernameId}`],
      joinedAtMs:
        store.members[code][account.usernameId]?.joinedAtMs || Date.now(),
    };

    saveStore();
    await pushRoomToFirestore(code);
    await pullRoomFromFirestore(code);

    res.json({
      ok: true,
      room: store.rooms[code],
      members: Object.values(store.members[code] || {}),
      messages: store.messages[code] || [],
    });
  });

  // Register account on server & Firestore
  app.post('/api/monkeychat/accounts/register', async (req, res) => {
    const { account, room, member } = req.body as {
      account: StoredAccount;
      room: StoredRoom;
      member: StoredMember;
    };

    if (!account || !account.usernameId || !room || !room.roomCode) {
      res.status(400).json({ error: 'Missing registration fields.' });
      return;
    }

    if (store.accounts[account.usernameId]) {
      res.status(409).json({
        error:
          'That username is already registered. Please sign in or choose another username.',
      });
      return;
    }

    const code = room.roomCode.trim().toUpperCase();
    store.accounts[account.usernameId] = { ...account, roomCode: code };
    store.rooms[code] = { ...room, roomCode: code };
    if (!store.members[code]) {
      store.members[code] = {};
    }
    store.members[code][account.usernameId] = {
      ...member,
      roomCode: code,
    };
    if (!store.messages[code]) {
      store.messages[code] = [];
    }

    saveStore();
    await pushRoomToFirestore(code);

    res.json({ ok: true, account: store.accounts[account.usernameId] });
  });

  // Lookup account for login or recovery
  app.get('/api/monkeychat/accounts/:usernameId', async (req, res) => {
    const usernameId = req.params.usernameId.trim().toLowerCase();
    let acc = store.accounts[usernameId];

    if (!acc && serverDb) {
      try {
        const snap = await getDoc(doc(serverDb, 'accounts', usernameId));
        if (snap.exists()) {
          const d = snap.data();
          acc = {
            usernameId: d.usernameId,
            username: d.username,
            passwordHash: d.passwordHash,
            securityQuestion: d.securityQuestion,
            securityAnswerHash: d.securityAnswerHash,
            displayName: d.displayName,
            gender: d.gender,
            avatarId: d.avatarId,
            roomCode: d.roomCode,
            ownerUid: d.ownerUid,
            storageMode: String(d.ownerUid).startsWith('browser_')
              ? 'browser'
              : 'gmail',
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
          };
          store.accounts[usernameId] = acc;
          saveStore();
        }
      } catch {
        // Ignore Firestore lookup error
      }
    }

    if (!acc) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }
    res.json({ account: acc });
  });

  // Update account (password reset, random identity, or Gmail bind)
  app.patch('/api/monkeychat/accounts/:usernameId', async (req, res) => {
    const usernameId = req.params.usernameId.trim().toLowerCase();
    const existing = store.accounts[usernameId];
    if (!existing) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }

    const updates = req.body as Partial<StoredAccount> & {
      activeRoomCode?: string;
    };
    const updated: StoredAccount = {
      ...existing,
      ...updates,
      usernameId: existing.usernameId,
      roomCode: existing.roomCode,
      updatedAtMs: Date.now(),
    };
    store.accounts[usernameId] = updated;

    // Also update owned room & member records if identity changed
    const ownCode = existing.roomCode;
    if (store.rooms[ownCode]) {
      store.rooms[ownCode].ownerDisplayName = updated.displayName;
      store.rooms[ownCode].ownerAvatarId = updated.avatarId;
    }
    for (const rCode of Object.keys(store.members)) {
      if (store.members[rCode]?.[usernameId]) {
        store.members[rCode][usernameId] = {
          ...store.members[rCode][usernameId],
          displayName: updated.displayName,
          gender: updated.gender,
          avatarId: updated.avatarId,
        };
      }
    }

    saveStore();
    res.json({ ok: true, account: updated });
  });

  // Lock or unlock room with password
  app.post('/api/monkeychat/rooms/:roomCode/lock', async (req, res) => {
    const code = req.params.roomCode.trim().toUpperCase();
    const { isLocked, passwordHash, ownerUsername } = req.body as {
      isLocked?: boolean;
      passwordHash?: string;
      ownerUsername?: string;
    };

    await pullRoomFromFirestore(code);
    const room = store.rooms[code];
    if (!room) {
      res.status(404).json({ error: 'Room not found.' });
      return;
    }

    if (ownerUsername && room.ownerUsername !== ownerUsername) {
      res
        .status(403)
        .json({ error: 'Only the room owner can change lock settings.' });
      return;
    }

    room.isLocked = !!isLocked;
    room.passwordHash = isLocked ? (passwordHash || '') : '';
    saveStore();
    await pushRoomToFirestore(code);

    res.json({ ok: true, room });
  });

  // Get room details
  app.get('/api/monkeychat/rooms/:roomCode', async (req, res) => {
    const code = req.params.roomCode.trim().toUpperCase();
    await pullRoomFromFirestore(code);
    const room = store.rooms[code];
    if (!room || room.status === 'archived') {
      res
        .status(404)
        .json({ error: 'There is no existing room for that code.' });
      return;
    }
    res.json({ room });
  });

  // Join room by code
  app.post('/api/monkeychat/rooms/:roomCode/join', async (req, res) => {
    const code = req.params.roomCode.trim().toUpperCase();
    const { account, roomPasswordHash } = req.body as {
      account?: StoredAccount;
      roomPasswordHash?: string;
    };

    await pullRoomFromFirestore(code);

    const room = store.rooms[code];
    if (!room || room.status === 'archived') {
      res
        .status(404)
        .json({ error: 'There is no existing room for that code.' });
      return;
    }

    // If room is locked and joining user is not owner, enforce password check
    const isOwner =
      account &&
      (account.usernameId === room.ownerUsername ||
        account.ownerUid === room.ownerUid);

    if (room.isLocked && !isOwner) {
      if (!roomPasswordHash || roomPasswordHash !== room.passwordHash) {
        res.status(403).json({
          error: 'ROOM_LOCKED',
          message: 'Room is locked. Valid password required.',
          isLocked: true,
        });
        return;
      }
    }

    if (account && account.usernameId) {
      if (!store.members[code]) {
        store.members[code] = {};
      }
      const existingMember = store.members[code][account.usernameId];
      const userUid = account.ownerUid || `browser_${account.usernameId}`;
      const memberUids = Array.from(
        new Set([
          userUid,
          room.ownerUid,
          ...(existingMember?.memberUids || []),
        ])
      ).slice(0, 10);

      store.members[code][account.usernameId] = {
        memberId: account.usernameId,
        roomCode: code,
        userUid,
        username: account.username,
        displayName: account.displayName,
        gender: account.gender,
        avatarId: account.avatarId,
        memberUids,
        joinedAtMs: existingMember?.joinedAtMs || Date.now(),
      };
      saveStore();
      await pushRoomToFirestore(code);
    }

    res.json({
      room,
      members: Object.values(store.members[code] || {}),
      messages: store.messages[code] || [],
    });
  });

  // Post message to room
  app.post('/api/monkeychat/rooms/:roomCode/messages', async (req, res) => {
    const code = req.params.roomCode.trim().toUpperCase();
    const { message } = req.body as { message?: StoredMessage };

    if (!message || !message.messageId || !message.text) {
      res.status(400).json({ error: 'Invalid message payload.' });
      return;
    }

    if (!store.messages[code]) {
      store.messages[code] = [];
    }

    if (!store.messages[code].some((m) => m.messageId === message.messageId)) {
      store.messages[code].push({
        ...message,
        roomCode: code,
      });
      store.messages[code].sort((a, b) => a.createdAtMs - b.createdAtMs);
      saveStore();
    }

    await pushRoomToFirestore(code);

    res.json({ ok: true, messages: store.messages[code] });
  });

  // Real-time room sync endpoint (pulls latest from Firestore too so cross-instance rooms/messages are always synced)
  app.get('/api/monkeychat/rooms/:roomCode/sync', async (req, res) => {
    const code = req.params.roomCode.trim().toUpperCase();
    await pullRoomFromFirestore(code);

    const room = store.rooms[code] || null;
    const members = Object.values(store.members[code] || {}).sort(
      (a, b) => a.joinedAtMs - b.joinedAtMs
    );
    const messages = (store.messages[code] || []).sort(
      (a, b) => a.createdAtMs - b.createdAtMs
    );

    res.json({
      room,
      members,
      messages,
    });
  });

  // Secure Gemini AI chat endpoint for @bot messages
  app.post('/api/chat', async (req, res) => {
    try {
      const { history = [], message = '' } = req.body as {
        history?: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
        message?: string;
      };
      const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        history,
      });
      const response = await chat.sendMessage({ message });
      res.json({ text: response.text || '' });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'AI request failed',
      });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MonkeyChat server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
