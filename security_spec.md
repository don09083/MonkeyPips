# MonkeyChat Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants

1. **Authentication & Verification Gate**: Every read and write operation across `/accounts`, `/rooms`, `/rooms/{roomCode}/members`, and `/rooms/{roomCode}/messages` requires an authenticated, email-verified user (`request.auth != null && request.auth.token.email_verified == true`).
2. **Account Ownership & Privacy Isolation**: A document at `/accounts/{usernameId}` can only be created with `ownerUid == request.auth.uid`, and can only be read (`get`) or updated by its owner (`resource.data.ownerUid == request.auth.uid`). Listing `/accounts` is strictly forbidden (`allow list: if false`).
3. **Atomic Room Provisioning**: Creating an `/accounts/{usernameId}` document requires the corresponding permanent room `/rooms/{roomCode}` to exist after the transaction (`existsAfter`), and creating `/rooms/{roomCode}` requires both `/accounts/{ownerUsername}` and the owner's membership `/rooms/{roomCode}/members/{ownerUsername}` to exist after the transaction (`existsAfter`).
4. **Master Gate Relational Sync**:
   - Subcollection documents in `/rooms/{roomCode}/members/{memberId}` and `/rooms/{roomCode}/messages/{messageId}` require the parent `/rooms/{roomCode}` document to exist and have `status == 'active'` via `get()`.
   - Creating a message in `/rooms/{roomCode}/messages/{messageId}` additionally requires that the sender has a valid membership document `/rooms/{roomCode}/members/{senderUsername}` whose `userUid == request.auth.uid`.
5. **Terminal State Locking**: Once a `/rooms/{roomCode}` document transitions to `status == 'archived'`, all subsequent updates to that room and writes to its subcollections are rejected.
6. **Temporal & Immortal Integrity**: `createdAt` (and `joinedAt`) must equal `request.time` on creation and remain immutable on update. `updatedAt` must equal `request.time` on every write. Primary keys and foreign ownership references (`usernameId`, `roomCode`, `ownerUid`, `ownerUsername`, `userUid`, `senderUid`) are strictly immutable.
7. **Secure List Query Enforcement**: Collection listing is disabled on `/accounts` and `/rooms`. On `/rooms/{roomCode}/members` and `/rooms/{roomCode}/messages`, `allow list` enforces `request.auth.uid in resource.data.memberUids` with zero `get()` or `exists()` calls inside `list`.

---

## 2. The "Dirty Dozen" Payloads

1. **Payload 1 (Identity Spoofing on Account Creation)**:
   - Target: `CREATE /accounts/spoofed_user`
   - Payload: `{ usernameId: "spoofed_user", username: "spoofed_user", ownerUid: "victim_uid_999", ... }` (authenticated as `attacker_uid_111`).
   - Expected: `PERMISSION_DENIED` (fails `data.ownerUid == request.auth.uid`).

2. **Payload 2 (Shadow Field Injection on Account Update)**:
   - Target: `UPDATE /accounts/akira`
   - Payload: `{ ...validAccount, isAdmin: true, updatedAt: request.time }`
   - Expected: `PERMISSION_DENIED` (fails `data.keys().hasOnly(...)` and `affectedKeys().hasOnly(...)`).

3. **Payload 3 (Cross-User Credential Theft / Private Account Read)**:
   - Target: `GET /accounts/victim_user`
   - Context: Authenticated as `attacker_uid_111` where `victim_user.ownerUid == "victim_uid_999"`.
   - Expected: `PERMISSION_DENIED` (fails `existing().ownerUid == request.auth.uid`).

4. **Payload 4 (Unverified Email Token Spoof Attack)**:
   - Target: `CREATE /rooms/MC-TEST01`
   - Context: Authenticated with `email_verified: false`.
   - Expected: `PERMISSION_DENIED` (fails `isVerifiedUser()`).

5. **Payload 5 (ID Poisoning / Path Variable Overflow)**:
   - Target: `CREATE /rooms/INVALID$ROOM#CODE!WITH!SPACES`
   - Payload: Valid room fields matching invalid ID.
   - Expected: `PERMISSION_DENIED` (fails `isValidId(roomCode)` regex `^[a-zA-Z0-9_\-]+$`).

6. **Payload 6 (Orphaned Room Creation Without Atomic Account & Member)**:
   - Target: `CREATE /rooms/MC-ORPHAN1`
   - Context: Standalone write without creating `/accounts/{ownerUsername}` and `/rooms/MC-ORPHAN1/members/{ownerUsername}` in the same batch.
   - Expected: `PERMISSION_DENIED` (fails `existsAfter` atomicity checks).

7. **Payload 7 (Terminal State Bypass on Archived Room)**:
   - Target: `UPDATE /rooms/MC-ARCHIVED`
   - Context: Room already has `status == "archived"`. Owner attempts to update `ownerDisplayName`.
   - Expected: `PERMISSION_DENIED` (fails `existing().status != 'archived'`).

8. **Payload 8 (Value Poisoning on Whitelisted Update Field)**:
   - Target: `UPDATE /accounts/akira`
   - Payload: Updating `displayName` (whitelisted in identity action) with an empty string `""` or 500-character string.
   - Expected: `PERMISSION_DENIED` (fails `isValidAccount(incoming())` boundary limits `1 <= size <= 80`).

9. **Payload 9 (Master Gate Bypass: Posting Message to Non-Existent or Archived Room)**:
   - Target: `CREATE /rooms/MC-GHOST/messages/msg_1`
   - Payload: Valid message payload where `/rooms/MC-GHOST` does not exist.
   - Expected: `PERMISSION_DENIED` (fails Master Gate `exists` and `get().data.status == 'active'`).

10. **Payload 10 (Non-Member Posting Message to Active Room)**:
    - Target: `CREATE /rooms/MC-ACTIVE/messages/msg_2`
    - Context: Authenticated user has not joined `/rooms/MC-ACTIVE/members/{senderUsername}`.
    - Expected: `PERMISSION_DENIED` (fails membership check `exists` and `get().data.userUid == request.auth.uid`).

11. **Payload 11 (Array Overflow / Type Poisoning on Message `memberUids`)**:
    - Target: `CREATE /rooms/MC-ACTIVE/messages/msg_3`
    - Payload: `memberUids` containing 25 items (exceeding max bound of 10) or non-string first element `[12345]`.
    - Expected: `PERMISSION_DENIED` (fails Pillar 5 Total Array Guarding).

12. **Payload 12 (Unauthorized Unfiltered Collection Scraping / List Query)**:
    - Target: `LIST /rooms/MC-ACTIVE/messages` without `where('memberUids', 'array-contains', request.auth.uid)` or by a user not in `memberUids`.
    - Expected: `PERMISSION_DENIED` (fails Pillar 8 `request.auth.uid in existing().memberUids`).
