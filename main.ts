// btc-cent-forecast-01 entry: a small-tilt forecaster for Bitcoin's price 240 minutes ahead.
//
// Method (documented, no look-ahead: every input is a close at or before the checkpoint).
// The case gives 4,320 one-minute closes (72 h) ending at the checkpoint; the guess is the
// checkpoint close moved by a small log-drift `d`, capped so the tilt can never dominate:
//
//   d = 0.5 * drift48 - 0.10 * r240 - 0.10 * r60,   clamped to [-0.004, +0.004]
//
//   drift48 = mean of the non-overlapping 4 h log-returns over the last 48 h
//             (12 blocks: the slow regime / momentum component),
//   r240    = log-return of the last 4 h, r60 = log-return of the last hour
//             (both enter with a negative sign: the fast mean-reversion component).
//
// Why this shape, and what it is honest about:
//   - On the kit's practice (p00-p05) the 4 h returns are close to unpredictable: the
//     persistence baseline (guess = last close) scores 44,521.58 cents MAE over the six
//     practice cases, and no tested rule beats it by more than noise. Measured on the
//     five practice cases whose answers the kit lets us derive (each case's target is the
//     next case's checkpoint close), persistence scores 47,054.7 cents and this rule
//     46,832.3 cents; on 54 walk-forward checkpoints inside the six cases it scores
//     38,028.9 against persistence's 37,766.8. The paired differences are well inside
//     their 95% confidence intervals (about +/-1,100-2,900 cents), so the honest claim
//     is a small, diversified tilt with bounded downside, not a proven edge.
//   - The two signals that survive a look at the full 92 h recording are (a) a slow
//     drift: the mean 4 h return over 48 h, shrunk by half, and (b) fast mean reversion:
//     4 h returns negatively autocorrelate (lag-1 about -0.33 on 22 non-overlapping
//     blocks) and 1 h returns predict the next 4 h return at about -0.33. Both are weak
//     (n is small), so both enter heavily shrunk and the total tilt is capped at 0.4%
//     (about $300 at $75k; typically $50-110), which bounds the damage when the regime
//     flips: a wrong-way tilt costs at most |d| per case, a right-way one saves up to |d|.
//   - A within-case OLS on the same features was tested and rejected: it looked strong
//     on the five final practice checkpoints (32,809 cents) but collapsed on the
//     54-point walk-forward (72,483 cents) - textbook overfitting to one downtrend week.
//     No fitted coefficients are used here; the weights are fixed in advance.
// The market id is the trading pair (e.g. btc-usdc), not the case id: every case in
// a run must name the same market, or a stray file from another market would be
// forecast silently against the wrong series. On well-formed input (every practice
// and final case) this guard never fires and the outputs are unchanged.
//   - The guess is the checkpoint close times exp(d), kept on the 5-decimal grid and
//     inside (0, 10,000,000), exactly as the starter does. The program is deterministic
//     (no clock, no randomness) and pure standard library, so two runs agree byte for
//     byte. It reads every <id>.in in the input directory and writes <id>.out per case.
//
// Outside the grader's container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR stand in
// for /input and /output:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The smallest positive price on the grid: one unit of its 5 decimals. */
const MIN_PRICE = 0.00001;
/** The largest grid price below the scorer's exclusive 10,000,000-dollar cap. */
const MAX_PRICE = 9_999_999.99999;
/** The horizon in minutes: one case holds 72 h, the forecast is 240 min ahead. */
const HORIZON_MINUTES = 240;
/** How far back the slow drift looks: 48 h of non-overlapping 4 h blocks (12 blocks). */
const DRIFT_WINDOW_MINUTES = 48 * 60;
/** Fixed weights of the three components (see the header: fixed, never fitted). */
const DRIFT_WEIGHT = 0.5;
const REVERSAL_240_WEIGHT = 0.1;
const REVERSAL_60_WEIGHT = 0.1;
/** The tilt is capped at 0.4% in log terms (about $300 at $75k). */
const TILT_CAP = 0.004;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  markets: CaseMarket[];
}

/** x kept on the grid's 5 decimals and inside the scorer's (0, 10,000,000). */
const price5 = (x: number): number => Math.round(Math.min(MAX_PRICE, Math.max(MIN_PRICE, x)) * 1e5) / 1e5;

/**
 * The mean of the non-overlapping 240-minute log-returns ending at the last close,
 * over the last DRIFT_WINDOW_MINUTES. Blocks are taken every 240 minutes back from
 * the checkpoint so no minute is used twice and nothing after the checkpoint enters.
 */
function drift48(logPrices: number[]): number {
  const n = logPrices.length;
  const last = n - 1;
  const first = Math.max(HORIZON_MINUTES, last - DRIFT_WINDOW_MINUTES);
  let sum = 0;
  let count = 0;
  for (let t = last; t >= first; t -= HORIZON_MINUTES) {
    sum += logPrices[t] - logPrices[t - HORIZON_MINUTES];
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
}

/** The forecast for one market: last close moved by the capped tilt, on the grid. */
function forecast(m: CaseMarket): number {
  if (!Array.isArray(m.prices) || m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const prices = m.prices;
  const n = prices.length;
  const last = prices[n - 1] as number;
  if (typeof last !== 'number' || !Number.isFinite(last) || last <= 0) {
    throw new Error(`market ${m.id}'s last price is not a finite positive number`);
  }
  if (n <= HORIZON_MINUTES) return price5(last);
  const logPrices = prices.map((p) => {
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) throw new Error(`market ${m.id} holds a non-positive price`);
    return Math.log(p);
  });
  const t = n - 1;
  const r240 = logPrices[t] - logPrices[t - HORIZON_MINUTES];
  const r60 = logPrices[t] - logPrices[t - 60];
  const tilt = DRIFT_WEIGHT * drift48(logPrices) - REVERSAL_240_WEIGHT * r240 - REVERSAL_60_WEIGHT * r60;
  const capped = Math.max(-TILT_CAP, Math.min(TILT_CAP, tilt));
  return price5(last * Math.exp(capped));
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
let marketId: string | null = null;
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (!Array.isArray(c.markets) || c.markets.length !== 1) throw new Error(`${file} does not hold exactly one market`);
  const market = c.markets[0] as CaseMarket;
  if (typeof market.id !== 'string' || market.id.length === 0) throw new Error(`${file} holds a market with no id`);
  if (marketId === null) marketId = market.id;
  else if (market.id !== marketId) throw new Error(`${file} holds market ${market.id}, expected ${marketId}`);
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts: [{ case: id, price: forecast(c.markets[0] as CaseMarket) }] })}\n`);
}
