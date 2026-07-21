const { getServiceClient, sendError } = require('../lib/server-auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const id = String(req.query?.id || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({ error: 'Invalid document ID' });
    }

    const { data, error } = await getServiceClient()
      .from('shared_documents')
      .select('html_content, doc_type')
      .eq('id', id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Document not found' });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json(data);
  } catch (err) {
    return sendError(res, err, 'Shared document error:');
  }
};
