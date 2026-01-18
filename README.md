# Correl v1

Correl is a tournament modeling and hedging prototype that updates tournament-winner probabilities in real time and constructs game-by-game hedges using only current match markets.

The project intentionally avoids strength models, historical data, or matchup inference. All updates and hedges are derived from pre-game tournament odds and live game probabilities.

---

## What This Does

- Generates a tournament bracket
- Maintains tournament-winner probabilities using a Bayesian likelihood update per game
- Computes portfolio value for tournament positions
- Constructs optimal one-game hedges using only game markets
- Demonstrates that sequential per-game hedging equals the optimal joint hedge

This mirrors how prediction-market primitives (e.g. Polymarket-style YES/NO markets) actually work.

---

## Core Idea

Tournament probabilities are updated as:

posterior = prior × likelihood, then normalized

yaml
Copy code

Each game contributes an independent likelihood ratio. Because the model factorizes by game, hedging can be done one game at a time while remaining globally optimal.

---

## Tech Stack

- Next.js (App Router)
- React
- TypeScript
- Deployed on Vercel

---

## Local Development

```bash
cd frontend
npm install
npm run dev
Then open http://localhost:3000.

Project Status
This is a v1 prototype focused on:

Correct probability mechanics

Explainability

Clean UI for bracket visualization

It is not a production trading system and does not attempt full payoff replication.

License
MIT
```
