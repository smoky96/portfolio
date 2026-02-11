import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/client";
import { TRANSACTION_TYPE_LABELS, TRANSACTION_TYPE_OPTIONS } from "../constants/labels";
import { Account, Instrument, LatestQuote, Transaction, YahooLookupQuote } from "../types";
import { formatDecimal } from "../utils/format";

interface TransactionForm {
  type: string;
  account_id: number;
  counterparty_account_id?: number;
  custom_instrument_id?: number;
  instrument_symbol?: string;
  instrument_name?: string;
  instrument_id?: number;
  quantity?: number;
  price?: number;
  amount?: number;
  fee?: number;
  tax?: number;
  currency: string;
  executed_at: string;
  note?: string;
}

const SHANGHAI_TZ = "Asia/Shanghai";
const SHANGHAI_OFFSET_HOURS = 8;

const TRADE_TYPES = new Set(["BUY", "SELL"]);
const INSTRUMENT_REQUIRED_TYPES = new Set(["BUY", "SELL", "DIVIDEND"]);

const CURRENCY_OPTIONS = [
  { value: "CNY", label: "CNY - 人民币" },
  { value: "USD", label: "USD - 美元" },
  { value: "HKD", label: "HKD - 港币" },
  { value: "EUR", label: "EUR - 欧元" },
  { value: "GBP", label: "GBP - 英镑" },
  { value: "JPY", label: "JPY - 日元" },
  { value: "SGD", label: "SGD - 新加坡元" }
] as const;

const CURRENCY_COLOR_MAP: Record<string, string> = {
  CNY: "blue",
  USD: "green",
  HKD: "purple",
  EUR: "gold",
  GBP: "magenta",
  JPY: "volcano",
  SGD: "cyan"
};

const TYPE_COLOR_MAP: Record<string, string> = {
  BUY: "green",
  SELL: "volcano",
  DIVIDEND: "cyan",
  FEE: "red",
  CASH_IN: "blue",
  CASH_OUT: "orange",
  INTERNAL_TRANSFER: "purple"
};

const CSV_TEMPLATE = `type,account_id,instrument_id,counterparty_account_id,quantity,price,amount,fee,tax,currency,executed_at,executed_tz,note
CASH_IN,1,,,,,10000,0,0,CNY,2026-02-08T09:30:00+08:00,Asia/Shanghai,初始入金
BUY,2,1,,10,100,1000,1,0,CNY,2026-02-08T10:00:00+08:00,Asia/Shanghai,买入股票
INTERNAL_TRANSFER,1,,2,,,5000,0,0,CNY,2026-02-08T11:00:00+08:00,Asia/Shanghai,内部转账
`;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function normalizeDateTimeLocal(value: string): string {
  if (value.length === 16) {
    return `${value}:00`;
  }
  return value;
}

function parseDateTimeLocal(value: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } | null {
  const normalized = normalizeDateTimeLocal(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  if ([year, month, day, hour, minute, second].some((item) => Number.isNaN(item))) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

function formatUtcToDateTimeLocalByOffset(utcMs: number, offsetHours: number): string {
  const shifted = new Date(utcMs + offsetHours * 3600 * 1000);
  const year = shifted.getUTCFullYear();
  const month = pad2(shifted.getUTCMonth() + 1);
  const day = pad2(shifted.getUTCDate());
  const hour = pad2(shifted.getUTCHours());
  const minute = pad2(shifted.getUTCMinutes());
  const second = pad2(shifted.getUTCSeconds());
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

function getNowShanghaiDateTime(): string {
  return formatUtcToDateTimeLocalByOffset(Date.now(), SHANGHAI_OFFSET_HOURS);
}

function shanghaiLocalToIso(value: string): string {
  const parsed = parseDateTimeLocal(value);
  if (!parsed) {
    return new Date().toISOString();
  }
  const utcMs = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    parsed.hour - SHANGHAI_OFFSET_HOURS,
    parsed.minute,
    parsed.second
  );
  return new Date(utcMs).toISOString();
}

function isoToShanghaiLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return getNowShanghaiDateTime();
  }
  return formatUtcToDateTimeLocalByOffset(date.getTime(), SHANGHAI_OFFSET_HOURS);
}

function formatShanghaiDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: SHANGHAI_TZ
  });
}

