const axios = require('axios');
const supabase = require('../supabaseClient');
const orderService = require('./orderService')

async function fetchItems() {
    const { data: items, error } = await supabase.from('items').select('*');
    if (error) throw new Error('Failed to fetch items: ' + error.message);
    return items;
}

function sendChatworkMessage(token, roomId, messageBody) {
    const endpoint = `https://api.chatwork.com/v2/rooms/${roomId}/messages`;
    const options = {
        method: "post",
        headers: {
            "X-ChatWorkToken": token,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        data: `body=${encodeURIComponent(messageBody)}`
    };
    return axios(endpoint, options);
}

async function createWeeklySalesMessage(userId, token, roomId) {
    const orders = await orderService.fetchLastWeekOrders(userId); // orderService.js の fetchRelevantOrders を利用
    const items = await fetchItems();

    // 商品情報をマップに変換
    let productInfoMap = {};
    items.forEach(item => {
        const itemId = item.ebay_item_id;
        // リサーチャーツールだけ弾く
        if(item.researcher !== "ツール"){
          productInfoMap[itemId] = {
            title: item.title,
            researcher: item.researcher,
            exhibitor: item.exhibitor,
            ebayURL: "https://www.ebay.com/itm/" + itemId
        };
        }
    });

    // メッセージを組み立てる
    let messageBody = "[toall]\n皆さんお疲れ様です(bow)\n先週もたくさんの注文がありましたので共有します！\n\n(*)先週売れた商品(*)\n";
    orders.forEach(order => {
        const productInfo = productInfoMap[order.line_items[0].legacyItemId];
        if (productInfo) {
            messageBody += `【${productInfo.title}】\n${productInfo.ebayURL}\nリサーチ担当: ${productInfo.researcher}さん\t出品担当: ${productInfo.exhibitor}さん\n\n`;
        }
    });

    messageBody += "\nリサーチされた方、おめでとうございます(cracker)\nまた、出品された方も丁寧な作業ありがとうございます！！\n皆さんのおかげで素晴らしい成果が得られました(clap)\nリサーチされた方は売れた商品を深掘りして、関連品や限定品・セット品など、より利益を狙える商品を探していきましょう(gogo)\n\n引き続きよろしくお願いいたします(bow)";

    await sendChatworkMessage(token, roomId, messageBody);
}

module.exports = {
    createWeeklySalesMessage,
    sendChatworkMessage
};
