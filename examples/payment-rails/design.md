# Deck plan: How payment rails actually move money

## Audience

- Role(s): ~400 attendees at a financial-technology conference. Roughly
  60% engineers / infra builders, 30% product + ops at fintechs, 10%
  investors and bizdev.
- What they know already: they swipe cards, they know "Stripe handles
  payments", a few have wired money internationally. Most have never
  thought about what happens between auth and settlement.
- What they want from this deck: a clear mental model of card vs ACH
  vs RTP vs SWIFT vs SEPA vs stablecoin rails — enough to make build /
  buy / partner decisions without bluffing.
- What they walk away saying: "Payments aren't one thing. Cards hide
  a 2-day float; ACH is bank-to-bank batch; RTP and FedNow are the
  new domestic instant rails; SWIFT is a messaging layer not a rail;
  stablecoins are the first rail where settlement IS the message."

## Takeaway

Settlement is the product. Card networks hid it; the new rails make
it the headline.

## Framework

Beyond Bullet Points 5-act tech talk, with a Duarte contrast spine.

Why: technical conference audience, 25 minutes, the deck needs both
a narrative (cards hide settlement → instant rails reveal it) AND
enough infra detail that engineers don't feel pandered to. The
"what is" / "what could be" contrast across rails carries the arc.

## Story arc

We start with a card swipe everyone has done, reveal the 2-day float
hidden behind it, walk through how ACH and SWIFT became the
not-really-instant alternatives, land on RTP / FedNow / stablecoins
as the rails where settlement and authorization finally collapse
into one event. They leave knowing which rail to reach for and why.

## Slide-by-slide outline

### Open
1. [title] How payment rails actually move money
2. [content] You tap a card. Money moves. Right?
3. [stat] ~$0.024 of every dollar — that's the toll

### Section 1: The card rail (the one you know)
4. [section] Card networks: settlement, hidden
5. [chart] Card interchange by category (bps)
6. [process] Auth → clearing → settlement: 3 steps, 2 days
7. [content] Who holds the money in between

### Section 2: The bank rails (the ones banks know)
8. [section] ACH, SEPA, SWIFT: batch and message
9. [comparison] ACH vs SEPA: same idea, different geographies
10. [content] SWIFT is a message, not a movement
11. [stat] ~50M SWIFT messages per day

### Section 3: The instant rails (the ones nobody knows yet)
12. [section] RTP, FedNow, stablecoins
13. [comparison] RTP vs FedNow: two US instant rails
14. [chart] Settlement time across all six rails
15. [content] Stablecoins: settlement IS the message
16. [stat] ~$30T in stablecoin transfer volume in 2024

### Section 4: What this means for what you build
17. [section] Picking a rail
18. [content] Three questions to ask before you wire anything
19. [content] What the next 5 years probably look like

### Close
20. [qa] Questions

## Visual direction

- **Palette:** dominant #0F172A (slate-900), accent #14B8A6 (teal-500),
  neutrals #F8FAFC (background), #475569 (muted text)
- **Display font:** Inter (theme default)
- **Body font:** Inter (theme default)
- **Mood:** clinical / restrained, with one warm accent for highlights
- **Theme:** light

## Logo inventory

Brands referenced in the deck. All declared without `source:` so the
CLI auto-picks across all 7 sources.

- visa
- mastercard
- stripe
- paypal
- square
- adyen
- plaid
- swift  (curated pack)
- fed    (curated pack — for FedNow)
- circle (USDC)

## Demo plan

No live demos. Static charts only — the deck is for a 25-minute slot
and demos would eat the time.

## Anticipated Q&A

- "Why does interchange exist at all? Why can't merchants just charge
  the actual cost?"
- "If RTP and FedNow exist, why do we still settle cards on T+2?"
- "Are stablecoins actually used for B2B settlement or just trading?"
- "What's the catch with FedNow — why isn't every bank on it?"
- "Where does Plaid fit — is it a rail?"

## Decisions deferred / open

- None — going straight to slides.
