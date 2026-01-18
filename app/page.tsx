import fs from "node:fs";
import path from "node:path";
import Image from "next/image";
import { csvParse } from "d3-dsv";
import VerticalPctChangeChart, {
  type VerticalDatum,
  type AdvertiserDatum,
  type Advertiser24Datum,
} from "@/components/VerticalPctChangeChart";

function pickCol(columns: string[], candidates: string[]): string {
  const lowerMap = new Map(columns.map((c) => [c.toLowerCase(), c]));
  for (const cand of candidates) {
    const hit = lowerMap.get(cand.toLowerCase());
    if (hit) return hit;
  }
  for (const cand of candidates) {
    const cLower = cand.toLowerCase();
    const hit = columns.find((c) => c.toLowerCase().includes(cLower));
    if (hit) return hit;
  }
  throw new Error(
    `Could not find a column matching any of: ${candidates.join(", ")}. Found: ${columns.join(", ")}`
  );
}

function safeNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return n;
}

function toPercentIfProportion(values: number[]): number[] {
  const maxAbs = Math.max(...values.map((v) => Math.abs(v)));
  if (Number.isFinite(maxAbs) && maxAbs <= 1.5) return values.map((v) => v * 100);
  return values;
}

function looksLikeOverallLabel(v: string) {
  const s = v.trim().toLowerCase();
  return s === "overall" || s === "total" || s === "all" || s === "grand total" || s === "overall total";
}

