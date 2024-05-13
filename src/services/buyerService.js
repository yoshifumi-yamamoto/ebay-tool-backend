const supabase = require('../supabaseClient');

// 既存のバイヤー情報を取得
async function getBuyersByUserId(userId) {
  const { data, error } = await supabase
      .from('buyers')
      .select('*')
      .eq('user_id', userId);
  if (error) throw new Error('Failed to retrieve buyers: ' + error.message);
  return data;
}

async function updateBuyer (buyerId, buyerData) {
  const { data, error } = await supabase
      .from('buyers')
      .update(buyerData)
      .eq('id', buyerId);
  if (error) throw new Error('Failed to update buyer: ' + error.message);
  return data;
};

// 新しいバイヤーを作成または更新(ebayから)
async function upsertBuyer(buyerInfo) {
  // SupabaseにおけるUPSERT（挿入または更新）を試みる
  const { data, error } = await supabase
    .from('buyers')
    .upsert(buyerInfo, { onConflict: 'ebay_buyer_id', returning: 'representation' });

  if (error) {
    console.error('Failed to upsert buyer:', error.message, error.details);
    throw error;
  }

  // UPSERTした後のバイヤーデータを取得
  if (data && data.length > 0) {
    return data[0];
  } else {
    // UPSERTが成功してもデータが返ってこない場合は、明示的にデータを取得
    return await fetchBuyerByEbayId(buyerInfo.ebay_buyer_id);
  }
}


// ebay_buyer_idに基づいてバイヤー情報を取得
async function fetchBuyerByEbayId(ebayBuyerId) {
  const { data, error } = await supabase
    .from('buyers')
    .select('*')
    .eq('ebay_buyer_id', ebayBuyerId);

  if (error) {
    console.error('Failed to fetch buyer by ebay buyer id:', error.message, error.details);
    throw error;
  }

  if (data.length === 0) {
    // バイヤーが見つからない場合、新しいバイヤーを作成する
    return await createBuyer({ ebay_buyer_id: ebayBuyerId });
  } else if (data.length === 1) {
    // 期待通り1つのバイヤーが見つかった場合
    return data[0];
  } else {
    // 複数のバイヤーが見つかった場合、ログに出力して最初のバイヤーを選択
    console.warn('Multiple buyers found for the same eBay buyer ID, selecting the first.');
    return data[0];
  }
}



// 注文データとバイヤー情報を処理
async function processOrdersAndBuyers(orders) {
  for (let order of orders) {
    // バイヤー情報のアップサート（挿入または更新）
    const buyer = await upsertBuyer({
      ebay_buyer_id: order.buyer.username,
      name: order.buyer.buyerRegistrationAddress.fullName,
      // 注文データから取得するその他のバイヤー情報があればここに追加
      registered_date: new Date().toISOString() // 例: 登録日
    });

    // 注文データにバイヤーIDを追加して保存（別関数で実装）
    // saveOrderToSupabaseなどで実装
    // ...
  }
}

// 省略...

module.exports = {
  processOrdersAndBuyers,
  fetchBuyerByEbayId,
  getBuyersByUserId,
  upsertBuyer,
  updateBuyer
};
