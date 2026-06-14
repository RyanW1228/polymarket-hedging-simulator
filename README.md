# Polymarket Hedging Simulator (previously Correl v1)

**Polymarket sports single-elimination tournament hedging tool.**

Correl is a tournament modeling and hedging prototype that updates tournament-winner probabilities in real time and constructs game-by-game hedges using current match-market probabilities.

The project is designed for Polymarket-style prediction markets, where users may hold long-dated tournament-winner positions while also trading shorter-term game markets. Correl demonstrates how live game markets can be used to dynamically hedge tournament exposure as a bracket unfolds.

## Overview

In a single-elimination tournament, each game changes the probability distribution over who can win the tournament.

Correl starts with pre-game tournament-winner probabilities, then updates those probabilities using live game probabilities. It intentionally avoids team-strength models, historical data, or matchup inference. Instead, it treats market prices as the source of truth.

The core update is:

```text
posterior = prior × likelihood, then normalize
```

Each game contributes a likelihood update. Because the model factorizes by game, tournament hedging can be performed one game at a time while still matching the optimal joint hedge.

## What This Does

* Generates a tournament bracket
* Maintains tournament-winner probabilities through each game
* Updates probabilities using Bayesian likelihood updates
* Computes portfolio value for tournament-winner positions
* Constructs optimal one-game hedges using current game markets
* Demonstrates that sequential per-game hedging equals the optimal joint hedge
* Provides a clean UI for bracket visualization and hedge explainability

## Why It Matters

Prediction market users often hold long-dated positions, such as:

```text
Team A wins the tournament
```

But as the tournament progresses, the most liquid and actionable markets may be shorter-term game markets, such as:

```text
Team A beats Team B
```

Correl explores how a trader can use game-level markets to hedge tournament-level exposure without needing a full custom sports model.

This mirrors how real prediction-market primitives work: tournament markets and game markets are separate instruments, but their payoffs are mathematically linked.

## Core Concepts

### Tournament Winner Position

A long-dated position that pays if a selected team wins the full tournament.

Example:

```text
YES: France wins the World Cup
```

### Game Market

A short-term market for the outcome of a specific matchup.

Example:

```text
YES: France beats Germany
```

### Bayesian Update

When a game’s probability changes, Correl updates each team’s tournament-winning probability by applying the game likelihood and normalizing the result.

```text
posterior(team) ∝ prior(team) × likelihood(game outcome | team wins tournament)
```

### Hedge

A hedge is a position in a current game market that offsets the change in value of a tournament-winner portfolio.

Correl computes the hedge needed for the next game using only that game’s market probabilities.

### Sequential Hedging

Because the tournament decomposes into a sequence of games, Correl demonstrates that hedging one game at a time can produce the same result as solving the joint hedge across the full bracket.

## Example Use Case

Suppose you hold a position on:

```text
Team A wins the tournament
```

Team A is about to play Team B.

If Team A loses, your tournament-winner position may become worthless. If Team A wins, its tournament probability increases.

Correl calculates the game-market hedge that offsets this exposure, allowing you to manage tournament risk using the currently tradable game market.

## Tech Stack

* **Frontend:** Next.js, React, TypeScript
* **Routing:** Next.js App Router
* **Deployment:** Vercel
* **Modeling:** Bayesian likelihood updates and hedge optimization logic

## Project Structure

```text
polymarket-hedging-simulator/
  frontend/
    app/                  # Next.js app routes and UI
    components/           # UI components
    lib/                  # Modeling / probability / hedge logic
    public/               # Static assets
    package.json          # Frontend dependencies and scripts

  README.md
  .gitignore
  next-env.d.ts
```

## Getting Started

### Prerequisites

* Node.js
* npm

### Install

```bash
git clone https://github.com/RyanW1228/polymarket-hedging-simulator.git
cd polymarket-hedging-simulator/frontend
npm install
```

### Run Locally

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

### Build

```bash
npm run build
```

### Start Production Build

```bash
npm run start
```

## Model Notes

Correl intentionally avoids:

* historical team-strength models
* manual matchup priors
* player-level data
* external sports data feeds
* full production-grade trading execution

Instead, it focuses on the mechanics of translating market-implied game probabilities into tournament probability updates and hedge positions.

## Current Status

Correl v1 is a prototype focused on:

* correct probability mechanics
* explainability
* game-by-game hedge construction
* clean bracket visualization
* prediction-market risk management concepts

It is not a production trading system and does not execute live trades.

## Limitations

* Prototype only
* No live Polymarket execution
* No real-time market data integration yet
* No transaction routing or wallet integration
* No production risk controls
* No full payoff replication engine
* Assumes market prices are the source of truth
* Designed for single-elimination tournament structures

## Roadmap

Potential next steps:

* Live Polymarket market-data integration
* Real-time game probability updates
* Portfolio import from user positions
* Multi-market hedge optimization
* Support for multiple tournament formats
* Slippage and liquidity-aware hedge sizing
* Wallet connection and simulated execution
* Historical backtesting on completed tournaments
* Comparison between sequential and joint hedging strategies

## License

MIT
