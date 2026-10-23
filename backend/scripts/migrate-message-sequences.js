import mongoose from 'mongoose';
import { pathToFileURL } from 'url';
import Conversation from '../src/models/Conversation.js';
import Message from '../src/models/Message.js';

/**
 * Compares two key specifications for exact order and direction.
 */
function keysMatch(actualKeys, expectedKeys) {
  const actualProps = Object.keys(actualKeys);
  const expectedProps = Object.keys(expectedKeys);
  if (actualProps.length !== expectedProps.length) return false;
  for (let i = 0; i < expectedProps.length; i++) {
    const k = expectedProps[i];
    if (actualProps[i] !== k || actualKeys[k] !== expectedKeys[k]) {
      return false;
    }
  }
  return true;
}

/**
 * Checks whether an index has the same set of keys in a different order.
 */
function hasConflictingKeyOrder(actualKeys, expectedKeys) {
  const actualProps = Object.keys(actualKeys).sort();
  const expectedProps = Object.keys(expectedKeys).sort();
  if (actualProps.length !== expectedProps.length) return false;
  for (let i = 0; i < expectedProps.length; i++) {
    if (actualProps[i] !== expectedProps[i]) return false;
  }
  return !keysMatch(actualKeys, expectedKeys);
}

/**
 * Verifies whether an index exists matching exact key specifications and options.
 * Fails clearly if an incompatible index exists.
 *
 * @param {object} collection - MongoDB native collection
 * @param {object} expectedKeys - e.g. { conversationId: 1, seq: 1 }
 * @param {object} expectedOptions - e.g. { unique: true }
 * @returns {Promise<{ exists: boolean, index: object | null }>}
 */
export async function verifyIndexSpec(collection, expectedKeys, expectedOptions = {}) {
  const indexes = await collection.indexes();

  for (const idx of indexes) {
    if (hasConflictingKeyOrder(idx.key, expectedKeys)) {
      throw new Error(
        `Incompatible index on ${collection.collectionName}: existing index '${idx.name}' has keys ` +
        `${JSON.stringify(idx.key)} which conflicts with required key order ${JSON.stringify(expectedKeys)}`
      );
    }

    if (keysMatch(idx.key, expectedKeys)) {
      if (expectedOptions.unique === true && !idx.unique) {
        throw new Error(
          `Incompatible index on ${collection.collectionName}: index '${idx.name}' on ` +
          `${JSON.stringify(expectedKeys)} exists but is not unique (expected unique: true)`
        );
      }
      if (expectedOptions.unique === false && idx.unique) {
        throw new Error(
          `Incompatible index on ${collection.collectionName}: index '${idx.name}' on ` +
          `${JSON.stringify(expectedKeys)} exists but is unique (expected unique: false)`
        );
      }
      return { exists: true, index: idx };
    }
  }

  return { exists: false, index: null };
}

/**
 * Ensures the required compound unique indexes exist on the Message collection.
 */
export async function ensureUniqueIndexes(collection) {
  // 1. { conversationId: 1, seq: 1 } (unique: true)
  const seqCheck = await verifyIndexSpec(collection, { conversationId: 1, seq: 1 }, { unique: true });
  if (!seqCheck.exists) {
    await collection.createIndex({ conversationId: 1, seq: 1 }, { unique: true });
    const verified = await verifyIndexSpec(collection, { conversationId: 1, seq: 1 }, { unique: true });
    if (!verified.exists) {
      throw new Error(`Failed to verify { conversationId: 1, seq: 1 } unique index after creation`);
    }
  }

  // 2. { conversationId: 1, clientMessageId: 1 } (unique: true)
  const clientCheck = await verifyIndexSpec(collection, { conversationId: 1, clientMessageId: 1 }, { unique: true });
  if (!clientCheck.exists) {
    await collection.createIndex({ conversationId: 1, clientMessageId: 1 }, { unique: true });
    const verified = await verifyIndexSpec(collection, { conversationId: 1, clientMessageId: 1 }, { unique: true });
    if (!verified.exists) {
      throw new Error(`Failed to verify { conversationId: 1, clientMessageId: 1 } unique index after creation`);
    }
  }
}

