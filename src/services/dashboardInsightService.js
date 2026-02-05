const axios = require('axios');
const supabase = require('../supabaseClient');
const { fetchTodayMetrics, ebayDayToUtcRange } = require('./ownerDashboardService');

const TIME_ZONE_EBAY = 'America/Los_Angeles';
const DEFAULT_MODEL = 'gpt-4.1-mini';
const MAX_RETRIES = Number(process.env.OPENAI_MAX_RETRIES) || 2;
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS) || 15000;

const SYSTEM_PROMPT = [
  'あなたはeBayビジネスの経営者ダッシュボード専用アナリストAIです。',
  '目的は「経営判断を早く・正確にする」こと。長文の解説ではなく、行動につながる示唆を出してください。',
  '',
  '制約:',
  '- 事実(入力データ)と推測(仮説)を明確に分ける。',
  '- 数値根拠を必ず添える（例：前週同曜日比、7日平均比、30日平均比）。',
  '- 不確実な場合は「追加で確認すべきデータ」を最大3つ提示して終える。',
  '- 一般論は禁止。入力データから言えることだけ言う。',
  '- 経営者向けに簡潔に書く。',
  '- 出力は必ず以下のJSONスキーマに一致させる。',
  '',
  '出力JSONスキーマ:',
  '{',
  '  "health": "good|watch|bad",',
  '  "headline": "一言結論（20文字以内）",',
  '  "anomalies": [',
  '    {',
  '      "metric": "指標名",',
  '      "signal": "何が異常か（短文）",',
  '      "evidence": ["根拠の数値を箇条書き"],',
  '      "likely_causes": ["仮説1", "仮説2"],',
  '      "checks_next": ["確認1", "確認2"],',
  '      "actions": ["今日やる1つ", "今週やる1つ"]',
  '    }',
  '  ],',
  '  "notes": ["補足があれば短く"]',
  '}',
].join('\n');

const toYmd = (date) => date.toISOString().slice(0, 10);

const getTimeZoneParts = (date, timeZone) => {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
};

const getCurrentEbayDay = () => {
  const now = new Date();
  const parts = getTimeZoneParts(now, TIME_ZONE_EBAY);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
};

const shiftDay = (ymd, diffDays) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + diffDays);
  return toYmd(date);
};

const safeDivide = (numerator, denominator) => {
  if (!denominator) return null;
  return numerator / denominator;
};

const pickMetrics = (metrics) => ({
  orders: metrics?.activity?.orders ?? 0,
  gross_sales_usd: metrics?.activity?.gross_sales_usd ?? metrics?.activity?.gross_sales ?? 0,
  earnings_after_fee_usd: metrics?.activity?.earnings_after_fee_usd ?? 0,
  fee_rate: metrics?.activity?.fee_rate ?? 0,
  profit_jpy: metrics?.activity?.profit_jpy ?? 0,
  profit_rate: metrics?.activity?.profit_rate ?? 0,
  aov_usd: metrics?.activity?.aov_usd ?? metrics?.activity?.aov ?? 0,
  est_shipping_total_jpy: metrics?.lane_a?.est_shipping_total ?? 0,
  shipping_confirmed_amount_jpy: metrics?.lane_b?.shipping_confirmed?.amount ?? 0,
  confirmed_profit_jpy: metrics?.lane_b?.confirmed_profit ?? 0,
  refund_amount: metrics?.risk?.refund_amount ?? 0,
  refund_count: metrics?.risk?.refund_count ?? 0,
  return_request_count: metrics?.risk?.return_request_count ?? 0,
});

const averageMetrics = (metrics, days) => {
  const base = pickMetrics(metrics);
  const divisor = days || 1;
  return {
    daily_average: {
      orders: base.orders / divisor,
      gross_sales_usd: base.gross_sales_usd / divisor,
      earnings_after_fee_usd: base.earnings_after_fee_usd / divisor,
      profit_jpy: base.profit_jpy / divisor,
      est_shipping_total_jpy: base.est_shipping_total_jpy / divisor,
      shipping_confirmed_amount_jpy: base.shipping_confirmed_amount_jpy / divisor,
      confirmed_profit_jpy: base.confirmed_profit_jpy / divisor,
      refund_amount: base.refund_amount / divisor,
      refund_count: base.refund_count / divisor,
      return_request_count: base.return_request_count / divisor,
    },
    rates: {
      fee_rate: base.fee_rate,
      profit_rate: base.profit_rate,
    },
  };
};

