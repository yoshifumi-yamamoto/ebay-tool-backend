require('dotenv').config();
const getEbayUserToken = () => {
  return process.env.EBAY_USER_TOKEN; // 環境変数からEBAY_USER_TOKENを取得して返す
};

module.exports = {
  getEbayUserToken
};
