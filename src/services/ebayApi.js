const axios = require('axios');
const xml2js = require('xml2js');
require('dotenv').config();

async function refreshEbayToken(refreshToken) {
  let queryString;
  try {
      queryString = (await import('query-string')).default;  // 動的インポートに変更
  } catch (e) {
      console.error('Failed to import query-string:', e);
      throw new Error('Failed to import query-string');
  }

  try {
      const response = await axios.post('https://api.ebay.com/identity/v1/oauth2/token', queryString.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope: 'https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/sell.inventory'
      }), {
          headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Authorization': `Basic ${Buffer.from(`${process.env.EBAY_APP_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString('base64')}`
          }
      });

      if (response.status === 200) {
          return response.data.access_token;
      } else {
          console.error('Error refreshing eBay token:', response.data);
          throw new Error('Failed to refresh eBay token');
      }
  } catch (error) {
      console.error('Error refreshing eBay token:', error.message);
      throw error;
  }
}


// async function fetchListingsByStatus(authToken, pageNumber = 1, entriesPerPage = 100) {
//   try {
//     const now = new Date();
//     const yesterday = new Date(now);
//     yesterday.setDate(now.getDate() - 1);
    
//     // 開始日時（前日00:00:00）
//     const startTime = new Date(yesterday.setUTCHours(0, 0, 0, 0)).toISOString();
//     // 終了日時（前日23:59:59）
//     const endTime = new Date(yesterday.setUTCHours(23, 59, 59, 999)).toISOString();

//     console.log("yesterday",yesterday)
    
//     const requestBody = `<?xml version="1.0" encoding="utf-8"?>
//     <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
//         <RequesterCredentials>
//             <eBayAuthToken>${authToken}</eBayAuthToken>
//         </RequesterCredentials>
//         <!-- ActiveListには終了日時を設定しない -->
//         <ActiveList>
//             <Sort>TimeLeft</Sort>
//             <Pagination>
//                 <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
//                 <PageNumber>${pageNumber}</PageNumber>
//             </Pagination>
//         </ActiveList>
//         <!-- SoldListに終了日時を設定 -->
//         <SoldList>
//             <Include>true</Include>
//             <EndTimeFrom>${startTime}</EndTimeFrom>
//             <EndTimeTo>${endTime}</EndTimeTo>
//             <Pagination>
//                 <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
//                 <PageNumber>${pageNumber}</PageNumber>
//             </Pagination>
//         </SoldList>
//         <!-- UnsoldListに終了日時を設定 -->
//         <UnsoldList>
//             <Include>true</Include>
//             <EndTimeFrom>${startTime}</EndTimeFrom>
//             <EndTimeTo>${endTime}</EndTimeTo>
//             <Pagination>
//                 <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
//                 <PageNumber>${pageNumber}</PageNumber>
//             </Pagination>
//         </UnsoldList>
//         <DetailLevel>ReturnAll</DetailLevel>
//     </GetMyeBaySellingRequest>`;
    
    

//       const response = await axios.post('https://api.ebay.com/ws/api.dll', 
//           requestBody, 
//           {
//               headers: {
//                   'Content-Type': 'text/xml',
//                   'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
//                   'X-EBAY-API-DEV-NAME': process.env.EBAY_DEV_ID,
//                   'X-EBAY-API-APP-NAME': process.env.EBAY_APP_ID,
//                   'X-EBAY-API-CERT-NAME': process.env.EBAY_CERT_ID,
//                   'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
//                   'X-EBAY-API-SITEID': '0',
//               }
//           }
//       );

//       const parser = new xml2js.Parser();
//       const result = await parser.parseStringPromise(response.data);

//       const activeList = result.GetMyeBaySellingResponse.ActiveList?.[0]?.ItemArray?.[0]?.Item || [];
//       const soldList = result.GetMyeBaySellingResponse.SoldList?.[0]?.ItemArray?.[0]?.Item || [];
//       const unsoldList = result.GetMyeBaySellingResponse.UnsoldList?.[0]?.ItemArray?.[0]?.Item || [];

//       const totalEntries = parseInt(result.GetMyeBaySellingResponse.ActiveList?.[0]?.PaginationResult?.[0]?.TotalNumberOfEntries?.[0], 10) || 0;

//       console.log(`Total entries found: ${totalEntries}`);
//       console.log(`Active list count: ${activeList.length}`);
//       console.log(`Sold list count: ${soldList.length}`);
//       console.log(`Unsold list count: ${unsoldList.length}`);

//       console.log("activeList[0]",activeList[0])
//       console.log("unsoldList[0]",unsoldList[0])

//       // ステータスをリストに応じて設定
//       const listings = [
//           ...activeList.map(item => ({
//               itemId: item.ItemID?.[0],
//               status: 'ACTIVE'
//           })),
//           ...soldList.map(item => ({
//               itemId: item.ItemID?.[0],
//               status: 'SOLD'
//           })),
//           ...unsoldList.map(item => ({
//               itemId: item.ItemID?.[0],
//               status: 'ENDED'
//           }))
//       ];

//       console.log(`Total listings constructed: ${listings.length}`);

//       return { listings, totalEntries };
//   } catch (error) {
//       console.error('Error fetching listings from eBay:', error.message);
//       throw new Error('Failed to fetch listings from eBay');
//   }
// }