const fetchStatusCounts = async ({ userId, fromTs, toTs }) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id,status')
    .eq('user_id', userId)
    .gte('order_date', fromTs.toISOString())
    .lt('order_date', toTs.toISOString());
  if (error) {
    throw new Error(`Failed to fetch order status counts: ${error.message}`);
  }
  const rows = data || [];
  const canceledStatuses = new Set(['CANCELED', 'FULLY_REFUNDED']);
  const canceledCount = rows.filter((row) => canceledStatuses.has(row.status)).length;
  return {
    total: rows.length,
    canceled: canceledCount,
  };
};

const buildInsightMetrics = async ({ userId, date }) => {
  const baseDay = date || getCurrentEbayDay();
  const prevWeekDay = shiftDay(baseDay, -7);
  const last7Start = shiftDay(baseDay, -6);
  const last30Start = shiftDay(baseDay, -29);

  const [baseMetrics, prevWeekMetrics, last7Metrics, last30Metrics] = await Promise.all([
    fetchTodayMetrics({ userId, fromDay: baseDay, toDay: baseDay }),
    fetchTodayMetrics({ userId, fromDay: prevWeekDay, toDay: prevWeekDay }),
    fetchTodayMetrics({ userId, fromDay: last7Start, toDay: baseDay }),
    fetchTodayMetrics({ userId, fromDay: last30Start, toDay: baseDay }),
  ]);

  const { fromTs: baseFrom, toTs: baseTo } = ebayDayToUtcRange(baseDay, baseDay);
  const { fromTs: prevFrom, toTs: prevTo } = ebayDayToUtcRange(prevWeekDay, prevWeekDay);
  const { fromTs: last7From, toTs: last7To } = ebayDayToUtcRange(last7Start, baseDay);
  const { fromTs: last30From, toTs: last30To } = ebayDayToUtcRange(last30Start, baseDay);

  const [baseCounts, prevCounts, last7Counts, last30Counts] = await Promise.all([
    fetchStatusCounts({ userId, fromTs: baseFrom, toTs: baseTo }),
    fetchStatusCounts({ userId, fromTs: prevFrom, toTs: prevTo }),
    fetchStatusCounts({ userId, fromTs: last7From, toTs: last7To }),
    fetchStatusCounts({ userId, fromTs: last30From, toTs: last30To }),
  ]);

  const base = pickMetrics(baseMetrics);
  const prevWeek = pickMetrics(prevWeekMetrics);

  const baseCancelRate = safeDivide(baseCounts.canceled, baseCounts.total);
  const prevCancelRate = safeDivide(prevCounts.canceled, prevCounts.total);
  const last7CancelRate = safeDivide(last7Counts.canceled, last7Counts.total);
  const last30CancelRate = safeDivide(last30Counts.canceled, last30Counts.total);

  const baseReturnRate = safeDivide(base.return_request_count, baseCounts.total);
  const prevReturnRate = safeDivide(prevWeek.return_request_count, prevCounts.total);
  const last7ReturnRate = safeDivide(
    last7Metrics?.risk?.return_request_count ?? 0,
    last7Counts.total
  );
  const last30ReturnRate = safeDivide(
    last30Metrics?.risk?.return_request_count ?? 0,
    last30Counts.total
  );

  return {
    date: baseDay,
    metrics: {
      base,
      rates: {
        cancel_rate: baseCancelRate,
        return_rate: baseReturnRate,
      },
    },
    comparisons: {
      prev_week_same_day: {
        date: prevWeekDay,
        metrics: prevWeek,
        rates: {
          cancel_rate: prevCancelRate,
          return_rate: prevReturnRate,
        },
      },
      last_7_days_average: {
        range: { from: last7Start, to: baseDay },
        ...(() => {
          const avg = averageMetrics(last7Metrics, 7);
          return {
            ...avg,
            rates: {
              ...avg.rates,
              cancel_rate: last7CancelRate,
              return_rate: last7ReturnRate,
            },
          };
        })(),
      },
      last_30_days_average: {
        range: { from: last30Start, to: baseDay },
        ...(() => {
          const avg = averageMetrics(last30Metrics, 30);
          return {
            ...avg,
            rates: {
              ...avg.rates,
              cancel_rate: last30CancelRate,
              return_rate: last30ReturnRate,
            },
          };
        })(),
      },
    },
    segments: {
      account: null,
      category: null,
    },
    ops: {
      sla_target: null,
      late_shipment_rate: null,
    },
    notes: {
      currency: baseMetrics?.activity?.currency || 'USD',
      missing_exchange_rates: baseMetrics?.activity?.missing_exchange_rates || [],
    },
  };
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildUserPrompt = (metricsJson) => [
  '以下は本日のダッシュボード集計です。Systemのルールと出力JSONスキーマに従って、異常検知と見解を出してください。',
  '### 今日の集計JSON',
  JSON.stringify(metricsJson),
].join('\n');

const extractOutputText = (response) => {
  if (!response) return '';
  if (response.output_text) return response.output_text;
  const outputs = response.output || [];
  const segments = outputs.flatMap((item) => item?.content || []);
  return segments.map((segment) => segment?.text || '').join('');
};

const requestAiInsight = async (metricsJson) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const payload = {
    model,
    text: {
      format: { type: 'json_object' },
    },
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: buildUserPrompt(metricsJson) }],
      },
    ],
  };

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await axios.post('https://api.openai.com/v1/responses', payload, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: OPENAI_TIMEOUT_MS,
      });
      const outputText = extractOutputText(response.data);
      const parsed = JSON.parse(outputText);
      return {
        insight: parsed,
        model: response.data?.model || model,
        usage: response.data?.usage || null,
      };
    } catch (error) {
      const status = error?.response?.status;
      const data = error?.response?.data;
      if (data) {
        console.error('[dashboardInsight] OpenAI error response:', {
          status,
          data,
        });
      } else {
        console.error('[dashboardInsight] OpenAI request error:', error?.message || error);
      }
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await delay(500 * (2 ** attempt));
      }
    }
  }
  throw lastError || new Error('OpenAI request failed');
};

