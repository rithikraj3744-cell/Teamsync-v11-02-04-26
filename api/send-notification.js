// /api/send-notification.js
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { toIds, title, body, type, extra } = req.body || {};

    if (!Array.isArray(toIds) || !toIds.length) {
      return res.status(400).json({ error: 'toIds (array) is required' });
    }
    if (!title || !body) {
      return res.status(400).json({ error: 'title and body are required' });
    }

    const tokenDocs = await Promise.all(
      toIds.map(id => db.collection('fcmTokens').doc(String(id)).get())
    );
    const tokens = tokenDocs
      .filter(d => d.exists && d.data().token)
      .map(d => d.data().token);

    if (!tokens.length) {
      return res.status(200).json({ sent: 0, reason: 'no registered tokens for these ids' });
    }

    const message = {
      notification: { title, body },
      data: {
        type: String(type || 'general'),
        ...(extra ? Object.fromEntries(
              Object.entries(extra).map(([k, v]) => [k, String(v)])
            ) : {})
      },
      tokens
    };

    const result = await admin.messaging().sendEachForMulticast(message);

    const deadTokenDocIds = [];
    result.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered') {
          deadTokenDocIds.push(tokens[i]);
        }
      }
    });
    if (deadTokenDocIds.length) {
      const snap = await db.collection('fcmTokens')
        .where('token', 'in', deadTokenDocIds.slice(0, 10))
        .get();
      await Promise.all(snap.docs.map(d => d.ref.delete()));
    }

    return res.status(200).json({ sent: result.successCount, failed: result.failureCount });
  } catch (err) {
    console.error('send-notification error', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};
