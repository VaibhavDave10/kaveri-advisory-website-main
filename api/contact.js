// Kaveri Advisory — /api/contact
// Vercel serverless function for the "Request a demo" form.
//
// IMPORTANT: Vercel functions are stateless — each invocation can run on a
// fresh instance, and the filesystem is read-only in production. So instead
// of writing to a JSON file (like the local backend/server.js did), this
// keeps submissions in memory for the life of the running instance, which is
// fine for a lab demo / screenshots, but is NOT durable storage. For a real
// deployment you'd swap `submissions` below for a database (e.g. Vercel
// Postgres, Vercel KV, MongoDB Atlas, etc.) — the request handling logic
// below would barely change.

let submissions = [];

module.exports = (req, res) => {
  // Allow the form to call this from any origin during local testing too
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    const { name, phone, village, role, message } = req.body || {};

    if (!name || !name.trim() || !phone || !phone.trim()) {
      return res.status(400).json({
        ok: false,
        error: 'Name and phone number are required.'
      });
    }

    const submission = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      name: name.trim(),
      phone: phone.trim(),
      village: (village || '').trim(),
      role: role || 'Other',
      message: (message || '').trim(),
      receivedAt: new Date().toISOString()
    };

    submissions.push(submission);
    console.log('New demo request received:', submission);

    return res.status(201).json({
      ok: true,
      message: 'Thanks — your request has been noted. A field team member will reach out within 2 working days.',
      submission
    });
  }

  if (req.method === 'GET') {
    return res.status(200).json(submissions);
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
};