/**
 * Checks all migration invariants for a single conversation and its messages.
 *
 * @param {object} conversation
 * @param {Array<object>} messages - Sorted by { createdAt: 1, _id: 1 }
 * @returns {{ valid: boolean, reason?: string }}
 */
export function checkConversationInvariants(conversation, messages) {
  const N = messages.length;

  if (N === 0) {
    if (conversation.lastSeq !== 0) {
      return { valid: false, reason: `Empty conversation has non-zero lastSeq: ${conversation.lastSeq}` };
    }
    return { valid: true };
  }

  if (conversation.lastSeq !== N) {
    return {
      valid: false,
      reason: `Conversation lastSeq (${conversation.lastSeq}) does not match message count (${N})`
    };
  }

  const clientIds = [];
  for (let i = 0; i < N; i++) {
    const msg = messages[i];

    if (typeof msg.seq !== 'number' || !Number.isInteger(msg.seq) || msg.seq !== i + 1) {
      return {
        valid: false,
        reason: `Message at index ${i} has invalid or out-of-order seq: ${msg.seq} (expected ${i + 1})`
      };
    }

    if (typeof msg.clientMessageId !== 'string' || msg.clientMessageId.trim().length === 0) {
      return {
        valid: false,
        reason: `Message at index ${i} has missing or empty clientMessageId`
      };
    }

    clientIds.push(msg.clientMessageId.trim());
  }

  const uniqueClientIds = new Set(clientIds);
  if (uniqueClientIds.size !== N) {
    return {
      valid: false,
      reason: `Duplicate clientMessageId values detected within conversation (${uniqueClientIds.size} unique vs ${N} total)`
    };
  }

  return { valid: true };
}

/**
 * Deterministically repairs a conversation's messages and lastSeq.
 * Preserves valid unique clientMessageIds and repairs duplicates/missing values.
 */
export async function repairConversation(conversation, messages) {
  const N = messages.length;

  if (N === 0) {
    await Conversation.updateOne({ _id: conversation._id }, { $set: { lastSeq: 0 } });
    return { repaired: true, messageCount: 0 };
  }

  // Sort deterministically by createdAt asc, _id asc
  const sorted = [...messages].sort((a, b) => {
    const timeDiff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a._id.toString().localeCompare(b._id.toString());
  });

  const seenClientIds = new Set();
  const plannedUpdates = [];

  for (let i = 0; i < N; i++) {
    const msg = sorted[i];
    const targetSeq = i + 1;
    let targetClientMessageId;

    if (typeof msg.clientMessageId === 'string' && msg.clientMessageId.trim().length > 0) {
      let trimmed = msg.clientMessageId.trim();
      // Safely strip any temporary repair prefixes from an interrupted previous run
      while (/^tmp-\d+-/.test(trimmed)) {
        trimmed = trimmed.replace(/^tmp-\d+-/, '');
      }

      if (!trimmed) {
        targetClientMessageId = `legacy-${msg._id.toString()}`;
      } else if (seenClientIds.has(trimmed)) {
        // Deterministic repair for duplicate legacy ID
        targetClientMessageId = `legacy-dup-${msg._id.toString()}`;
      } else {
        targetClientMessageId = trimmed;
      }
    } else {
      // Deterministic backfill for missing or empty legacy ID
      targetClientMessageId = `legacy-${msg._id.toString()}`;
    }

    seenClientIds.add(targetClientMessageId);
    plannedUpdates.push({
      _id: msg._id,
      targetSeq,
      targetClientMessageId
    });
  }

  // Two-pass update to guarantee no unique constraint collisions during renumbering
  // Pass 1: Set temporary offset
  for (const item of plannedUpdates) {
    await Message.updateOne(
      { _id: item._id },
      {
        $set: {
          seq: 1000000000 + item.targetSeq,
          clientMessageId: `tmp-${item.targetSeq}-${item.targetClientMessageId}`
        }
      }
    );
  }

  // Pass 2: Set target values
  for (const item of plannedUpdates) {
    await Message.updateOne(
      { _id: item._id },
      {
        $set: {
          seq: item.targetSeq,
          clientMessageId: item.targetClientMessageId
        }
      }
    );
  }

  // Align conversation.lastSeq
  await Conversation.updateOne({ _id: conversation._id }, { $set: { lastSeq: N } });

  // Post-repair invariant verification
  const refetchedConv = await Conversation.findById(conversation._id).lean();
  const refetchedMsgs = await Message.find({ conversationId: conversation._id })
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  const verify = checkConversationInvariants(refetchedConv, refetchedMsgs);
  if (!verify.valid) {
    throw new Error(
      `Post-repair invariant check failed for conversation ${conversation._id}: ${verify.reason}`
    );
  }

  return { repaired: true, messageCount: N };
}

