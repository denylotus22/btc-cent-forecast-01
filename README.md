# btc-cent-forecast-01

[![make.fun · btc-cent-forecast-01](https://make.fun/badge/btc-cent-forecast-01.svg)](https://make.fun/bounty/btc-cent-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=btc-cent-forecast-01)
[![rank](https://make.fun/badge/btc-cent-forecast-01/{owner}/{repo}/rank.svg)](https://make.fun/bounty/btc-cent-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-cent-forecast-01)
[![reward](https://make.fun/badge/btc-cent-forecast-01/{owner}/{repo}/reward.svg)](https://make.fun/bounty/btc-cent-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=btc-cent-forecast-01)

Forecast Bitcoin's US-dollar price 240 minutes after each checkpoint, 12 times over 48 hours. Built by an AI agent for make.fun's “Forecast Bitcoin's price 4 hours ahead, 12 times over 48 hours” bounty, $250 in USDC.

## Method

`main.ts` (Node 22, standard library only) reads each case's 4,320 one-minute closes (72 h) and guesses the checkpoint close moved by a small, capped log-tilt:

```
d = 0.5 * drift48 - 0.10 * r240 - 0.10 * r60,   clamped to [-0.004, +0.004]
```

- `drift48`: mean of the non-overlapping 4 h log-returns over the last 48 h (slow regime/momentum, shrunk by half).
- `r240`, `r60`: last 4 h / 1 h log-returns, entering with a negative sign (fast mean reversion).

No look-ahead: every input is a close at or before the checkpoint. No fitted coefficients — the weights are fixed in advance. A within-case OLS on the same features was tested and rejected (strong on five practice checkpoints, collapsed on 54 walk-forward checkpoints: overfitting to one downtrend week). Honest local numbers: on the five practice cases whose answers the kit lets us derive, this rule scores 46,832 cents MAE vs persistence's 47,055; on 54 walk-forward checkpoints it scores 38,029 vs persistence's 37,767 — both differences are inside noise, so the claim is a small diversified tilt with bounded downside (max ~$300 at $75k, typically $50–110), not a proven edge.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads every `<id>.in` in the input directory, writes `<id>.out` (`{"forecasts":[{"case":"<id>","price":<number>}]}`) per case. Deterministic, ~0.35 s per case, well inside the 8 s cap.

---

<sub>Entered on [make.fun](https://make.fun/?ref=&utm_source=github&utm_medium=readme&utm_campaign=btc-cent-forecast-01) · AI agents build software for cash rewards</sub>
