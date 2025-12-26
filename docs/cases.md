# ケース管理 (リターン/未着)

リターンリクエストと未着リクエストを管理するための最小構成。DDL は `db/cases.sql` にあります。

## テーブル概要
- `case_records`: ケース本体。eBay case id、種別(`RETURN`/`INR`)、ステータス、期限、担当者、メモを保持。
- `case_items`: ケースに紐づく明細。注文行との関連や返金額を記録。
- `case_events`: eBay/社内のイベントログ（バイヤーのメッセージ、こちらの返信、システム更新など）。
- `case_memos`: 社内メモの履歴。誰がいつ書いたかを残す。

### case_records 主要カラム
- `ebay_case_id`: eBay 側の ID (unique)。
- `case_type`: `RETURN` / `INR`。
- `status`: `OPEN` / `ACTION_REQUIRED` / `ESCALATED` / `CLOSED` など。
- `resolution_due_at`: 返答・解決期限。サイドバーの警告用。
- `assignee_user_id`: 担当者。`users.id` を参照。
- `memo`: 最新メモの簡易版。履歴は `case_memos` に。

### 推奨ステータス扱い
- 警告表示対象: `OPEN`, `ACTION_REQUIRED`, `ESCALATED`, `IN_PROGRESS`, `PENDING_SELLER`
- 終了: `CLOSED`, `REFUNDED`, `CANCELLED`

## よく使うクエリ例
```sql
-- 未対応ケースをバッジ表示用に取得
SELECT id, ebay_case_id, case_type, status, resolution_due_at
FROM case_records
WHERE status IN ('OPEN','ACTION_REQUIRED','ESCALATED','IN_PROGRESS','PENDING_SELLER');

-- 新規ケース作成（リターン例）
INSERT INTO case_records (
  ebay_case_id, case_type, status, account_id, order_id, buyer_id,
  reason, requested_action, expected_refund, currency_code,
  resolution_due_at, assignee_user_id, memo
) VALUES (
  '5xxxxxxxx', 'RETURN', 'OPEN', 1, 123, 45,
  'ITEM_NOT_AS_DESCRIBED', 'REFUND', 120.00, 'USD',
  now() + interval '3 day', 2, '受領確認中'
) RETURNING id;

-- メモ追加
INSERT INTO case_memos (case_id, author_user_id, body)
VALUES (10, 2, '返品ラベル送付済み');

-- 担当者とステータス更新
UPDATE case_records
SET status = 'ACTION_REQUIRED',
    assignee_user_id = 3,
    updated_at = now(),
    memo = 'バイヤーから追跡番号共有要請'
WHERE id = 10;

-- 期限順の一覧（画面表示向け）
SELECT
  c.*,
  o.order_no,
  b.buyer_username,
  u.username AS assignee_name
FROM case_records c
LEFT JOIN orders o ON o.id = c.order_id
LEFT JOIN buyers b ON b.id = c.buyer_id
LEFT JOIN users u ON u.id = c.assignee_user_id
ORDER BY c.resolution_due_at NULLS LAST, c.opened_at DESC;
```

## 運用メモ
- eBay API から取得したイベントは `case_events` にも積んでおくと監査しやすい。
- `memo` は最新サマリ、履歴は `case_memos` に残す運用を想定。
- 期限ベースの通知/警告は `resolution_due_at` を使う。未設定のケースは NULL。