async function fetchListingsByStatus(authToken, pageNumber = 1, entriesPerPage = 100) {
    try {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 9);
  
      // 開始日時（前日00:00:00）
      const startTime = new Date(yesterday.setUTCHours(0, 0, 0, 0)).toISOString();
      // 終了日時（前日23:59:59）
      const endTime = new Date(yesterday.setUTCHours(23, 59, 59, 999)).toISOString();
  
      console.log("yesterday", yesterday);
  
      const requestBody = `<?xml version="1.0" encoding="utf-8"?>
      <GetSellerListRequest xmlns="urn:ebay:apis:eBLBaseComponents">
          <RequesterCredentials>
              <eBayAuthToken>${authToken}</eBayAuthToken>
          </RequesterCredentials>
          <StartTimeFrom>${startTime}</StartTimeFrom>
          <StartTimeTo>${endTime}</StartTimeTo>
          <Pagination>
              <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
              <PageNumber>${pageNumber}</PageNumber>
          </Pagination>
          <DetailLevel>ReturnAll</DetailLevel>
      </GetSellerListRequest>`;
  
      const response = await axios.post('https://api.ebay.com/ws/api.dll', 
          requestBody, 
          {
              headers: {
                  'Content-Type': 'text/xml',
                  'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
                  'X-EBAY-API-DEV-NAME': process.env.EBAY_DEV_ID,
                  'X-EBAY-API-APP-NAME': process.env.EBAY_APP_ID,
                  'X-EBAY-API-CERT-NAME': process.env.EBAY_CERT_ID,
                  'X-EBAY-API-CALL-NAME': 'GetSellerList',
                  'X-EBAY-API-SITEID': '0', // 米国の場合
              }
          }
      );
  
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(response.data);
  
      const itemList = result.GetSellerListResponse?.ItemArray?.[0]?.Item || [];
  
      const totalEntries = parseInt(result.GetSellerListResponse?.PaginationResult?.[0]?.TotalNumberOfEntries?.[0], 10) || 0;
  
      console.log(`Total entries found: ${totalEntries}`);
      console.log(`Item list count: ${itemList.length}`);
  
      console.log("itemList[0]", itemList[0]);
  
      // ステータスを設定
      const listings = itemList.map(item => ({
          itemId: item.ItemID?.[0],
          title: item.Title?.[0],
          status: item.SellingStatus?.[0]?.ListingStatus?.[0]?.toUpperCase() // ステータスを大文字に変換
      }));
  
      console.log(`Total listings constructed: ${listings.length}`);
  
      return { listings, totalEntries };
    } catch (error) {
      console.error('Error fetching listings from eBay:', error.message);
      throw new Error('Failed to fetch listings from eBay');
    }
  }
  
  async function fetchEndedListings(authToken, pageNumber = 1, entriesPerPage = 100) {
    try {
      // 開始日（例として1週間前）
      const now = new Date();
      const oneWeekAgo = new Date(now);
      oneWeekAgo.setDate(now.getDate() - 8);

      console.log("fetchEndedListings")
  
      // ISO 8601形式に変換
      const startTime = new Date(oneWeekAgo.setUTCHours(0, 0, 0, 0)).toISOString();
      const endTime = new Date(now.setUTCHours(23, 59, 59, 999)).toISOString();
  
      const requestBody = `<?xml version="1.0" encoding="utf-8"?>
      <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
          <RequesterCredentials>
              <eBayAuthToken>${authToken}</eBayAuthToken>
          </RequesterCredentials>
          <!-- SoldListを取得 -->
          <SoldList>
              <Include>true</Include>
              <EndTimeFrom>${startTime}</EndTimeFrom>
              <EndTimeTo>${endTime}</EndTimeTo>
              <Pagination>
                  <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
                  <PageNumber>${pageNumber}</PageNumber>
              </Pagination>
          </SoldList>
          <!-- UnsoldListを取得 -->
          <UnsoldList>
              <Include>true</Include>
              <EndTimeFrom>${startTime}</EndTimeFrom>
              <EndTimeTo>${endTime}</EndTimeTo>
              <Pagination>
                  <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
                  <PageNumber>${pageNumber}</PageNumber>
              </Pagination>
          </UnsoldList>
          <DetailLevel>ReturnAll</DetailLevel>
      </GetMyeBaySellingRequest>`;
  
      const response = await axios.post('https://api.ebay.com/ws/api.dll', 
        requestBody, 
        {
          headers: {
            'Content-Type': 'text/xml',
            'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
            'X-EBAY-API-DEV-NAME': process.env.EBAY_DEV_ID,
            'X-EBAY-API-APP-NAME': process.env.EBAY_APP_ID,
            'X-EBAY-API-CERT-NAME': process.env.EBAY_CERT_ID,
            'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
            'X-EBAY-API-SITEID': '0',
          }
        }
      );
  
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(response.data);
  
      const soldList = result.GetMyeBaySellingResponse.SoldList?.[0]?.ItemArray?.[0]?.Item || [];
      const unsoldList = result.GetMyeBaySellingResponse.UnsoldList?.[0]?.ItemArray?.[0]?.Item || [];

      const totalEntries = parseInt(result.GetMyeBaySellingResponse.ActiveList?.[0]?.PaginationResult?.[0]?.TotalNumberOfEntries?.[0], 10) || 0;
  
      console.log(`Total entries found: ${totalEntries}`);

  
      // 終了したリストを作成
      const listings = [
        ...soldList.map(item => ({
          itemId: item.ItemID?.[0],
          status: 'SOLD'
        })),
        ...unsoldList.map(item => ({
          itemId: item.ItemID?.[0],
          status: 'ENDED'
        }))
      ];
  
      return { listings, totalEntries };
    } catch (error) {
      console.error('Error fetching ended listings from eBay:', error.message);
      throw new Error('Failed to fetch ended listings from eBay');
    }
  }
  




module.exports = {
    refreshEbayToken,
    fetchListingsByStatus,
    fetchEndedListings
};
