const supabase = require('../supabaseClient');

exports.listWebhooks = async (req, res) => {
    const accountId = req.query.accountId;
    if (!accountId) {
        return res.status(400).json({ error: 'accountId is required' });
    }
    const { data, error } = await supabase
        .from('webhooks')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false });
    if (error) {
        console.error('Failed to fetch webhooks:', error.message);
        return res.status(500).json({ error: 'Failed to fetch webhooks' });
    }
    return res.json(data || []);
};

exports.createWebhook = async (req, res) => {
    const { accountId, url, is_active = true, event_type, event } = req.body || {};
    const eventType = event_type || event; // allow both keys
    if (!accountId || !url || !eventType) {
        return res.status(400).json({ error: 'accountId, url, and event_type are required' });
    }
    const payload = {
        account_id: accountId,
        url,
        is_active,
        event_type: eventType
    };
    const { data, error } = await supabase
        .from('webhooks')
        .insert([payload])
        .select()
        .single();
    if (error) {
        console.error('Failed to create webhook:', error.message);
        return res.status(500).json({ error: 'Failed to create webhook' });
    }
    return res.status(201).json(data);
};
