import Connection from '../models/Connection.js';
import UserProfile from '../models/UserProfile.js';

// Helper to get the current user profile from Firebase UID
const getCurrentProfile = async (uid) => {
  return await UserProfile.findOne({ firebaseUid: uid });
};

// Send a connection request
export const sendRequest = async (req, res) => {
  try {
    const { userId } = req.params; // Target user's UserProfile ID
    const { uid } = req.user; // Requester's Firebase UID

    const requester = await getCurrentProfile(uid);
    if (!requester) {
      return res.status(404).json({ message: 'Your profile not found' });
    }

    if (requester._id.toString() === userId) {
      return res.status(400).json({ message: 'Cannot connect to yourself' });
    }

    const recipient = await UserProfile.findById(userId);
    if (!recipient) {
      return res.status(404).json({ message: 'Target user not found' });
    }

    // Check for existing connection in either direction
    const existingConnection = await Connection.findOne({
      $or: [
        { requester: requester._id, recipient: recipient._id },
        { requester: recipient._id, recipient: requester._id }
      ]
    });

    if (existingConnection) {
      return res.status(400).json({ 
        message: 'A connection or pending request already exists between these users' 
      });
    }

    const newConnection = new Connection({
      requester: requester._id,
      recipient: recipient._id,
      status: 'pending'
    });

    await newConnection.save();

    return res.status(201).json({ message: 'Connection request sent', connection: newConnection });
  } catch (error) {
    console.error('Error sending request:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Get incoming pending requests
export const getRequests = async (req, res) => {
  try {
    const { uid } = req.user;
    const currentUser = await getCurrentProfile(uid);
    if (!currentUser) {
      return res.status(404).json({ message: 'Your profile not found' });
    }

    const requests = await Connection.find({
      recipient: currentUser._id,
      status: 'pending'
    }).populate('requester', 'displayName games inGameName playstyle communication competitiveGoals');

    return res.status(200).json(requests);
  } catch (error) {
    console.error('Error fetching incoming requests:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Get outgoing sent requests
export const getSentRequests = async (req, res) => {
  try {
    const { uid } = req.user;
    const currentUser = await getCurrentProfile(uid);
    if (!currentUser) {
      return res.status(404).json({ message: 'Your profile not found' });
    }

    const requests = await Connection.find({
      requester: currentUser._id,
      status: 'pending'
    }).populate('recipient', 'displayName games');

    return res.status(200).json(requests);
  } catch (error) {
    console.error('Error fetching sent requests:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Accept a connection request
export const acceptRequest = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { uid } = req.user;

    const currentUser = await getCurrentProfile(uid);
    if (!currentUser) {
      return res.status(404).json({ message: 'Your profile not found' });
    }

    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({ message: 'Connection request not found' });
    }

    if (connection.recipient.toString() !== currentUser._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to accept this request' });
    }

    if (connection.status !== 'pending') {
      return res.status(400).json({ message: 'Request is not pending' });
    }

    connection.status = 'accepted';
    await connection.save();

    // Add to each other's connections arrays in UserProfile
    await UserProfile.findByIdAndUpdate(connection.requester, {
      $addToSet: { connections: connection.recipient }
    });
    await UserProfile.findByIdAndUpdate(connection.recipient, {
      $addToSet: { connections: connection.requester }
    });

    return res.status(200).json({ message: 'Connection accepted', connection });
  } catch (error) {
    console.error('Error accepting request:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Reject a connection request
export const rejectRequest = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { uid } = req.user;

    const currentUser = await getCurrentProfile(uid);
    if (!currentUser) {
      return res.status(404).json({ message: 'Your profile not found' });
    }

    const connection = await Connection.findById(connectionId);
    if (!connection) {
      return res.status(404).json({ message: 'Connection request not found' });
    }

    if (connection.recipient.toString() !== currentUser._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to reject this request' });
    }

    if (connection.status !== 'pending') {
      return res.status(400).json({ message: 'Request is not pending' });
    }

    connection.status = 'rejected';
    await connection.save();

    return res.status(200).json({ message: 'Connection rejected', connection });
  } catch (error) {
    console.error('Error rejecting request:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// Get accepted connections
export const getConnections = async (req, res) => {
  try {
    const { uid } = req.user;
    const currentUser = await getCurrentProfile(uid);
    if (!currentUser) {
      return res.status(404).json({ message: 'Your profile not found' });
    }

    // Find all accepted connections involving this user
    const connections = await Connection.find({
      $or: [{ requester: currentUser._id }, { recipient: currentUser._id }],
      status: 'accepted'
    })
    .populate('requester', 'displayName games playstyle communication competitiveGoals isOnline onlineUntil')
    .populate('recipient', 'displayName games playstyle communication competitiveGoals isOnline onlineUntil');

    // Format the response so that we just return the 'other' user
    const formattedConnections = connections.map(conn => {
      const isRequester = conn.requester._id.toString() === currentUser._id.toString();
      const connectedUser = isRequester ? conn.recipient : conn.requester;
      return {
        connectionId: conn._id,
        user: connectedUser,
        connectedAt: conn.updatedAt
      };
    });

    return res.status(200).json(formattedConnections);
  } catch (error) {
    console.error('Error fetching connections:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
