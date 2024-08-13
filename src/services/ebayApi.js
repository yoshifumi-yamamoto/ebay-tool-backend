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


async function fetchListingsByStatus(authToken, pageNumber = 1, entriesPerPage = 100) {
  try {
      const requestBody = `<?xml version="1.0" encoding="utf-8"?>
      <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
          <RequesterCredentials>
              <eBayAuthToken>${authToken}</eBayAuthToken>
          </RequesterCredentials>
          <ActiveList>
              <Sort>TimeLeft</Sort>
              <Pagination>
                  <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
                  <PageNumber>${pageNumber}</PageNumber>
              </Pagination>
          </ActiveList>
          <SoldList>
              <Include>true</Include>
              <Pagination>
                  <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
                  <PageNumber>${pageNumber}</PageNumber>
              </Pagination>
          </SoldList>
          <UnsoldList>
              <Include>true</Include>
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

      const activeList = result.GetMyeBaySellingResponse.ActiveList?.[0]?.ItemArray?.[0]?.Item || [];
      const soldList = result.GetMyeBaySellingResponse.SoldList?.[0]?.ItemArray?.[0]?.Item || [];
      const unsoldList = result.GetMyeBaySellingResponse.UnsoldList?.[0]?.ItemArray?.[0]?.Item || [];

      const totalEntries = parseInt(result.GetMyeBaySellingResponse.ActiveList?.[0]?.PaginationResult?.[0]?.TotalNumberOfEntries?.[0], 10) || 0;

      console.log(`Total entries found: ${totalEntries}`);
      console.log(`Active list count: ${activeList.length}`);
      console.log(`Sold list count: ${soldList.length}`);
      console.log(`Unsold list count: ${unsoldList.length}`);

      // ステータスをリストに応じて設定
      const listings = [
          ...activeList.map(item => ({
              itemId: item.ItemID?.[0],
              status: 'ACTIVE'
          })),
          ...soldList.map(item => ({
              itemId: item.ItemID?.[0],
              status: 'SOLD'
          })),
          ...unsoldList.map(item => ({
              itemId: item.ItemID?.[0],
              status: 'ENDED'
          }))
      ];

      console.log(`Total listings constructed: ${listings.length}`);

      return { listings, totalEntries };
  } catch (error) {
      console.error('Error fetching listings from eBay:', error.message);
      throw new Error('Failed to fetch listings from eBay');
  }
}







module.exports = {
    refreshEbayToken,
    fetchListingsByStatus,
};
