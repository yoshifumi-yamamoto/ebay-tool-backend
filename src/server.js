const app = require('./app');

// サーバ起動（デフォルトはあまり使われないポート番号）
const PORT = process.env.PORT || 4321;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