const logAiInsight = async ({
  userId,
  date,
  inputMetrics,
  outputInsight,
  model,
  usage,
  errorMessage,
}) => {
  try {
    const { error } = await supabase.from('ai_insights').insert([
      {
        user_id: userId,
        date,
        input_metrics_json: inputMetrics,
        output_insight_json: outputInsight,
        model,
        usage,
        error_message: errorMessage || null,
        created_at: new Date().toISOString(),
      },
    ]);
    if (error) {
      console.error('[dashboardInsight] Failed to log AI insight:', error.message);
    }
  } catch (err) {
    console.error('[dashboardInsight] Unexpected error logging AI insight:', err);
  }
};

const fetchCachedInsight = async ({ userId, date }) => {
  const { data, error } = await supabase
    .from('ai_insights')
    .select('date, output_insight_json, model, usage, created_at')
    .eq('user_id', userId)
    .eq('date', date)
    .not('output_insight_json', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[dashboardInsight] Failed to fetch cached insight:', error.message);
    return null;
  }
  return data || null;
};

const generateTodayAiInsight = async ({ userId, date }) => {
  const insightDate = date || getCurrentEbayDay();
  const inputMetrics = await buildInsightMetrics({ userId, date: insightDate });
  let outputInsight = null;
  let model = null;
  let usage = null;
  let errorMessage = null;

  try {
    const result = await requestAiInsight(inputMetrics);
    outputInsight = result.insight;
    model = result.model;
    usage = result.usage;
    return {
      insight: outputInsight,
      input_metrics: inputMetrics,
      model,
      usage,
    };
  } catch (error) {
    const status = error?.response?.status;
    const detail = error?.response?.data;
    if (detail) {
      errorMessage = `OpenAI error ${status || ''}: ${JSON.stringify(detail)}`;
    } else {
      errorMessage = error?.message || 'AI insight generation failed';
    }
    const cached = await fetchCachedInsight({ userId, date: insightDate });
    if (cached?.output_insight_json) {
      return {
        insight: cached.output_insight_json,
        input_metrics: inputMetrics,
        model: cached.model,
        usage: cached.usage,
        cached: true,
      };
    }
    throw error;
  } finally {
    await logAiInsight({
      userId,
      date: insightDate,
      inputMetrics,
      outputInsight,
      model,
      usage,
      errorMessage,
    });
  }
};

const fetchAiInsightHistory = async ({ userId, fromDay, toDay, limit = 30 }) => {
  let query = supabase
    .from('ai_insights')
    .select('date, output_insight_json, model, usage, error_message, created_at')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (fromDay) {
    query = query.gte('date', fromDay);
  }
  if (toDay) {
    query = query.lte('date', toDay);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch AI insight history: ${error.message}`);
  }
  return data || [];
};

module.exports = {
  generateTodayAiInsight,
  fetchAiInsightHistory,
};
