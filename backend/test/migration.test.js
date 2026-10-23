import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';
import UserProfile from '../src/models/UserProfile.js';
import {
  runMigration,
  verifyIndexSpec,
  checkConversationInvariants,
  repairConversation,
  ensureUniqueIndexes
} from '../scripts/migrate-message-sequences.js';

describe('Checkpoint 1 — Message Sequence Migration & Index Verification', () => {
  let userA, userB;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    // Drop all custom indexes on Message to ensure pristine state
    try {
      await Message.collection.dropIndexes();
    } catch (_) {}

    userA = await UserProfile.create({
      firebaseUid: 'test-user-a',
      email: 'usera@test.com',
      displayName: 'User A',
      role: 'user',
      accountStatus: 'active'
    });

    userB = await UserProfile.create({
      firebaseUid: 'test-user-b',
      email: 'userb@test.com',
      displayName: 'User B',
      role: 'user',
      accountStatus: 'active'
    });
  });

  it('1. Successfully backfills legacy messages with seq and clientMessageId and aligns lastSeq', async () => {
    const conv1 = await Conversation.create({
      participants: [userA._id, userB._id],
      lastSeq: 0
    });

    const conv2 = await Conversation.create({
      participants: [userA._id, userB._id],
      lastSeq: 0
    });

    // Empty conversation
    const convEmpty = await Conversation.create({
      participants: [userA._id, userB._id],
      lastSeq: 99 // Deliberately misaligned
    });

    const now = Date.now();
    // Insert legacy messages directly into MongoDB (bypassing Mongoose validation)
    await Message.collection.insertMany([
      { conversationId: conv1._id, sender: userA._id, text: 'M1', createdAt: new Date(now) },
      { conversationId: conv1._id, sender: userB._id, text: 'M2', createdAt: new Date(now + 1000) },
      { conversationId: conv1._id, sender: userA._id, text: 'M3', createdAt: new Date(now + 2000) },
      { conversationId: conv2._id, sender: userB._id, text: 'M4', createdAt: new Date(now) },
      { conversationId: conv2._id, sender: userA._id, text: 'M5', createdAt: new Date(now + 1000) }
    ]);

    const result = await runMigration({ mongooseInstance: mongoose });

    expect(result.success).toBe(true);
    expect(result.totalConversations).toBe(3);
    expect(result.repairedConversations).toBe(3);
    expect(result.totalMessages).toBe(5);
    expect(result.verified).toBe(true);

    // Verify Conv1
    const updatedConv1 = await Conversation.findById(conv1._id);
    expect(updatedConv1.lastSeq).toBe(3);
    const msgs1 = await Message.find({ conversationId: conv1._id }).sort({ seq: 1 });
    expect(msgs1).toHaveLength(3);
    expect(msgs1.map(m => m.seq)).toEqual([1, 2, 3]);
    expect(msgs1[0].clientMessageId).toBe(`legacy-${msgs1[0]._id.toString()}`);
    expect(msgs1[1].clientMessageId).toBe(`legacy-${msgs1[1]._id.toString()}`);
    expect(msgs1[2].clientMessageId).toBe(`legacy-${msgs1[2]._id.toString()}`);

    // Verify Conv2
    const updatedConv2 = await Conversation.findById(conv2._id);
    expect(updatedConv2.lastSeq).toBe(2);
    const msgs2 = await Message.find({ conversationId: conv2._id }).sort({ seq: 1 });
    expect(msgs2).toHaveLength(2);
    expect(msgs2.map(m => m.seq)).toEqual([1, 2]);

    // Verify Empty Conv
    const updatedEmpty = await Conversation.findById(convEmpty._id);
    expect(updatedEmpty.lastSeq).toBe(0);

    // Verify Indexes
    const seqIdx = await verifyIndexSpec(Message.collection, { conversationId: 1, seq: 1 }, { unique: true });
    expect(seqIdx.exists).toBe(true);
    expect(seqIdx.index.unique).toBe(true);

    const clientIdx = await verifyIndexSpec(Message.collection, { conversationId: 1, clientMessageId: 1 }, { unique: true });
    expect(clientIdx.exists).toBe(true);
    expect(clientIdx.index.unique).toBe(true);
  });

  it('2. Safe and idempotent on rerun: skips already valid conversations without modifying them', async () => {
    const conv = await Conversation.create({
      participants: [userA._id, userB._id],
      lastSeq: 0
    });

    await Message.collection.insertMany([
      { conversationId: conv._id, sender: userA._id, text: 'Hello', createdAt: new Date() }
    ]);

    // Run 1: repairs
    const run1 = await runMigration({ mongooseInstance: mongoose });
    expect(run1.repairedConversations).toBe(1);
    expect(run1.skippedConversations).toBe(0);

    // Run 2: skips
    const run2 = await runMigration({ mongooseInstance: mongoose });
    expect(run2.repairedConversations).toBe(0);
    expect(run2.skippedConversations).toBe(1);
    expect(run2.totalMessages).toBe(1);
    expect(run2.verified).toBe(true);
  });

  it('3. Recovers deterministically from an interrupted run', async () => {
    const conv = await Conversation.create({
      participants: [userA._id, userB._id],
      lastSeq: 1 // Counter misaligned, simulated interruption
    });

    const id1 = new mongoose.Types.ObjectId();
    const id2 = new mongoose.Types.ObjectId();
    const id3 = new mongoose.Types.ObjectId();
    const now = Date.now();

    // Partially migrated state: msg1 has seq and clientMessageId, but msg2 and msg3 are unmigrated
    await Message.collection.insertMany([
      { _id: id1, conversationId: conv._id, sender: userA._id, text: 'M1', seq: 1, clientMessageId: 'id-1', createdAt: new Date(now) },
      { _id: id2, conversationId: conv._id, sender: userB._id, text: 'M2', createdAt: new Date(now + 1000) },
      { _id: id3, conversationId: conv._id, sender: userA._id, text: 'M3', createdAt: new Date(now + 2000) }
    ]);

    const result = await runMigration({ mongooseInstance: mongoose });
    expect(result.success).toBe(true);
    expect(result.repairedConversations).toBe(1);

    const updatedConv = await Conversation.findById(conv._id);
    expect(updatedConv.lastSeq).toBe(3);

    const msgs = await Message.find({ conversationId: conv._id }).sort({ seq: 1 });
    expect(msgs.map(m => m.seq)).toEqual([1, 2, 3]);
    expect(msgs[0].clientMessageId).toBe('id-1'); // Preserved existing valid ID
    expect(msgs[1].clientMessageId).toBe(`legacy-${id2.toString()}`);
    expect(msgs[2].clientMessageId).toBe(`legacy-${id3.toString()}`);
  });

  it('3b. Recovers safely when rerun after an interruption during the temporary-ID phase', async () => {
    const conv = await Conversation.create({
      participants: [userA._id, userB._id],
      lastSeq: 0 // Interrupted during pass 1
    });

    const now = Date.now();
    const id1 = new mongoose.Types.ObjectId();
    const id2 = new mongoose.Types.ObjectId();

    // Messages stranded in temporary offset state (e.g. from crash between Pass 1 and Pass 2)
    await Message.collection.insertMany([
      { _id: id1, conversationId: conv._id, sender: userA._id, text: 'M1', seq: 1000000001, clientMessageId: 'tmp-1-original-client-id-1', createdAt: new Date(now) },
      { _id: id2, conversationId: conv._id, sender: userB._id, text: 'M2', seq: 1000000002, clientMessageId: 'tmp-2-original-client-id-2', createdAt: new Date(now + 1000) }
    ]);

    const result = await runMigration({ mongooseInstance: mongoose });
    expect(result.success).toBe(true);
    expect(result.repairedConversations).toBe(1);

    const updatedConv = await Conversation.findById(conv._id);
    expect(updatedConv.lastSeq).toBe(2);

    const msgs = await Message.find({ conversationId: conv._id }).sort({ seq: 1 });
    expect(msgs.map(m => m.seq)).toEqual([1, 2]);
    // The original IDs were recovered cleanly, stripping the temporary prefix
    expect(msgs[0].clientMessageId).toBe('original-client-id-1');
    expect(msgs[1].clientMessageId).toBe('original-client-id-2');
  });

  it('4. Deterministically repairs duplicate clientMessageIds while preserving unique ones', async () => {
    const conv = await Conversation.create({
      participants: [userA._id, userB._id],
      lastSeq: 0
    });

    const now = Date.now();
    const id1 = new mongoose.Types.ObjectId();
    const id2 = new mongoose.Types.ObjectId();
    const id3 = new mongoose.Types.ObjectId();

    await Message.collection.insertMany([
      { _id: id1, conversationId: conv._id, sender: userA._id, text: 'A', clientMessageId: 'shared-duplicate-id', createdAt: new Date(now) },
      { _id: id2, conversationId: conv._id, sender: userB._id, text: 'B', clientMessageId: 'shared-duplicate-id', createdAt: new Date(now + 1000) },
      { _id: id3, conversationId: conv._id, sender: userA._id, text: 'C', clientMessageId: 'unique-id-789', createdAt: new Date(now + 2000) }
    ]);

    const result = await runMigration({ mongooseInstance: mongoose });
    expect(result.success).toBe(true);
    expect(result.repairedConversations).toBe(1);

    const msgs = await Message.find({ conversationId: conv._id }).sort({ seq: 1 });
    expect(msgs).toHaveLength(3);
    // First message keeps valid ID
    expect(msgs[0].clientMessageId).toBe('shared-duplicate-id');
    // Second message with duplicate ID is repaired deterministically
    expect(msgs[1].clientMessageId).toBe(`legacy-dup-${id2.toString()}`);
    // Third message keeps unique ID
    expect(msgs[2].clientMessageId).toBe('unique-id-789');

    // Confirm that the unique index allows all 3 without constraint violation
    const clientIdx = await verifyIndexSpec(Message.collection, { conversationId: 1, clientMessageId: 1 }, { unique: true });
    expect(clientIdx.exists).toBe(true);
  });

  it('5. Repairs sequence gaps and counter mismatches', async () => {
    const conv = await Conversation.create({
      participants: [userA._id, userB._id],
      lastSeq: 100 // Gross mismatch
    });

    const now = Date.now();
    await Message.collection.insertMany([
      { conversationId: conv._id, sender: userA._id, text: 'A', seq: 1, clientMessageId: 'id-1', createdAt: new Date(now) },
      { conversationId: conv._id, sender: userB._id, text: 'B', seq: 4, clientMessageId: 'id-2', createdAt: new Date(now + 1000) }, // Gap: 4 instead of 2
      { conversationId: conv._id, sender: userA._id, text: 'C', seq: 9, clientMessageId: 'id-3', createdAt: new Date(now + 2000) }  // Gap: 9 instead of 3
    ]);

    const result = await runMigration({ mongooseInstance: mongoose });
    expect(result.success).toBe(true);
    expect(result.repairedConversations).toBe(1);

    const updatedConv = await Conversation.findById(conv._id);
    expect(updatedConv.lastSeq).toBe(3);

    const msgs = await Message.find({ conversationId: conv._id }).sort({ seq: 1 });
    expect(msgs.map(m => m.seq)).toEqual([1, 2, 3]);
  });

  it('6. Fails clearly on incompatible indexes (unique: false on required unique spec)', async () => {
    // Create an incompatible index: conversationId + seq with unique: false
    await Message.collection.createIndex({ conversationId: 1, seq: 1 }, { unique: false });

    await expect(
      runMigration({ mongooseInstance: mongoose })
    ).rejects.toThrow(/Incompatible index.*exists but is not unique \(expected unique: true\)/);
  });

  it('7. Fails clearly on incompatible index key order', async () => {
    // Create an incompatible index with reversed key order: seq + conversationId
    await Message.collection.createIndex({ seq: 1, conversationId: 1 }, { unique: true });

    await expect(
      verifyIndexSpec(Message.collection, { conversationId: 1, seq: 1 }, { unique: true })
    ).rejects.toThrow(/conflicts with required key order/);
  });

  it('8. verifyIndexSpec correctly reports non-existent indexes', async () => {
    const check = await verifyIndexSpec(Message.collection, { nonExistentField: 1 });
    expect(check.exists).toBe(false);
    expect(check.index).toBeNull();
  });

  it('9. Deterministically breaks timestamp ties using _id ascending', async () => {
    const conv = await Conversation.create({
      participants: [userA._id, userB._id],
      lastSeq: 0
    });

    const fixedTime = new Date('2026-01-01T12:00:00.000Z');
    const idSmall = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
    const idLarge = new mongoose.Types.ObjectId('507f1f77bcf86cd799439022');

    // Insert in reverse _id order to test that migration sorts correctly
    await Message.collection.insertMany([
      { _id: idLarge, conversationId: conv._id, sender: userB._id, text: 'Second', createdAt: fixedTime },
      { _id: idSmall, conversationId: conv._id, sender: userA._id, text: 'First', createdAt: fixedTime }
    ]);

    await runMigration({ mongooseInstance: mongoose });

    const msgFirst = await Message.findById(idSmall);
    const msgSecond = await Message.findById(idLarge);

    expect(msgFirst.seq).toBe(1);
    expect(msgSecond.seq).toBe(2);
  });

  it('10. checkConversationInvariants catches non-integer, zero, and empty client IDs', () => {
    const conv = { lastSeq: 2 };
    const invalidMsgs = [
      { seq: 0, clientMessageId: 'id-1' },
      { seq: 2, clientMessageId: 'id-2' }
    ];
    const res = checkConversationInvariants(conv, invalidMsgs);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/invalid or out-of-order seq/);

    const emptyIdMsgs = [
      { seq: 1, clientMessageId: '   ' },
      { seq: 2, clientMessageId: 'id-2' }
    ];
    const res2 = checkConversationInvariants(conv, emptyIdMsgs);
    expect(res2.valid).toBe(false);
    expect(res2.reason).toMatch(/missing or empty clientMessageId/);
  });
});
