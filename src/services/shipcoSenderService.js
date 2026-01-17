const supabase = require('../supabaseClient');

const pickSenderFields = (payload = {}) => ({
  full_name: payload.full_name ?? payload.fullName ?? null,
  phone: payload.phone ?? null,
  email: payload.email ?? null,
  company: payload.company ?? null,
  country: payload.country ?? null,
  zip: payload.zip ?? null,
  province: payload.province ?? null,
  city: payload.city ?? null,
  address1: payload.address1 ?? null,
  address2: payload.address2 ?? null,
  address3: payload.address3 ?? null,
});

async function getSenderByUserId(userId) {
  const { data, error } = await supabase
    .from('shipco_senders')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    throw new Error('Failed to fetch sender: ' + error.message);
  }
  return data || null;
}

async function upsertSender(userId, payload) {
  const fields = pickSenderFields(payload);
  const { data, error } = await supabase
    .from('shipco_senders')
    .upsert(
      {
        user_id: userId,
        ...fields,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
    .select('*')
    .maybeSingle();
  if (error) {
    throw new Error('Failed to save sender: ' + error.message);
  }
  return data || null;
}

module.exports = {
  getSenderByUserId,
  upsertSender,
};
