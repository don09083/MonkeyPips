/**
 * Phase 0 Test Runner: Verifies that all "Dirty Dozen" payloads return PERMISSION_DENIED.
 */

export interface DirtyDozenTestCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TEST_CASES: DirtyDozenTestCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on Account Creation',
    operation: 'create',
    path: '/accounts/spoofed_user',
    auth: { uid: 'attacker_uid_111', email_verified: true },
    payload: {
      usernameId: 'spoofed_user',
      username: 'spoofed_user',
      ownerUid: 'victim_uid_999',
      passwordHash: 'a'.repeat(64),
      securityQuestion: 'What was your first pet name?',
      securityAnswerHash: 'b'.repeat(64),
      displayName: 'Sato Haruki',
      gender: 'male',
      avatarId: 'jp_male_1',
      roomCode: 'MC-SPOOF1',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Shadow Field Injection on Account Update',
    operation: 'update',
    path: '/accounts/akira',
    auth: { uid: 'owner_uid_1', email_verified: true },
    payload: {
      displayName: 'Takahashi Kenji',
      gender: 'male',
      avatarId: 'jp_male_2',
      isAdmin: true,
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Cross-User Credential Theft / Private Account Read',
    operation: 'get',
    path: '/accounts/victim_user',
    auth: { uid: 'attacker_uid_111', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Unverified Email Token Spoof Attack',
    operation: 'create',
    path: '/rooms/MC-TEST01',
    auth: { uid: 'unverified_uid', email_verified: false },
    payload: {
      roomCode: 'MC-TEST01',
      ownerUid: 'unverified_uid',
      ownerUsername: 'unverified_user',
      ownerDisplayName: 'Tanaka Ren',
      ownerAvatarId: 'jp_male_1',
      status: 'active',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'ID Poisoning / Path Variable Overflow',
    operation: 'create',
    path: '/rooms/INVALID$ROOM#CODE!',
    auth: { uid: 'owner_uid_1', email_verified: true },
    payload: {
      roomCode: 'INVALID$ROOM#CODE!',
      ownerUid: 'owner_uid_1',
      ownerUsername: 'akira',
      ownerDisplayName: 'Takahashi Kenji',
      ownerAvatarId: 'jp_male_1',
      status: 'active',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Orphaned Room Creation Without Atomic Account & Member',
    operation: 'create',
    path: '/rooms/MC-ORPHAN1',
    auth: { uid: 'owner_uid_1', email_verified: true },
    payload: {
      roomCode: 'MC-ORPHAN1',
      ownerUid: 'owner_uid_1',
      ownerUsername: 'nonexistent_account',
      ownerDisplayName: 'Takahashi Kenji',
      ownerAvatarId: 'jp_male_1',
      status: 'active',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Terminal State Bypass on Archived Room',
    operation: 'update',
    path: '/rooms/MC-ARCHIVED',
    auth: { uid: 'owner_uid_1', email_verified: true },
    payload: {
      ownerDisplayName: 'Updated Name After Archive',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Value Poisoning on Whitelisted Update Field',
    operation: 'update',
    path: '/accounts/akira',
    auth: { uid: 'owner_uid_1', email_verified: true },
    payload: {
      displayName: 'X'.repeat(250),
      gender: 'male',
      avatarId: 'jp_male_1',
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Master Gate Bypass: Posting Message to Non-Existent Room',
    operation: 'create',
    path: '/rooms/MC-GHOST/messages/msg_1',
    auth: { uid: 'owner_uid_1', email_verified: true },
    payload: {
      messageId: 'msg_1',
      roomCode: 'MC-GHOST',
      senderUid: 'owner_uid_1',
      senderUsername: 'akira',
      senderDisplayName: 'Takahashi Kenji',
      senderAvatarId: 'jp_male_1',
      text: 'Hello ghost room',
      memberUids: ['owner_uid_1'],
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Non-Member Posting Message to Active Room',
    operation: 'create',
    path: '/rooms/MC-ACTIVE/messages/msg_2',
    auth: { uid: 'intruder_uid', email_verified: true },
    payload: {
      messageId: 'msg_2',
      roomCode: 'MC-ACTIVE',
      senderUid: 'intruder_uid',
      senderUsername: 'intruder',
      senderDisplayName: 'Intruder Name',
      senderAvatarId: 'jp_male_1',
      text: 'Unauthorized message',
      memberUids: ['intruder_uid'],
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Array Overflow on Message memberUids',
    operation: 'create',
    path: '/rooms/MC-ACTIVE/messages/msg_3',
    auth: { uid: 'owner_uid_1', email_verified: true },
    payload: {
      messageId: 'msg_3',
      roomCode: 'MC-ACTIVE',
      senderUid: 'owner_uid_1',
      senderUsername: 'akira',
      senderDisplayName: 'Takahashi Kenji',
      senderAvatarId: 'jp_male_1',
      text: 'Overflow array payload',
      memberUids: Array.from({ length: 25 }, (_, i) => `uid_${i}`),
    },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Unauthorized Collection Scraping on Messages',
    operation: 'list',
    path: '/rooms/MC-ACTIVE/messages',
    auth: { uid: 'outsider_uid', email_verified: true },
    expectedResult: 'PERMISSION_DENIED',
  },
];
