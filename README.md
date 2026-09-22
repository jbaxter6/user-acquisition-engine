# Omnichannel Creator Acquisition Engine

A centralized, programmatic outbound engine for discovering, contacting, and managing conversations with music streamers/creators across Instagram, TikTok, and Twitch — without manually operating each platform or risking main brand accounts.

## The Problem

Manually finding, tracking, and messaging creators one-by-one is an operational bottleneck. Doing it by hand scales linearly and risks getting primary brand accounts flagged or banned for spam behavior.

## The Solution

A Social CRM + Automation Loop, unified under a single dashboard:

```
[ Automated Discovery & Scraping ]
               │
               ▼
[ Bulk Excel Upload ➔ Multi-Account Mass DM Sequence ]
               │
               ▼
[ The Unified Master Inbox (All socials routed to 1 tab) ]
```

## Core Modules

### 1. Automated Discovery (Scraping)
Plugs into data-scraping utilities (e.g. Modash, Phantombuster) to identify creators on Twitch, TikTok, and Instagram — filterable by follower range (e.g. 20k–200k) and content type (e.g. "Rate My Track," "Music Feedback" segments). Extracts handles, engagement rates, and public business emails into a clean spreadsheet.

### 2. Mass Distribution Layer (Multi-Account Slide)
Cold outreach is never sent from primary brand accounts. Instead, a network of satellite accounts is linked to the suite. Scraped spreadsheets are uploaded and the engine distributes send volume across accounts — roughly 50 personalized DMs per day per account — using randomized human-like delays to stay within platform limits and avoid bans.

### 3. Unified Master Inbox
Replies from creators or their managers, across TikTok, Instagram, and Twitch, all route into one centralized dashboard tab. This enables:
- Simultaneous visibility into every active conversation across all networks
- A VA to triage, filter noise, and qualify interested leads
- Seamless handoff of hot leads for closing

## Why This Matters

1. **Compounding Velocity** — Scale outbound volume to hundreds of high-value targets per week, hands-free.
2. **Asset Protection** — Core brand accounts stay untouched by automation, protecting them from platform penalties.
3. **Operational Freedom** — Standardized discovery and inbound triage lets a cost-effective VA own ~90% of the daily workflow, freeing the team to focus on product and growth strategy.

## Tech Stack

- **Frontend**: React

## Status

Early-stage build. This README documents the product vision and architecture prior to implementation.
# user-acquisition-engine