function normalizeSymbol(value: string | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function round8(value: number): number {
  return Number(value.toFixed(8));
}

function getTypeColor(type: string): string {
  return TYPE_COLOR_MAP[type] ?? "default";
}

function getCurrencyColor(currency: string): string {
  return CURRENCY_COLOR_MAP[currency.toUpperCase()] ?? "default";
}

function resolveInstrumentTypeFromQuote(quoteType: string | null | undefined): "STOCK" | "FUND" {
  const normalized = quoteType?.trim().toUpperCase() ?? "";
  if (normalized.includes("ETF") || normalized.includes("FUND")) {
    return "FUND";
  }
  return "STOCK";
}

function resolveMarketFromLookup(symbol: string, market: string | null | undefined): string {
  const normalizedMarket = market?.trim().toUpperCase() ?? "";
  if (normalizedMarket.includes("SHANGHAI") || normalizedMarket.includes("SHENZHEN") || normalizedMarket.includes("SSE") || normalizedMarket.includes("SZSE")) {
    return "CN";
  }
  if (normalizedMarket.includes("HONG KONG") || normalizedMarket.includes("HKEX")) {
    return "HK";
  }
  if (normalizedMarket.includes("NASDAQ") || normalizedMarket.includes("NYSE") || normalizedMarket.includes("AMEX")) {
    return "US";
  }
  if (symbol.endsWith(".SS") || symbol.endsWith(".SZ")) {
    return "CN";
  }
  if (symbol.endsWith(".HK")) {
    return "HK";
  }
  return "US";
}

export default function TransactionsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [latestQuotes, setLatestQuotes] = useState<LatestQuote[]>([]);
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm<TransactionForm>();
  const [editForm] = Form.useForm<TransactionForm>();

  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [accountFilter, setAccountFilter] = useState<string>("ALL");
  const [instrumentFilter, setInstrumentFilter] = useState<string>("ALL");
  const [currencyFilter, setCurrencyFilter] = useState<string>("ALL");
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [rowActionLoadingId, setRowActionLoadingId] = useState<number | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupHint, setLookupHint] = useState("");
  const [lastLookup, setLastLookup] = useState<YahooLookupQuote | null>(null);
  const [lastQueriedSymbol, setLastQueriedSymbol] = useState("");
  const lookupRequestSeqRef = useRef(0);

  const createType = (Form.useWatch("type", form) as string | undefined) ?? "CASH_IN";
  const createAccountId = Form.useWatch("account_id", form) as number | undefined;
  const createCustomInstrumentId = Form.useWatch("custom_instrument_id", form) as number | undefined;
  const createSymbolInput = Form.useWatch("instrument_symbol", form) as string | undefined;
  const createQuantity = Form.useWatch("quantity", form) as number | undefined;
  const createPrice = Form.useWatch("price", form) as number | undefined;
  const createFee = Form.useWatch("fee", form) as number | undefined;
  const createTax = Form.useWatch("tax", form) as number | undefined;

  const isCreateTradeType = TRADE_TYPES.has(createType);
  const createNeedsInstrument = INSTRUMENT_REQUIRED_TYPES.has(createType);
  const createNeedsCounterparty = createType === "INTERNAL_TRANSFER";

  async function load() {
    setLoading(true);
    try {
      const [a, i, q, t] = await Promise.all([
        api.get<Account[]>("/accounts"),
        api.get<Instrument[]>("/instruments"),
        api.get<LatestQuote[]>("/quotes/latest"),
        api.get<Transaction[]>("/transactions")
      ]);
      setAccounts(a);
      setInstruments(i);
      setLatestQuotes(q);
      setTxs(t);
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    form.setFieldsValue({
      type: "CASH_IN",
      fee: 0,
      tax: 0,
      currency: "CNY",
      executed_at: getNowShanghaiDateTime()
    });
    void load();
  }, []);

  const accountById = useMemo(() => new Map(accounts.map((item) => [item.id, item])), [accounts]);
  const accountNameMap = useMemo(() => new Map(accounts.map((item) => [item.id, item.name])), [accounts]);
  const instrumentBySymbol = useMemo(
    () => new Map(instruments.map((item) => [item.symbol.toUpperCase(), item])),
    [instruments]
  );
  const customInstruments = useMemo(
    () =>
      instruments
        .filter((item) => item.market === "CUSTOM")
        .sort((a, b) => a.symbol.localeCompare(b.symbol, "en-US", { sensitivity: "base" })),
    [instruments]
  );
  const customInstrumentById = useMemo(() => new Map(customInstruments.map((item) => [item.id, item])), [customInstruments]);
  const instrumentNameMap = useMemo(
    () => new Map(instruments.map((item) => [item.id, `${item.symbol} ${item.name} (${item.currency})`])),
    [instruments]
  );
  const latestQuoteMap = useMemo(() => new Map(latestQuotes.map((item) => [item.instrument_id, item])), [latestQuotes]);

  const selectedCreateInstrument = useMemo(() => {
    const symbol = normalizeSymbol(createSymbolInput);
    if (!symbol) {
      return null;
    }
    return instrumentBySymbol.get(symbol) ?? null;
  }, [createSymbolInput, instrumentBySymbol]);

  async function lookupSymbolFromYahoo(symbol: string): Promise<YahooLookupQuote> {
    return api.get<YahooLookupQuote>(`/quotes/lookup?symbol=${encodeURIComponent(symbol)}`);
  }

  async function triggerYahooLookup(rawSymbol: string, forceRemote = false): Promise<YahooLookupQuote | null> {
    if (!createNeedsInstrument) {
      return null;
    }

    const symbol = normalizeSymbol(rawSymbol);
    form.setFieldValue("instrument_symbol", symbol);
    if (form.getFieldValue("custom_instrument_id")) {
      form.setFieldValue("custom_instrument_id", undefined);
    }

    if (!symbol) {
      form.setFieldValue("instrument_id", undefined);
      form.setFieldValue("instrument_name", undefined);
      setLookupHint("");
      setLookupLoading(false);
      setLastLookup(null);
      setLastQueriedSymbol("");
      return null;
    }

    if (!forceRemote && symbol === lastQueriedSymbol) {
      const cachedSymbol = normalizeSymbol(lastLookup?.matched_symbol ?? lastLookup?.symbol);
      return cachedSymbol === symbol ? lastLookup : null;
    }

    const localInstrument = instrumentBySymbol.get(symbol) ?? null;
    if (localInstrument && !forceRemote) {
      form.setFieldValue("instrument_id", localInstrument.id);
      form.setFieldValue("instrument_name", localInstrument.name);
      form.setFieldValue("currency", localInstrument.currency);
      const latest = latestQuoteMap.get(localInstrument.id);
      if (isCreateTradeType && latest?.price) {
        const currentPrice = form.getFieldValue("price");
        if (currentPrice === undefined || currentPrice === null || Number(currentPrice) <= 0) {
          form.setFieldValue("price", Number(latest.price));
        }
      }
      setLookupHint("已匹配本地标的");
      setLastQueriedSymbol(symbol);
      return null;
    }

    const requestSeq = ++lookupRequestSeqRef.current;
    setLookupLoading(true);
    setLookupHint("正在从 Yahoo 获取信息...");
    try {
      const lookup = await lookupSymbolFromYahoo(symbol);
      const currentSymbol = normalizeSymbol(form.getFieldValue("instrument_symbol"));
      if (lookupRequestSeqRef.current !== requestSeq || currentSymbol !== symbol) {
        return null;
      }

      const resolvedSymbol = normalizeSymbol(lookup.matched_symbol ?? symbol);
      const resolvedLocalInstrument = instrumentBySymbol.get(resolvedSymbol) ?? null;
      form.setFieldValue("instrument_symbol", resolvedSymbol);
      setLastLookup(lookup);
      setLastQueriedSymbol(resolvedSymbol);

      if (!lookup.found) {
        form.setFieldValue("instrument_id", undefined);
        form.setFieldValue("instrument_name", undefined);
        if (lookup.provider_status === "rate_limited") {
          setLookupHint("Yahoo 请求限流，请稍后重试");
        } else if (lookup.provider_status === "not_found") {
          setLookupHint("Yahoo 未找到该代码，请确认后重试");
        } else {
          setLookupHint(`Yahoo 查询失败：${lookup.message ?? "请稍后重试"}`);
        }
        return lookup;
      }

      form.setFieldValue("instrument_id", resolvedLocalInstrument?.id);
      form.setFieldValue("instrument_name", lookup.name ?? resolvedLocalInstrument?.name ?? resolvedSymbol);
      if (lookup.currency) {
        form.setFieldValue("currency", lookup.currency.toUpperCase());
      } else if (resolvedLocalInstrument?.currency) {
        form.setFieldValue("currency", resolvedLocalInstrument.currency);
      }
      if (isCreateTradeType && lookup.price) {
        const currentPrice = form.getFieldValue("price");
        if (currentPrice === undefined || currentPrice === null || Number(currentPrice) <= 0) {
          form.setFieldValue("price", Number(lookup.price));
        }
      }
      setLookupHint("已从 Yahoo 获取标的信息");
      return lookup;
    } catch (err) {
      const currentSymbol = normalizeSymbol(form.getFieldValue("instrument_symbol"));
      if (lookupRequestSeqRef.current === requestSeq && currentSymbol === symbol) {
        setLookupHint(`Yahoo 查询失败：${String(err)}`);
      }
      return null;
    } finally {
      if (lookupRequestSeqRef.current === requestSeq) {
        setLookupLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!createNeedsInstrument) {
      return;
    }
    if (!createCustomInstrumentId) {
      return;
    }

    const customInstrument = customInstrumentById.get(createCustomInstrumentId);
    if (!customInstrument) {
      return;
    }

    form.setFieldValue("instrument_symbol", customInstrument.symbol);
    form.setFieldValue("instrument_id", customInstrument.id);
    form.setFieldValue("instrument_name", customInstrument.name);
    form.setFieldValue("currency", customInstrument.currency);
    setLookupHint("已选择自定义标的");
    setLastLookup(null);
    setLastQueriedSymbol(customInstrument.symbol.toUpperCase());

    const latest = latestQuoteMap.get(customInstrument.id);
    if (isCreateTradeType && latest?.price) {
      const currentPrice = form.getFieldValue("price");
      if (currentPrice === undefined || currentPrice === null || Number(currentPrice) <= 0) {
        form.setFieldValue("price", Number(latest.price));
      }
    }
  }, [createNeedsInstrument, createCustomInstrumentId, customInstrumentById, form, latestQuoteMap, isCreateTradeType]);

  useEffect(() => {
    if (!createNeedsInstrument) {
      setLookupLoading(false);
      setLookupHint("");
      setLastLookup(null);
      setLastQueriedSymbol("");
      return;
    }

    const symbol = normalizeSymbol(createSymbolInput);
    if (!symbol) {
      form.setFieldValue("instrument_id", undefined);
      form.setFieldValue("instrument_name", undefined);
      setLookupLoading(false);
      setLookupHint("输入代码后按回车或点击查询");
      setLastLookup(null);
      setLastQueriedSymbol("");
      return;
    }

    if (selectedCreateInstrument) {
      form.setFieldValue("instrument_id", selectedCreateInstrument.id);
      form.setFieldValue("instrument_name", selectedCreateInstrument.name);
      form.setFieldValue("currency", selectedCreateInstrument.currency);

      const latest = latestQuoteMap.get(selectedCreateInstrument.id);
      if (isCreateTradeType && latest?.price) {
        const currentPrice = form.getFieldValue("price");
        if (currentPrice === undefined || currentPrice === null || Number(currentPrice) <= 0) {
          form.setFieldValue("price", Number(latest.price));
        }
      }
      setLookupHint("已匹配本地标的");
      return;
    }

    const lastLookupSymbol = normalizeSymbol(lastLookup?.matched_symbol ?? lastLookup?.symbol);
    if (lastLookup && lastLookup.found && lastLookupSymbol === symbol) {
      form.setFieldValue("instrument_id", undefined);
      if (!form.getFieldValue("instrument_name")) {
        form.setFieldValue("instrument_name", lastLookup.name ?? symbol);
      }
      if (lastLookup.currency) {
        form.setFieldValue("currency", lastLookup.currency.toUpperCase());
      }
      return;
    }

    form.setFieldValue("instrument_id", undefined);
    form.setFieldValue("instrument_name", undefined);
    if (!lookupLoading && (!lastLookup || lastLookupSymbol !== symbol)) {
      setLookupHint("输入代码后按回车或点击查询");
    }
  }, [createNeedsInstrument, createSymbolInput, selectedCreateInstrument, isCreateTradeType, latestQuoteMap, form, lastLookup, lookupLoading]);

  useEffect(() => {
    if (!createNeedsInstrument) {
      form.setFieldsValue({
        custom_instrument_id: undefined,
        instrument_symbol: undefined,
        instrument_name: undefined,
        instrument_id: undefined,
        quantity: undefined,
        price: undefined
      });
    }

    if (!isCreateTradeType) {
      form.setFieldsValue({ quantity: undefined, price: undefined });
    }

    if (!createNeedsCounterparty) {
      form.setFieldValue("counterparty_account_id", undefined);
    }

    if (isCreateTradeType) {
      if (form.getFieldValue("fee") === undefined || form.getFieldValue("fee") === null) {
        form.setFieldValue("fee", 0);
      }
      if (form.getFieldValue("tax") === undefined || form.getFieldValue("tax") === null) {
        form.setFieldValue("tax", 0);
      }
    } else {
      form.setFieldsValue({ fee: 0, tax: 0 });
    }
  }, [createType, createNeedsInstrument, isCreateTradeType, createNeedsCounterparty, form]);

  useEffect(() => {
    if (createNeedsInstrument) {
      return;
    }
    if (!createAccountId) {
      return;
    }
    const account = accountById.get(createAccountId);
    if (account) {
      form.setFieldValue("currency", account.base_currency);
    }
  }, [createNeedsInstrument, createAccountId, accountById, form]);

  useEffect(() => {
    if (!isCreateTradeType) {
      return;
    }
    const quantity = Number(createQuantity ?? 0);
    const price = Number(createPrice ?? 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(price) || quantity <= 0 || price <= 0) {
      form.setFieldValue("amount", undefined);
      return;
    }
    form.setFieldValue("amount", round8(quantity * price));
  }, [isCreateTradeType, createQuantity, createPrice, form]);

  const createSettlementPreview = useMemo(() => {
    if (!isCreateTradeType) {
      return null;
    }
    const principal = Number(form.getFieldValue("amount") ?? 0);
    const fee = Number(createFee ?? 0);
    const tax = Number(createTax ?? 0);
    if (!Number.isFinite(principal) || principal <= 0) {
      return null;
    }
    const settlement = createType === "SELL" ? principal - fee - tax : principal + fee + tax;
    return settlement;
  }, [isCreateTradeType, createType, createFee, createTax, form]);

  async function ensureInstrumentBySymbol(symbol: string, accountId: number, fallbackCurrency: string): Promise<Instrument | null> {
    const existing = instrumentBySymbol.get(symbol);
    if (existing) {
      return existing;
    }

    const cachedLookupSymbol = normalizeSymbol(lastLookup?.matched_symbol ?? lastLookup?.symbol);
    const lookup = cachedLookupSymbol === symbol && lastLookup ? lastLookup : await lookupSymbolFromYahoo(symbol);
    setLastLookup(lookup);
    const resolvedSymbol = normalizeSymbol(lookup.matched_symbol ?? symbol);
    form.setFieldValue("instrument_symbol", resolvedSymbol);
    setLastQueriedSymbol(resolvedSymbol);
    if (!lookup.found) {
      if (lookup.provider_status === "rate_limited") {
        setError("Yahoo 请求限流，暂时无法自动创建该标的，请稍后重试");
      } else if (lookup.provider_status === "not_found") {
        setError(`未找到标的代码 ${symbol}，请确认代码后重试`);
      } else {
        setError(`Yahoo 查询失败：${lookup.message ?? "请稍后重试"}`);
      }
      return null;
    }

    try {
      const resolvedExisting = instrumentBySymbol.get(resolvedSymbol);
      if (resolvedExisting) {
        return resolvedExisting;
      }

      const created = await api.post<Instrument>("/instruments", {
        symbol: resolvedSymbol,
        market: resolveMarketFromLookup(resolvedSymbol, lookup.market),
        type: resolveInstrumentTypeFromQuote(lookup.quote_type),
        currency: (lookup.currency ?? fallbackCurrency ?? "CNY").toUpperCase(),
        name: lookup.name ?? resolvedSymbol,
        default_account_id: accountId ?? null,
        allocation_node_id: null
      });

      setInstruments((prev) =>
        [...prev.filter((item) => item.id !== created.id), created].sort((a, b) =>
          a.symbol.localeCompare(b.symbol, "en-US", { sensitivity: "base" })
        )
      );

      if (lookup.price) {
        setLatestQuotes((prev) => [
          ...prev.filter((item) => item.instrument_id !== created.id),
          {
            instrument_id: created.id,
            price: lookup.price,
            currency: lookup.currency ?? created.currency,
            source: "yahoo"
          }
        ]);
      }

      setLookupHint("已根据代码自动创建标的");
      return created;
    } catch (err) {
      const refreshed = await api.get<Instrument[]>("/instruments");
      setInstruments(refreshed);
      const maybeExisting = refreshed.find((item) => item.symbol.toUpperCase() === resolvedSymbol) ?? null;
      if (maybeExisting) {
        return maybeExisting;
      }
      setError(`自动创建标的失败：${String(err)}`);
      return null;
    }
  }

  async function onCreate(values: TransactionForm) {
    const type = values.type;
    const needsInstrument = INSTRUMENT_REQUIRED_TYPES.has(type);
    const needsCounterparty = type === "INTERNAL_TRANSFER";
    const isTrade = TRADE_TYPES.has(type);

    const symbol = normalizeSymbol(values.instrument_symbol);
    let instrument = needsInstrument ? instrumentBySymbol.get(symbol) ?? null : null;

    if (needsInstrument && !symbol) {
      setError("请输入标的代码");
      return;
    }

    if (needsInstrument && !instrument) {
      instrument = await ensureInstrumentBySymbol(symbol, values.account_id, values.currency);
      if (!instrument) {
        return;
      }
    }

    if (needsCounterparty && !values.counterparty_account_id) {
      setError("内部转账必须选择对手账户");
      return;
    }

    const quantity = isTrade ? Number(values.quantity ?? 0) : null;
    const price = isTrade ? Number(values.price ?? 0) : null;

    if (isTrade && (!quantity || !price || quantity <= 0 || price <= 0)) {
      setError("买入/卖出必须填写有效的数量和价格");
      return;
    }

    const principalAmount = isTrade ? round8((quantity ?? 0) * (price ?? 0)) : Number(values.amount ?? 0);
    if (!Number.isFinite(principalAmount) || principalAmount <= 0) {
      setError("金额必须大于 0");
      return;
    }

    try {
      await api.post<Transaction>("/transactions", {
        type,
        account_id: values.account_id,
        counterparty_account_id: needsCounterparty ? values.counterparty_account_id ?? null : null,
        instrument_id: instrument?.id ?? null,
        quantity: isTrade ? quantity : null,
        price: isTrade ? price : null,
        amount: principalAmount,
        fee: isTrade ? Number(values.fee ?? 0) : 0,
        tax: isTrade ? Number(values.tax ?? 0) : 0,
        currency: values.currency.toUpperCase(),
        executed_at: shanghaiLocalToIso(values.executed_at),
        executed_tz: SHANGHAI_TZ,
        note: values.note ?? null
      });
      setSuccessMessage("流水已创建");
      form.resetFields();
      form.setFieldsValue({
        type: "CASH_IN",
        fee: 0,
        tax: 0,
        currency: "CNY",
        executed_at: getNowShanghaiDateTime()
      });
      setLookupHint("");
      setLastLookup(null);
      setLastQueriedSymbol("");
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  function openEditModal(tx: Transaction) {
    setEditingTx(tx);
    editForm.setFieldsValue({
      type: tx.type,
      account_id: tx.account_id,
      instrument_id: tx.instrument_id ?? undefined,
      quantity: tx.quantity ? Number(tx.quantity) : undefined,
      price: tx.price ? Number(tx.price) : undefined,
      amount: Number(tx.amount),
      fee: Number(tx.fee),
      tax: Number(tx.tax),
      currency: tx.currency,
      executed_at: isoToShanghaiLocalDateTime(tx.executed_at),
      note: tx.note ?? undefined
    });
  }

  async function onUpdate(values: TransactionForm) {
    if (!editingTx) {
      return;
    }

    setRowActionLoadingId(editingTx.id);
    try {
      await api.patch<Transaction>(`/transactions/${editingTx.id}`, {
        type: values.type,
        account_id: values.account_id,
        instrument_id: values.instrument_id ?? null,
        quantity: values.quantity ?? null,
        price: values.price ?? null,
        amount: values.amount,
        fee: values.fee ?? 0,
        tax: values.tax ?? 0,
        currency: values.currency.toUpperCase(),
        executed_at: shanghaiLocalToIso(values.executed_at),
        executed_tz: SHANGHAI_TZ,
        note: values.note ?? null
      });
      setSuccessMessage("流水已更新");
      setEditingTx(null);
      editForm.resetFields();
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setRowActionLoadingId(null);
    }
  }

  async function onDelete(tx: Transaction) {
    setRowActionLoadingId(tx.id);
    try {
      await api.delete<{ deleted: boolean; deleted_count: number }>(`/transactions/${tx.id}`);
      setSuccessMessage("流水已删除");
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setRowActionLoadingId(null);
    }
  }

  async function onReverse(tx: Transaction) {
    setRowActionLoadingId(tx.id);
    try {
      await api.post<Transaction>(`/transactions/${tx.id}/reverse`, {});
      setSuccessMessage("已生成冲销流水");
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setRowActionLoadingId(null);
    }
  }

  async function importCsv() {
    const file = fileList[0];
    if (!file?.originFileObj) {
      setError("请先选择 CSV 文件");
      return;
    }

    const fd = new FormData();
    fd.append("file", file.originFileObj);

    try {
      const res = await fetch(`/api/v1/transactions/import-csv?rollback_on_error=false`, {
        method: "POST",
        body: fd
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      setSuccessMessage("CSV 导入完成");
      setFileList([]);
      await load();
    } catch (err) {
      setError(String(err));
    }
  }

  function downloadCsvTemplate() {
    const blob = new Blob([`\ufeff${CSV_TEMPLATE}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "transactions_template.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    message.success("CSV 模板已下载");
  }

  const filteredTxs = useMemo(() => {
    return txs.filter((tx) => {
      const accountName = accountNameMap.get(tx.account_id) ?? "";
      const instrumentName = tx.instrument_id ? instrumentNameMap.get(tx.instrument_id) ?? "" : "";
      const byKeyword = keyword
        ? TRANSACTION_TYPE_LABELS[tx.type]?.includes(keyword) ||
          accountName.toLowerCase().includes(keyword.toLowerCase()) ||
          instrumentName.toLowerCase().includes(keyword.toLowerCase()) ||
          tx.currency.toLowerCase().includes(keyword.toLowerCase()) ||
          (tx.note ?? "").toLowerCase().includes(keyword.toLowerCase())
        : true;
      const byType = typeFilter === "ALL" ? true : tx.type === typeFilter;
      const byAccount = accountFilter === "ALL" ? true : String(tx.account_id) === accountFilter;
      const byInstrument = instrumentFilter === "ALL" ? true : String(tx.instrument_id ?? "") === instrumentFilter;
      const byCurrency = currencyFilter === "ALL" ? true : tx.currency === currencyFilter;
      return byKeyword && byType && byAccount && byInstrument && byCurrency;
    });
  }, [txs, accountNameMap, instrumentNameMap, keyword, typeFilter, accountFilter, instrumentFilter, currencyFilter]);

  const inAmount = txs.filter((item) => item.type === "CASH_IN").reduce((sum, item) => sum + Number(item.amount), 0);
  const outAmount = txs.filter((item) => item.type === "CASH_OUT").reduce((sum, item) => sum + Number(item.amount), 0);
  const netCashInflow = Math.max(inAmount - outAmount, 0);
  const netCashOutflow = Math.max(outAmount - inAmount, 0);
  const transferCount = new Set(txs.filter((item) => item.transfer_group_id).map((item) => item.transfer_group_id)).size;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }} className="page-stack transactions-page">
      {error && <Alert type="error" showIcon message="请求失败" description={error} closable />}
      {successMessage && <Alert type="success" showIcon message={successMessage} closable />}

      <div className="page-grid page-section transactions-kpi-grid">
        <Card className="transactions-kpi-card">
          <Typography.Text type="secondary">流水总笔数</Typography.Text>
          <Typography.Title level={3} style={{ marginTop: 8 }}>
            {formatDecimal(txs.length)}
          </Typography.Title>
        </Card>
        <Card className="transactions-kpi-card">
          <Typography.Text type="secondary">买入 / 卖出</Typography.Text>
          <Typography.Title level={3} style={{ marginTop: 8 }}>
            {formatDecimal(txs.filter((item) => item.type === "BUY").length)} / {formatDecimal(txs.filter((item) => item.type === "SELL").length)}
          </Typography.Title>
        </Card>
        <Card className="transactions-kpi-card">
          <Typography.Text type="secondary">内部转账</Typography.Text>
          <Typography.Title level={3} style={{ marginTop: 8 }}>
            {formatDecimal(transferCount)}
          </Typography.Title>
        </Card>
        <Card className="transactions-kpi-card">
          <Typography.Text type="secondary">现金净流入</Typography.Text>
          <Typography.Title level={3} style={{ marginTop: 8, color: "#1f4f94" }}>
            {formatDecimal(netCashInflow)}
          </Typography.Title>
        </Card>
        <Card className="transactions-kpi-card">
          <Typography.Text type="secondary">现金净流出</Typography.Text>
          <Typography.Title level={3} style={{ marginTop: 8, color: "#d9363e" }}>
            {formatDecimal(netCashOutflow)}
          </Typography.Title>
        </Card>
      </div>

      <Card className="page-section transactions-form-card" title="手工录入流水">
        <Form<TransactionForm> layout="vertical" form={form} onFinish={(values) => void onCreate(values)}>
          <div className="page-grid">
            <Form.Item label="流水类型" name="type" rules={[{ required: true, message: "请选择流水类型" }]}>
              <Select options={TRANSACTION_TYPE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))} />
            </Form.Item>

            <Form.Item label="账户" name="account_id" rules={[{ required: true, message: "请选择账户" }]}>
              <Select options={accounts.map((item) => ({ value: item.id, label: item.name }))} />
            </Form.Item>

            {createNeedsCounterparty && (
              <Form.Item label="对手账户" name="counterparty_account_id" rules={[{ required: true, message: "请选择对手账户" }]}>
                <Select allowClear options={accounts.map((item) => ({ value: item.id, label: item.name }))} />
              </Form.Item>
            )}

            {createNeedsInstrument && (
              <Form.Item label="自定义标的（可选）" name="custom_instrument_id">
                <Select
                  allowClear
                  placeholder={customInstruments.length > 0 ? "选择已创建的自定义标的" : "暂无自定义标的"}
                  options={customInstruments.map((item) => ({
                    value: item.id,
                    label: `${item.symbol} ${item.name}`
                  }))}
                  showSearch
                  optionFilterProp="label"
                />
              </Form.Item>
            )}

            {createNeedsInstrument && (
              <Form.Item label="标的代码" name="instrument_symbol" rules={[{ required: true, message: "请输入标的代码" }]}>
                <Input.Search
                  placeholder="输入标的代码，例如 AAPL / 600519.SS"
                  enterButton="查询"
                  loading={lookupLoading}
                  onChange={() => {
                    if (form.getFieldValue("custom_instrument_id")) {
                      form.setFieldValue("custom_instrument_id", undefined);
                    }
                  }}
                  onSearch={(value) => {
                    void triggerYahooLookup(value, true);
                  }}
                  onBlur={(event) => {
                    form.setFieldValue("instrument_symbol", normalizeSymbol(event.target.value));
                  }}
                />
              </Form.Item>
            )}

            {createNeedsInstrument && (
              <Form.Item
                label="标的名称"
                name="instrument_name"
                extra={lookupLoading ? "正在从 Yahoo 获取信息..." : lookupHint || "将根据标的代码自动获取"}
              >
                <Input placeholder="将根据标的代码自动获取" readOnly />
              </Form.Item>
            )}

            {isCreateTradeType && (
              <Form.Item label="数量" name="quantity" rules={[{ required: true, message: "请输入数量" }]}>
                <InputNumber min={0.00000001} precision={8} style={{ width: "100%" }} />
              </Form.Item>
            )}

            {isCreateTradeType && (
              <Form.Item label="价格" name="price" rules={[{ required: true, message: "请输入价格" }]}>
                <InputNumber min={0.00000001} precision={8} style={{ width: "100%" }} />
              </Form.Item>
            )}

            {isCreateTradeType && (
              <Form.Item label="费用" name="fee">
                <InputNumber min={0} precision={8} style={{ width: "100%" }} />
              </Form.Item>
            )}

            {isCreateTradeType && (
              <Form.Item label="税费" name="tax">
                <InputNumber min={0} precision={8} style={{ width: "100%" }} />
              </Form.Item>
            )}

            <Form.Item
              label={isCreateTradeType ? "成交金额（自动）" : "金额"}
              name="amount"
              rules={!isCreateTradeType ? [{ required: true, message: "请输入金额" }] : undefined}
            >
              <InputNumber min={0.00000001} precision={8} style={{ width: "100%" }} disabled={isCreateTradeType} />
            </Form.Item>

            <Form.Item label="币种" name="currency" rules={[{ required: true, message: "请选择币种" }]}>
              <Select options={CURRENCY_OPTIONS.map((item) => ({ ...item }))} showSearch optionFilterProp="label" />
            </Form.Item>

            <Form.Item label="执行时间（UTC+8）" name="executed_at" rules={[{ required: true, message: "请输入执行时间" }]}>
              <Input type="datetime-local" step={1} />
            </Form.Item>

            <Form.Item label="备注" name="note">
              <Input placeholder="可选" />
            </Form.Item>

            <Form.Item name="instrument_id" hidden>
              <Input />
            </Form.Item>
          </div>

          {isCreateTradeType && (
            <Typography.Text type="secondary">
              结算金额（含费税）：{createSettlementPreview === null ? "-" : formatDecimal(createSettlementPreview)}
            </Typography.Text>
          )}

          <Space style={{ marginTop: 12 }}>
            <Button type="primary" htmlType="submit" loading={loading}>
              新增流水
            </Button>
            <Button onClick={() => void load()} loading={loading}>
              刷新
            </Button>
          </Space>
        </Form>
      </Card>

      <Card className="page-section transactions-import-card" title="CSV 批量导入" extra={<Button onClick={downloadCsvTemplate}>下载 CSV 模板</Button>}>
        <Space>
          <Upload
            accept=".csv"
            fileList={fileList}
            beforeUpload={(file) => {
              setFileList([file]);
              return false;
            }}
            onRemove={() => {
              setFileList([]);
            }}
            maxCount={1}
          >
            <Button>选择 CSV 文件</Button>
          </Upload>
          <Button type="primary" onClick={() => void importCsv()}>
            导入
          </Button>
        </Space>
      </Card>

      <Card className="page-section transactions-table-card" title="流水明细">
        <div className="page-toolbar transactions-toolbar">
          <Input
            placeholder="按类型/账户/标的/币种/备注搜索"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            allowClear
            style={{ maxWidth: 280 }}
          />
          <Select
            value={typeFilter}
            onChange={(value) => setTypeFilter(value)}
            options={[{ value: "ALL", label: "全部类型" }, ...TRANSACTION_TYPE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))]}
            style={{ width: 180 }}
          />
          <Select
            value={accountFilter}
            onChange={(value) => setAccountFilter(value)}
            options={[{ value: "ALL", label: "全部账户" }, ...accounts.map((item) => ({ value: String(item.id), label: item.name }))]}
            style={{ width: 180 }}
          />
          <Select
            value={instrumentFilter}
            onChange={(value) => setInstrumentFilter(value)}
            options={[{ value: "ALL", label: "全部标的" }, ...instruments.map((item) => ({ value: String(item.id), label: `${item.symbol} ${item.name}` }))]}
            style={{ width: 220 }}
            showSearch
            optionFilterProp="label"
          />
          <Select
            value={currencyFilter}
            onChange={(value) => setCurrencyFilter(value)}
            options={[{ value: "ALL", label: "全部币种" }, ...CURRENCY_OPTIONS.map((item) => ({ value: item.value, label: item.value }))]}
            style={{ width: 140 }}
          />
          <Button
            onClick={() => {
              setKeyword("");
              setTypeFilter("ALL");
              setAccountFilter("ALL");
              setInstrumentFilter("ALL");
              setCurrencyFilter("ALL");
            }}
          >
            清空筛选
          </Button>
        </div>

        <Table
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1640 }}
          dataSource={filteredTxs}
          columns={[
            {
              title: "类型",
              dataIndex: "type",
              width: 130,
              render: (value: string) => <Tag color={getTypeColor(value)}>{TRANSACTION_TYPE_LABELS[value] ?? value}</Tag>
            },
            {
              title: "账户",
              dataIndex: "account_id",
              width: 170,
              render: (value: number) => accountNameMap.get(value) ?? "-"
            },
            {
              title: "标的",
              dataIndex: "instrument_id",
              width: 220,
              render: (value: number | null) => (value ? instrumentNameMap.get(value) ?? "-" : "-")
            },
            {
              title: "数量",
              dataIndex: "quantity",
              width: 120,
              render: (value: string | null) => formatDecimal(value)
            },
            {
              title: "价格",
              dataIndex: "price",
              width: 120,
              render: (value: string | null) => formatDecimal(value)
            },
            {
              title: "金额",
              dataIndex: "amount",
              width: 120,
              render: (value: string) => formatDecimal(value)
            },
            {
              title: "费用",
              dataIndex: "fee",
              width: 120,
              render: (value: string) => formatDecimal(value)
            },
            {
              title: "税费",
              dataIndex: "tax",
              width: 120,
              render: (value: string) => formatDecimal(value)
            },
            {
              title: "币种",
              dataIndex: "currency",
              width: 100,
              render: (value: string) => <Tag color={getCurrencyColor(value)}>{value}</Tag>
            },
            {
              title: "执行时间（UTC+8）",
              dataIndex: "executed_at",
              width: 190,
              render: (value: string) => formatShanghaiDateTime(value)
            },
            {
              title: "备注",
              dataIndex: "note",
              width: 180,
              render: (value: string | null) => value ?? "-"
            },
            {
              title: "操作",
              key: "actions",
              width: 210,
              fixed: "right",
              render: (_, tx: Transaction) => {
                const isTransferRow = Boolean(tx.transfer_group_id);
                return (
                  <Space size={4} wrap>
                    <Tooltip title={isTransferRow ? "内部转账请删除后重新创建" : ""}>
                      <span>
                        <Button
                          size="small"
                          disabled={isTransferRow}
                          loading={rowActionLoadingId === tx.id}
                          onClick={() => openEditModal(tx)}
                        >
                          编辑
                        </Button>
                      </span>
                    </Tooltip>
                    <Tooltip title={isTransferRow ? "内部转账请删除后重新创建" : ""}>
                      <span>
                        <Popconfirm
                          title="确认冲销这笔流水吗？"
                          description="将新增一笔相反方向的流水。"
                          okText="确认"
                          cancelText="取消"
                          onConfirm={() => onReverse(tx)}
                          disabled={isTransferRow}
                        >
                          <Button size="small" disabled={isTransferRow} loading={rowActionLoadingId === tx.id}>
                            冲销
                          </Button>
                        </Popconfirm>
                      </span>
                    </Tooltip>
                    <Popconfirm
                      title="确认删除这笔流水吗？"
                      description={tx.transfer_group_id ? "该操作会同时删除同组内部转账的双边流水。" : "删除后将重算持仓与现金。"}
                      okText="确认"
                      cancelText="取消"
                      onConfirm={() => onDelete(tx)}
                    >
                      <Button size="small" danger loading={rowActionLoadingId === tx.id}>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                );
              }
            }
          ]}
        />
      </Card>

      <Modal
        title="编辑流水"
        open={Boolean(editingTx)}
        onCancel={() => {
          setEditingTx(null);
          editForm.resetFields();
        }}
        onOk={() => {
          void editForm.submit();
        }}
        okText="保存"
        cancelText="取消"
        confirmLoading={editingTx ? rowActionLoadingId === editingTx.id : false}
        destroyOnClose
      >
        <Form<TransactionForm> layout="vertical" form={editForm} onFinish={(values) => void onUpdate(values)}>
          <div className="page-grid">
            <Form.Item label="流水类型" name="type" rules={[{ required: true, message: "请选择流水类型" }]}>
              <Select options={TRANSACTION_TYPE_OPTIONS.map((item) => ({ value: item.value, label: item.label }))} />
            </Form.Item>
            <Form.Item label="账户" name="account_id" rules={[{ required: true, message: "请选择账户" }]}>
              <Select options={accounts.map((item) => ({ value: item.id, label: item.name }))} />
            </Form.Item>
            <Form.Item label="标的" name="instrument_id">
              <Select allowClear options={instruments.map((item) => ({ value: item.id, label: `${item.symbol} ${item.name}` }))} />
            </Form.Item>
            <Form.Item label="数量" name="quantity">
              <InputNumber min={0} precision={8} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="价格" name="price">
              <InputNumber min={0} precision={8} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="金额" name="amount" rules={[{ required: true, message: "请输入金额" }]}>
              <InputNumber min={0.00000001} precision={8} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="费用" name="fee">
              <InputNumber min={0} precision={8} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="税费" name="tax">
              <InputNumber min={0} precision={8} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="币种" name="currency" rules={[{ required: true, message: "请选择币种" }]}>
              <Select options={CURRENCY_OPTIONS.map((item) => ({ ...item }))} showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item label="执行时间（UTC+8）" name="executed_at" rules={[{ required: true, message: "请输入执行时间" }]}>
              <Input type="datetime-local" step={1} />
            </Form.Item>
            <Form.Item label="备注" name="note">
              <Input placeholder="可选" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </Space>
  );
}
