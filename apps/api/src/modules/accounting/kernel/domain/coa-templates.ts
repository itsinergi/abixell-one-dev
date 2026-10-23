/**
 * Wave A6 Chart of Accounts Templates (Indonesia-oriented).
 *
 * Templates are shipped as draft; entities instantiate per legal entity,
 * creating a new `chart_of_accounts` row with `template_type` and `coa_status`
 * set to draft, awaiting accountant review before production use.
 *
 * Each template uses 4-digit account codes and a 9-level group structure:
 * 1=Assets, 2=Liabilities, 3=Equity, 4=Revenue, 5=COGS, 6=OpEx,
 * 7=Other Inc/Exp, 8=Tax, 9=Statistical/Memorandum.
 *
 * Parent-child links use `parentCode` (resolved at instantiation by the service).
 */

import type { TemplateAccountDef } from "./accounting-kernel.entity.js";

/**
 * SAK Umum (full Indonesian standards per PSAK) — ~45 accounts.
 * Suitable for standard business entities; includes fixed assets, depreciation,
 * comprehensive account structure.
 */
export const SAK_UMUM_TEMPLATE: ReadonlyArray<TemplateAccountDef> = [
  // 1000 — ASSETS (Assets group header)
  { accountCode: "1000", accountName: "ASET", accountClass: "ASSET", normalBalance: "debit", accountType: "header", parentCode: null },
  // 1100 — Current Assets
  { accountCode: "1100", accountName: "Aset Lancar", accountClass: "ASSET", normalBalance: "debit", accountType: "header", parentCode: "1000" },
  { accountCode: "1110", accountName: "Kas", accountClass: "ASSET", normalBalance: "debit", accountType: null, parentCode: "1100" },
  { accountCode: "1120", accountName: "Bank", accountClass: "ASSET", normalBalance: "debit", accountType: null, parentCode: "1100" },
  { accountCode: "1130", accountName: "Piutang Usaha", accountClass: "ASSET", normalBalance: "debit", accountType: null, parentCode: "1100" },
  { accountCode: "1140", accountName: "Persediaan", accountClass: "ASSET", normalBalance: "debit", accountType: null, parentCode: "1100" },
  { accountCode: "1150", accountName: "Biaya Dibayar Dimuka", accountClass: "ASSET", normalBalance: "debit", accountType: null, parentCode: "1100" },
  // 1200 — Non-Current Assets
  { accountCode: "1200", accountName: "Aset Tidak Lancar", accountClass: "ASSET", normalBalance: "debit", accountType: "header", parentCode: "1000" },
  { accountCode: "1210", accountName: "Tanah", accountClass: "ASSET", normalBalance: "debit", accountType: null, parentCode: "1200" },
  { accountCode: "1220", accountName: "Bangunan", accountClass: "ASSET", normalBalance: "debit", accountType: null, parentCode: "1200" },
  { accountCode: "1230", accountName: "Akumulasi Depresiasi Bangunan", accountClass: "ASSET", normalBalance: "credit", accountType: null, parentCode: "1200" },
  { accountCode: "1240", accountName: "Peralatan", accountClass: "ASSET", normalBalance: "debit", accountType: null, parentCode: "1200" },
  { accountCode: "1250", accountName: "Akumulasi Depresiasi Peralatan", accountClass: "ASSET", normalBalance: "credit", accountType: null, parentCode: "1200" },

  // 2000 — LIABILITIES
  { accountCode: "2000", accountName: "LIABILITAS", accountClass: "LIABILITY", normalBalance: "credit", accountType: "header", parentCode: null },
  // 2100 — Current Liabilities
  { accountCode: "2100", accountName: "Liabilitas Jangka Pendek", accountClass: "LIABILITY", normalBalance: "credit", accountType: "header", parentCode: "2000" },
  { accountCode: "2110", accountName: "Utang Usaha", accountClass: "LIABILITY", normalBalance: "credit", accountType: null, parentCode: "2100" },
  { accountCode: "2120", accountName: "Utang Pajak", accountClass: "LIABILITY", normalBalance: "credit", accountType: null, parentCode: "2100" },
  { accountCode: "2130", accountName: "Biaya Yang Masih Harus Dibayar", accountClass: "LIABILITY", normalBalance: "credit", accountType: null, parentCode: "2100" },
  { accountCode: "2140", accountName: "Pendapatan Diterima Dimuka", accountClass: "LIABILITY", normalBalance: "credit", accountType: null, parentCode: "2100" },
  // 2200 — Long-term Liabilities
  { accountCode: "2200", accountName: "Liabilitas Jangka Panjang", accountClass: "LIABILITY", normalBalance: "credit", accountType: "header", parentCode: "2000" },
  { accountCode: "2210", accountName: "Utang Bank Jangka Panjang", accountClass: "LIABILITY", normalBalance: "credit", accountType: null, parentCode: "2200" },

  // 3000 — EQUITY
  { accountCode: "3000", accountName: "EKUITAS", accountClass: "EQUITY", normalBalance: "credit", accountType: "header", parentCode: null },
  { accountCode: "3100", accountName: "Modal Disetor", accountClass: "EQUITY", normalBalance: "credit", accountType: null, parentCode: "3000" },
  { accountCode: "3200", accountName: "Laba Ditahan", accountClass: "EQUITY", normalBalance: "credit", accountType: null, parentCode: "3000" },
  { accountCode: "3300", accountName: "Laba Tahun Berjalan", accountClass: "EQUITY", normalBalance: "credit", accountType: null, parentCode: "3000" },

  // 4000 — REVENUE
  { accountCode: "4000", accountName: "PENDAPATAN", accountClass: "INCOME", normalBalance: "credit", accountType: "header", parentCode: null },
  { accountCode: "4100", accountName: "Pendapatan Usaha", accountClass: "INCOME", normalBalance: "credit", accountType: null, parentCode: "4000" },
  { accountCode: "4200", accountName: "Pendapatan Lain-lain", accountClass: "INCOME", normalBalance: "credit", accountType: null, parentCode: "4000" },

  // 5000 — COGS
  { accountCode: "5000", accountName: "BEBAN POKOK PENJUALAN", accountClass: "EXPENSE", normalBalance: "debit", accountType: "header", parentCode: null },
  { accountCode: "5100", accountName: "Harga Pokok Penjualan", accountClass: "EXPENSE", normalBalance: "debit", accountType: null, parentCode: "5000" },

  // 6000 — OPERATING EXPENSES
  { accountCode: "6000", accountName: "BEBAN OPERASIONAL", accountClass: "EXPENSE", normalBalance: "debit", accountType: "header", parentCode: null },
  { accountCode: "6100", accountName: "Beban Gaji", accountClass: "EXPENSE", normalBalance: "debit", accountType: null, parentCode: "6000" },
  { accountCode: "6200", accountName: "Beban Sewa", accountClass: "EXPENSE", normalBalance: "debit", accountType: null, parentCode: "6000" },
  { accountCode: "6300", accountName: "Beban Utilitas", accountClass: "EXPENSE", normalBalance: "debit", accountType: null, parentCode: "6000" },
  { accountCode: "6400", accountName: "Beban Penyusutan", accountClass: "EXPENSE", normalBalance: "debit", accountType: null, parentCode: "6000" },
  { accountCode: "6500", accountName: "Beban Administrasi dan Umum", accountClass: "EXPENSE", normalBalance: "debit", accountType: null, parentCode: "6000" },

  // 7000 — OTHER INCOME/EXPENSES
  { accountCode: "7000", accountName: "PENDAPATAN (BEBAN) LAIN-LAIN", accountClass: "EXPENSE", normalBalance: "debit", accountType: "header", parentCode: null },
  { accountCode: "7100", accountName: "Pendapatan Bunga", accountClass: "INCOME", normalBalance: "credit", accountType: null, parentCode: "7000" },
  { accountCode: "7200", accountName: "Beban Bunga", accountClass: "EXPENSE", normalBalance: "debit", accountType: null, parentCode: "7000" },
  { accountCode: "7300", accountName: "Keuntungan (Kerugian) Penjualan Aset", accountClass: "EXPENSE", normalBalance: "debit", accountType: null, parentCode: "7000" },

  // 8000 — TAX
  { accountCode: "8000", accountName: "PAJAK", accountClass: "EXPENSE", normalBalance: "debit", accountType: "header", parentCode: null },
  { accountCode: "8100", accountName: "Beban Pajak Kini", accountClass: "EXPENSE", normalBalance: "debit", accountType: null, parentCode: "8000" },
  { accountCode: "8200", accountName: "Beban Pajak Tangguhan", accountClass: "EXPENSE", normalBalance: "debit", accountType: null, parentCode: "8000" },

  // 9000 — STATISTICAL/MEMORANDUM
  { accountCode: "9000", accountName: "STATISTIK / MEMORANDUM", accountClass: "ASSET", normalBalance: "debit", accountType: "header", parentCode: null },
  { accountCode: "9100", accountName: "Rekening Administratif", accountClass: "ASSET", normalBalance: "debit", accountType: null, parentCode: "9000" },
];

