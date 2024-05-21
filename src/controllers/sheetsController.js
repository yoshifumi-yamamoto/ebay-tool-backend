const { readFromSheet, saveItems } = require('../services/sheetsService');
const { parse, format, isValid } = require('date-fns'); 

async function getLastRowInColumn(column) {
  const rows = await readFromSheet(`${column}:${column}`);
  return rows.length + 1; // +1 to include the header row in the count
}

// 日付フォーマットをチェックし、適切な形式に変換する関数
function parseDate(dateString) {
  if (!dateString || dateString.trim() === '') return null; // 空文字列の場合はnullを返す
  try {
      const parsedDate = parse(dateString, 'MM/dd', new Date());
      if (isValid(parsedDate)) {
          return format(parsedDate, 'yyyy-MM-dd'); // ISO 8601形式で返す
      }
      console.error('Invalid date format:', dateString);
      return null;
  } catch (error) {
      console.error('Error parsing date:', error);
      return null;
  }
}


async function syncSheetToSupabase(req, res) {
    try {
        // ヘッダー行を読み取る
        const headers = await readFromSheet('A2:V2');
        const headerMap = {};
        headers[0].forEach((header, index) => {
            headerMap[header.trim()] = index;
        });

        // 必要な列を確認
        const requiredHeaders = ['商品タイトル', '仕入れURL', '仕入価格', 'eBay URL', '目安送料', 'リサーチ担当', '出品担当', '出品作業日', 'リサーチ作業日'];
        for (let header of requiredHeaders) {
            if (!headerMap.hasOwnProperty(header)) {
                throw new Error(`Missing required header: ${header}`);
            }
        }

        // データ行を読み取る
        const lastRow = await getLastRowInColumn('C');
        console.log("lastRow", lastRow)
        // データ行を読み取る（C列の最後の行まで）
        const rows = await readFromSheet(`A3:V${lastRow}`);
        // 空行をフィルタリング
        const itemsFromSheet = rows
            .filter(row => row && row.length >= requiredHeaders.length && row[headerMap['eBay URL']]) // 空行や不完全な行、eBay URLが空白の行を除外
            .map(row => {
          const title = row[headerMap['商品タイトル']] || '';
          const stocking_url = row[headerMap['仕入れURL']] || '';
          const cost_price = row[headerMap['仕入価格']] || '';
          const ebay_url = row[headerMap['eBay URL']] || '';
          const shipping_cost = row[headerMap['目安送料']] || '';
          const researcher = row[headerMap['リサーチ担当']] || '';
          const exhibitor = row[headerMap['出品担当']] || '';
          const exhibit_date = parseDate(row[headerMap['出品作業日(exhibit_date)']]);
          const research_date = parseDate(row[headerMap['リサーチ作業日(research_date)']]);
          const formattedShippingPrice = parseInt(shipping_cost.replace(/[^0-9]/g, '')) || 0; // ¥や,を除去
          const formattedCostPrice = parseInt(cost_price.replace(/[^0-9]/g, '')) || 0; // ¥や,を除去
          const ebay_item_id_match = ebay_url.match(/\/(\d+)(?:[\/?]|$)/);
          const ebay_item_id = ebay_item_id_match ? ebay_item_id_match[1] : '';

            return {
              title,
              stocking_url,
              cost_price: formattedCostPrice,
              ebay_item_id,
              shipping_cost: formattedShippingPrice,
              researcher,
              exhibitor,
              exhibit_date,
              research_date,
              ebay_user_id: 'yoshyama13'
            };
        });

        await saveItems(itemsFromSheet);
        res.status(200).send('Items successfully saved to Supabase');
    } catch (error) {
        console.error('Error syncing sheet to Supabase:', error.message);
        res.status(500).send(`Error syncing sheet to Supabase: ${error.message}`);
    }
}

module.exports = {
    syncSheetToSupabase
};