/**
 * Resumable migration runner.
 *
 * @param {object} options
 * @param {mongoose.Mongoose} [options.mongooseInstance]
 * @returns {Promise<object>} Migration summary
 */
export async function runMigration({ mongooseInstance = mongoose } = {}) {
  if (mongooseInstance.connection.readyState !== 1) {
    throw new Error('Database is not connected. Migration cannot proceed.');
  }

  const messageCollection = Message.collection;

  // Pre-flight check: ensure no incompatible indexes exist before modifying data
  await verifyIndexSpec(messageCollection, { conversationId: 1, seq: 1 }, { unique: true });
  await verifyIndexSpec(messageCollection, { conversationId: 1, clientMessageId: 1 }, { unique: true });

  const conversations = await Conversation.find({}).lean();
  let totalConversations = conversations.length;
  let repairedConversations = 0;
  let skippedConversations = 0;
  let totalMessages = 0;

  for (const conv of conversations) {
    const messages = await Message.find({ conversationId: conv._id })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    totalMessages += messages.length;

    const check = checkConversationInvariants(conv, messages);
    if (check.valid) {
      skippedConversations++;
    } else {
      await repairConversation(conv, messages);
      repairedConversations++;
    }
  }

  // Create and verify unique compound indexes
  await ensureUniqueIndexes(messageCollection);

  // Final verification pass across all conversations
  for (const conv of conversations) {
    const refetchedConv = await Conversation.findById(conv._id).lean();
    const refetchedMsgs = await Message.find({ conversationId: conv._id })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    const finalCheck = checkConversationInvariants(refetchedConv, refetchedMsgs);
    if (!finalCheck.valid) {
      throw new Error(
        `Final invariant verification failed for conversation ${conv._id}: ${finalCheck.reason}`
      );
    }
  }

  // Final verification of indexes
  const finalSeqIdx = await verifyIndexSpec(messageCollection, { conversationId: 1, seq: 1 }, { unique: true });
  const finalClientIdx = await verifyIndexSpec(messageCollection, { conversationId: 1, clientMessageId: 1 }, { unique: true });

  if (!finalSeqIdx.exists || !finalClientIdx.exists) {
    throw new Error('Final index verification failed: required compound unique indexes are missing');
  }

  return {
    success: true,
    totalConversations,
    repairedConversations,
    skippedConversations,
    totalMessages,
    verified: true
  };
}

// CLI execution handling
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const run = async () => {
    try {
      if (!process.env.MONGODB_URI) {
        const dotenv = await import('dotenv');
        dotenv.config();
      }

      if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI environment variable is required');
      }

      await mongoose.connect(process.env.MONGODB_URI);
      console.log('Connected to MongoDB. Starting message sequence migration...');

      const result = await runMigration();
      console.log('Migration completed successfully:', JSON.stringify(result, null, 2));

      await mongoose.disconnect();
      process.exit(0);
    } catch (err) {
      console.error('Migration failed:', err);
      try {
        await mongoose.disconnect();
      } catch (_) {}
      process.exit(1);
    }
  };

  run();
}