/**
 * SAK EMKM (simplified for micro/small entities per Indonesian government directive).
 * ~20 accounts; covers core entities without complex depreciation or long-term debt.
 */
export const SAK_EMKM_TEMPLATE: ReadonlyArray<TemplateAccountDef> = [
  // 1000 — ASSETS
  { accountCode: "1000", accountName: "ASET", accountClass: "ASSET", normalBalance: "debit", accountType: "header", parentCode: null },
  { accountCode: "1100", accountName: "Kas dan Bank", accountClass: "ASSET", normalBalance: "debit", accountType: null, parentCode: "1000" },
  { accountCode: "1200", accountName: "Piutang Usaha", accountClass: "ASSET", normalBalance: "debit", accountType: null, parentCode: "1000" },
  { accountCode: "1300", accountName: "Persediaan", accountClass: "ASSET", normalBalance: "debit", accountType: null, parentCode: "1000" },
  { accountCode: "1400", accountName: "Aset Tetap", accountClass: "ASSET", normalBalance: "debit", accountType: null, parentCode: "1000" },

  // 2000 — LIABILITIES
  { accountCode: "2000", accountName: "LIABILITAS", accountClass: "LIABILITY", normalBalance: "credit", accountType: "header", parentCode: null },
  { accountCode: "2100", accountName: "Utang Usaha", accountClass: "LIABILITY", normalBalance: "credit", accountType: null, parentCode: "2000" },
  { accountCode: "2200", accountName: "Utang Pajak", accountClass: "LIABILITY", normalBalance: "credit", accountType: null, parentCode: "2000" },

  // 3000 — EQUITY
  { accountCode: "3000", accountName: "EKUITAS", accountClass: "EQUITY", normalBalance: "credit", accountType: "header", parentCode: null },
  { accountCode: "3100", accountName: "Modal", accountClass: "EQUITY", normalBalance: "credit", accountType: null, parentCode: "3000" },
  { accountCode: "3200", accountName: "Laba Ditahan", accountClass: "EQUITY", normalBalance: "credit", accountType: null, parentCode: "3000" },

  // 4000 — REVENUE
  { accountCode: "4000", accountName: "PENDAPATAN", accountClass: "INCOME", normalBalance: "credit", accountType: "header", parentCode: null },
  { accountCode: "4100", accountName: "Pendapatan Usaha", accountClass: "INCOME", normalBalance: "credit", accountType: null, parentCode: "4000" },

  // 5000 — COGS
  { accountCode: "5000", accountName: "BEBAN POKOK PENJUALAN", accountClass: "EXPENSE", normalBalance: "debit", accountType: "header", parentCode: null },
  { accountCode: "5100", accountName: "Harga Pokok Penjualan", accountClass: "EXPENSE", normalBalance: "debit", accountType: null, parentCode: "5000" },

  // 6000 — OPERATING EXPENSES
  { accountCode: "6000", accountName: "BEBAN USAHA", accountClass: "EXPENSE", normalBalance: "debit", accountType: "header", parentCode: null },
  { accountCode: "6100", accountName: "Beban Operasional", accountClass: "EXPENSE", normalBalance: "debit", accountType: null, parentCode: "6000" },

  // 7000 — OTHER INC/EXP
  { accountCode: "7000", accountName: "PENDAPATAN (BEBAN) LAIN-LAIN", accountClass: "EXPENSE", normalBalance: "debit", accountType: "header", parentCode: null },
  { accountCode: "7100", accountName: "Pendapatan/Beban Lain-lain", accountClass: "EXPENSE", normalBalance: "debit", accountType: null, parentCode: "7000" },

  // 8000 — TAX
  { accountCode: "8000", accountName: "PAJAK", accountClass: "EXPENSE", normalBalance: "debit", accountType: "header", parentCode: null },
  { accountCode: "8100", accountName: "Beban Pajak", accountClass: "EXPENSE", normalBalance: "debit", accountType: null, parentCode: "8000" },

  // 9000 — STATISTICAL
  { accountCode: "9000", accountName: "STATISTIK", accountClass: "ASSET", normalBalance: "debit", accountType: "header", parentCode: null },
  { accountCode: "9100", accountName: "Rekening Administratif", accountClass: "ASSET", normalBalance: "debit", accountType: null, parentCode: "9000" },
];