function normalizeKey(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(
      /\b(inc|inc\.|llc|l\.l\.c\.|ltd|ltd\.|co|co\.|corp|corp\.|corporation|company|holdings)\b/g,
      ""
    )
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickLikelyImpressionsCol(cols: string[]): string {
  const preferred = [
    "impressions_2h_2025",
    "impressions_2025_2h",
    "impressions_2h25",
    "impressions_2h_25",
    "tv_impressions_2h_2025",
    "tv_impressions",
    "impressions",
  ];
  try {
    return pickCol(cols, preferred);
  } catch {
    const hit = cols.find((c) => c.toLowerCase().includes("impress"));
    if (hit) return hit;
    throw new Error("Could not infer impressions column in advertiser25.csv.");
  }
}

export default function Page() {
  // --- vertical chart data ---
  const csvPath = path.join(process.cwd(), "data", "vertical_pct_change.csv");
  const raw = fs.readFileSync(csvPath, "utf-8");
  const rows = csvParse(raw);

  if (rows.length === 0) throw new Error("vertical_pct_change.csv has no rows.");

  const cols = rows.columns ?? Object.keys(rows[0] ?? {});
  const verticalCol = pickCol(cols, ["vertical", "vert", "category", "name"]);
  const changeCol = pickCol(cols, ["%_change", "pct_change", "percent_change", "change"]);

  const parsed: { vertical: string; pct_change_raw: number }[] = [];
  for (const r of rows) {
    const v = String((r as any)[verticalCol] ?? "").trim();
    const c = safeNumber((r as any)[changeCol]);
    if (!v || c === null) continue;
    parsed.push({ vertical: v, pct_change_raw: c });
  }
  if (parsed.length === 0) throw new Error(`No usable rows found. Check columns: ${verticalCol}, ${changeCol}`);

  const converted = toPercentIfProportion(parsed.map((d) => d.pct_change_raw));

  let overallPctChange: number | null = null;
  const data: VerticalDatum[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const v = parsed[i].vertical;
    const pct = converted[i];
    if (looksLikeOverallLabel(v) && overallPctChange === null) {
      overallPctChange = pct;
      continue;
    }
    data.push({ vertical: v, pct_change: pct });
  }
  if (overallPctChange === null) {
    const mean = data.reduce((acc, d) => acc + d.pct_change, 0) / Math.max(1, data.length);
    overallPctChange = mean;
  }

  data.sort((a, b) => b.pct_change - a.pct_change);

  const pos = data.filter((d) => d.pct_change > 0).slice().sort((a, b) => b.pct_change - a.pct_change);
  const neg = data.filter((d) => d.pct_change < 0).slice().sort((a, b) => a.pct_change - b.pct_change);

  const topPos = pos.slice(0, 2).map((d) => d.vertical);
  const topNeg = neg.slice(0, 2).map((d) => d.vertical);

  const overallDir = overallPctChange >= 0 ? "increased" : "declined";
  const overallTxt = `${Math.abs(overallPctChange).toFixed(1)}%`;

  // --- advertiser mapping for 2H 2025 ---
  const adv25Path = path.join(process.cwd(), "data", "advertiser25.csv");
  const advVertPath = path.join(process.cwd(), "data", "adv_verticals.csv");

  const adv25Raw = fs.readFileSync(adv25Path, "utf-8");
  const advVertRaw = fs.readFileSync(advVertPath, "utf-8");

  const adv25Rows = csvParse(adv25Raw);
  const advVertRows = csvParse(advVertRaw);

  if (adv25Rows.length === 0) throw new Error("advertiser25.csv has no rows.");
  if (advVertRows.length === 0) throw new Error("adv_verticals.csv has no rows.");

  const aCols = adv25Rows.columns ?? Object.keys(adv25Rows[0] ?? {});
  const mapCols = advVertRows.columns ?? Object.keys(advVertRows[0] ?? {});

  const advNameCol = pickCol(aCols, ["advertiser_name"]);
  const impCol = pickLikelyImpressionsCol(aCols);

  const mapAdvCol = pickCol(mapCols, ["advertiser", "advertiser_name", "name", "brand"]);
  const mapVertCol = pickCol(mapCols, ["vertical", "vert", "category"]);

  const advToImp = new Map<string, AdvertiserDatum>();
  for (const r of adv25Rows) {
    const name = String((r as any)[advNameCol] ?? "").trim();
    const imp = safeNumber((r as any)[impCol]);
    if (!name || imp === null) continue;
    advToImp.set(normalizeKey(name), { advertiser: name, impressions: imp });
  }

  const byVertical = new Map<string, AdvertiserDatum[]>();
  for (const r of advVertRows) {
    const aName = String((r as any)[mapAdvCol] ?? "").trim();
    const vName = String((r as any)[mapVertCol] ?? "").trim();
    if (!aName || !vName) continue;

    const hit = advToImp.get(normalizeKey(aName));
    if (!hit) continue;

    if (!byVertical.has(vName)) byVertical.set(vName, []);
    byVertical.get(vName)!.push(hit);
  }

  const advertiserByVertical: Record<string, AdvertiserDatum[]> = {};
  for (const [vName, list] of byVertical.entries()) {
    const dedup = new Map<string, AdvertiserDatum>();
    for (const d of list) dedup.set(normalizeKey(d.advertiser), d);

    advertiserByVertical[vName] = Array.from(dedup.values())
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 25);
  }

// --- advertiser details (2H 2024 + 2H 2025) for POC metric block ---
let advertiserDetailsByName: Record<string, Advertiser24Datum> = {};

try {
  const adv24Path = path.join(process.cwd(), "data", "advertiser24.csv");
  const adv25Path = path.join(process.cwd(), "data", "advertiser25.csv");

  const adv24Rows = csvParse(fs.readFileSync(adv24Path, "utf-8"));
  const adv25Rows = csvParse(fs.readFileSync(adv25Path, "utf-8"));

  const getCols = (rows: any[]) => rows.columns ?? Object.keys(rows[0] ?? {});
  const c24 = adv24Rows.length ? getCols(adv24Rows) : [];
  const c25 = adv25Rows.length ? getCols(adv25Rows) : [];

  if (!adv24Rows.length || !adv25Rows.length) {
    advertiserDetailsByName = {};
  } else {
    // exact headers (from your screenshot)
    const name24 = pickCol(c24, ["advertiser_name"]);
    const imp24 = pickCol(c24, ["impressions"]);
    const rch24 = pickCol(c24, ["reach"]);
    const frq24 = pickCol(c24, ["frequency"]);

    const name25 = pickCol(c25, ["advertiser_name"]);
    const imp25 = pickCol(c25, ["impressions"]);
    const rch25 = pickCol(c25, ["reach"]);
    const frq25 = pickCol(c25, ["frequency"]);

    const map24 = new Map<string, { impressions: number | null; reach: number | null; frequency: number | null }>();
    for (const r of adv24Rows) {
      const nm = String((r as any)[name24] ?? "").trim();
      if (!nm) continue;
      map24.set(normalizeKey(nm), {
        impressions: safeNumber((r as any)[imp24]),
        reach: safeNumber((r as any)[rch24]),
        frequency: safeNumber((r as any)[frq24]),
      });
    }

    const out: Record<string, Advertiser24Datum> = {};
    for (const r of adv25Rows) {
      const nm = String((r as any)[name25] ?? "").trim();
      if (!nm) continue;

      const k = normalizeKey(nm);
      const prev = map24.get(k);

      out[nm] = {
        advertiser: nm,
        impressions_2h_2024: prev?.impressions ?? null,
        impressions_2h_2025: safeNumber((r as any)[imp25]),
        households_2h_2024: prev?.reach ?? null,
        households_2h_2025: safeNumber((r as any)[rch25]),
        freq_2h_2024: prev?.frequency ?? null,
        freq_2h_2025: safeNumber((r as any)[frq25]),
      };
    }

    advertiserDetailsByName = out;
  }
} catch {
  advertiserDetailsByName = {};
}


  return (
    <main className="mx-auto w-full px-6 py-6">
      <div className="mx-auto max-w-4xl mb-4">
        <Image src="/samba_logo.png" alt="Samba TV" width={170} height={60} priority />
      </div>

      {/* smaller + tighter */}
      <div className="mx-auto max-w-4xl text-slate-900 text-[14px] leading-5">
        <p className="mb-3">
          Overall TV advertising impressions <strong>{overallDir}</strong> by <strong>{overallTxt}</strong> in the second
          half of 2025, compared to YOY. Verticals investing more heavily in TV were{" "}
          <strong>{topPos[0] ?? "(no positive verticals)"}</strong>
          {topPos.length > 1 ? (
            <>
              {" "}
              and <strong>{topPos[1]}</strong>
            </>
          ) : null}
          , while those contributing to the decline were{" "}
          <strong>{topNeg[0] ?? "(no negative verticals)"}</strong>
          {topNeg.length > 1 ? (
            <>
              {" "}
              and <strong>{topNeg[1]}</strong>
            </>
          ) : null}
          .
        </p>

        <p className="mb-5">
          Click on a specific vertical to learn how individual advertisers in each vertical were contributing to the
          changes.
        </p>
      </div>

      <div className="mt-2 mx-auto w-full max-w-[1600px]">
        <VerticalPctChangeChart
          data={data}
          advertiserByVertical={advertiserByVertical}
          advertiserDetailsByName={advertiserDetailsByName}
        />
      </div>
    </main>
  );
}
