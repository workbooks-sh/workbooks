<script>
  import { Presentation, Slide, getLogos } from "@work.books/runtime/presentation";

  const logos = getLogos();

  // Card interchange data — rough US Visa/Mastercard published rates
  // for credit cards, in basis points + fixed fee. Public from Visa
  // and Mastercard rate disclosures (2024-2025 schedules).
  const interchange = [
    { label: "Regulated debit",       bps: 5,   note: "Durbin cap, ~21¢ + 5bps" },
    { label: "Retail credit",         bps: 154, note: "1.54% + 10¢ (CPS Retail)" },
    { label: "Restaurant",            bps: 175, note: "1.75% + 10¢" },
    { label: "Travel / airline",      bps: 200, note: "2.00% + 10¢" },
    { label: "Rewards (Visa Sig)",    bps: 230, note: "2.30% + 10¢" },
    { label: "Business / corporate",  bps: 265, note: "2.65% + 10¢" },
  ];

  // Settlement time across rails, in hours. Estimates — sources noted.
  const settlement = [
    { rail: "Cards (T+2)",         hours: 48,    src: "Visa/MC settlement cycle" },
    { rail: "ACH same-day",        hours: 4,     src: "NACHA same-day window" },
    { rail: "SEPA SCT Inst",       hours: 0.003, src: "≤10s, 99% target" },
    { rail: "SWIFT gpi",           hours: 4,     src: "median <4h, 75% same-day" },
    { rail: "RTP (TCH)",           hours: 0.003, src: "<10s, 24/7" },
    { rail: "FedNow",              hours: 0.003, src: "<20s, 24/7" },
    { rail: "USDC (Ethereum L1)",  hours: 0.05,  src: "~3 min finality" },
  ];

  // For the chart we plot log-scaled bars; the data above is the truth.
  function logScale(h) {
    const v = Math.max(h, 0.001);
    return Math.log10(v * 3600); // seconds, log10
  }
  const maxLog = Math.max(...settlement.map((s) => logScale(s.hours)));
</script>

<Presentation title="How payment rails actually move money" aspectRatio="16:9">

  <!-- 1. Title -->
  <Slide kind="title">
    <h1>How payment rails actually move money</h1>
    <p>Cards, ACH, RTP, SWIFT, SEPA, stablecoins — and who holds the money in between</p>
  </Slide>

  <!-- 2. Hook -->
  <Slide kind="content">
    <h2>You tap a card. Money moves. Right?</h2>
    <p>Authorization happens in 300 milliseconds. Settlement takes two days. Everything interesting lives in that gap.</p>
  </Slide>

  <!-- 3. Opening stat -->
  <Slide kind="stat">
    <p class="huge">2.4¢</p>
    <p>of every dollar swiped on a credit card never reaches the merchant. That's the toll for hiding settlement.</p>
  </Slide>

  <!-- 4. Section 1 -->
  <Slide kind="section">
    <h1>Card networks: settlement, hidden</h1>
    <div class="logo-row color">
      {#if logos.visa}<img src={logos.visa.dataUrl} alt="Visa" />{/if}
      {#if logos.mastercard}<img src={logos.mastercard.dataUrl} alt="Mastercard" />{/if}
      {#if logos.stripe}<img src={logos.stripe.dataUrl} alt="Stripe" />{/if}
      {#if logos.adyen}<img src={logos.adyen.dataUrl} alt="Adyen" />{/if}
      {#if logos.square}<img src={logos.square.dataUrl} alt="Square" />{/if}
      {#if logos.paypal}<img src={logos.paypal.dataUrl} alt="PayPal" />{/if}
    </div>
  </Slide>

  <!-- 5. CHART #1 — interchange by category -->
  <Slide kind="chart">
    <h2>Most of the toll is interchange, not the processor.</h2>
    <figure class="chart">
      <svg viewBox="0 0 1000 380" preserveAspectRatio="xMidYMid meet">
        {#each interchange as row, i}
          {@const y = 30 + i * 55}
          {@const w = (row.bps / 300) * 720}
          <text x="10" y={y + 22} class="label">{row.label}</text>
          <rect class="bar {row.label.startsWith('Rewards') ? 'accent' : ''}"
                x="260" y={y} width={w} height="36" rx="3" />
          <text x={260 + w + 10} y={y + 24}>{(row.bps / 100).toFixed(2)}%</text>
        {/each}
        <g class="axis">
          <line x1="260" y1="360" x2="980" y2="360" stroke="#cbd5e1" />
          <text x="260" y="378">0%</text>
          <text x="500" y="378">1%</text>
          <text x="740" y="378">2%</text>
          <text x="970" y="378" text-anchor="end">3%</text>
        </g>
      </svg>
      <figcaption>Source: Visa & Mastercard published US interchange rate schedules, 2024–2025. Excludes ~10¢ fixed per-txn fee and processor markup.</figcaption>
    </figure>
  </Slide>

  <!-- 6. Process -->
  <Slide kind="process">
    <h2>One swipe. Three steps. Two days.</h2>
    <div class="wb-slide-flow">
      <div><b>Auth</b> · ~300ms — issuer says "yes, funds reserved"</div>
      <div><b>Clearing</b> · end of day — acquirer batches the transaction to the network</div>
      <div><b>Settlement</b> · T+2 — issuer wires net to acquirer, acquirer pays merchant</div>
    </div>
  </Slide>

  <!-- 7. Who holds the money -->
  <Slide kind="content">
    <h2>For two days, the issuer holds your money.</h2>
    <p>Float at the scale of every Visa and Mastercard transaction on Earth. The card business is, structurally, a short-term lending business that bills the merchant for the privilege.</p>
  </Slide>

  <!-- 8. Section 2 -->
  <Slide kind="section">
    <h1>ACH, SEPA, SWIFT: batch and message</h1>
    <div class="logo-row">
      {#if logos.swift}<img src={logos.swift.dataUrl} alt="SWIFT" />{/if}
      {#if logos.plaid}<img src={logos.plaid.dataUrl} alt="Plaid" />{/if}
    </div>
  </Slide>

  <!-- 9. ACH vs SEPA comparison -->
  <Slide kind="comparison">
    <h2>ACH and SEPA: same idea, different geographies.</h2>
    <div class="col">
      <h3>ACH (US)</h3>
      <p>Operator: The Clearing House + Federal Reserve</p>
      <p>Settlement: same-day to 2 business days</p>
      <p>Volume: ~33B txns / year (2024)</p>
      <p>Fee: ~$0.20–$1.50 per transfer</p>
    </div>
    <div class="col">
      <h3>SEPA (EU)</h3>
      <p>Operator: EBA Clearing + ECB TARGET2</p>
      <p>Settlement: SCT next-day, SCT Inst ≤10 seconds</p>
      <p>Volume: ~50B txns / year (2024)</p>
      <p>Fee: free domestic in most EU banks</p>
    </div>
  </Slide>

  <!-- 10. SWIFT is messaging -->
  <Slide kind="content">
    <h2>SWIFT is a message, not a movement.</h2>
    <p>SWIFT doesn't move money. It tells correspondent banks to move money on each side, against accounts they keep with each other. The actual settlement happens on Fedwire, TARGET2, or wherever the banks happen to hold balances.</p>
  </Slide>

  <!-- 11. SWIFT volume stat -->
  <Slide kind="stat">
    <p class="huge">~50M</p>
    <p>SWIFT messages per day across ~11,000 institutions in 200+ countries. The plumbing of global B2B payments, built on a 1973 telex replacement.</p>
  </Slide>

  <!-- 12. Section 3 -->
  <Slide kind="section">
    <h1>RTP, FedNow, stablecoins</h1>
    <div class="logo-row color">
      {#if logos.fed}<img src={logos.fed.dataUrl} alt="Federal Reserve / FedNow" />{/if}
      {#if logos.circle}<img src={logos.circle.dataUrl} alt="Circle / USDC" />{/if}
    </div>
  </Slide>

  <!-- 13. RTP vs FedNow three-col -->
  <Slide kind="comparison">
    <h2>The US has two instant rails. They don't talk to each other.</h2>
    <div class="three-col">
      <div>
        <h3>RTP</h3>
        <p><b>Operator:</b> The Clearing House (private)</p>
        <p><b>Live since:</b> 2017</p>
        <p><b>Coverage:</b> ~70% of US DDA accounts</p>
        <p><b>Limit:</b> $10M per txn</p>
      </div>
      <div>
        <h3>FedNow</h3>
        <p><b>Operator:</b> Federal Reserve (public)</p>
        <p><b>Live since:</b> July 2023</p>
        <p><b>Coverage:</b> ~1,400 banks (mid-2025)</p>
        <p><b>Limit:</b> $1M default, $10M optional</p>
      </div>
      <div>
        <h3>What's shared</h3>
        <p>ISO 20022 messaging</p>
        <p>24/7/365 operation</p>
        <p>Credit-push only, no pulls</p>
        <p>Settlement in &lt;20 seconds</p>
      </div>
    </div>
  </Slide>

  <!-- 14. CHART #2 — settlement time across all rails -->
  <Slide kind="chart">
    <h2>The gap between batch rails and instant rails is four orders of magnitude.</h2>
    <figure class="chart">
      <svg viewBox="0 0 1000 380" preserveAspectRatio="xMidYMid meet">
        {#each settlement as row, i}
          {@const y = 20 + i * 48}
          {@const ratio = logScale(row.hours) / maxLog}
          {@const w = ratio * 600}
          {@const isInstant = row.hours < 0.01}
          <text x="10" y={y + 22} class="label">{row.rail}</text>
          <rect class="bar {isInstant ? 'accent' : ''}"
                x="260" y={y} width={Math.max(w, 6)} height="30" rx="3" />
          <text x={260 + Math.max(w, 6) + 10} y={y + 22}>
            {row.hours < 0.01 ? '~10s' : row.hours < 1 ? `~${Math.round(row.hours * 60)} min` : `${row.hours}h`}
          </text>
        {/each}
        <g class="axis">
          <line x1="260" y1="360" x2="860" y2="360" stroke="#cbd5e1" />
          <text x="260" y="378">10s</text>
          <text x="410" y="378">5min</text>
          <text x="560" y="378">1h</text>
          <text x="710" y="378">12h</text>
          <text x="855" y="378" text-anchor="end">2d</text>
        </g>
      </svg>
      <figcaption>Log scale. Sources: Visa/MC settlement docs, NACHA same-day ACH rules, ECB SCT Inst spec, SWIFT gpi tracker, TCH RTP & Federal Reserve FedNow service descriptions, Etherscan finality observations.</figcaption>
    </figure>
  </Slide>

  <!-- 15. Stablecoins -->
  <Slide kind="content">
    <h2>Stablecoins: settlement is the message.</h2>
    <p>A USDC transfer doesn't notify a bank to debit an account. It IS the debit. The state change on-chain is final settlement. No reconciliation, no float, no T+2 — at the cost of carrying the chain's risk model.</p>
  </Slide>

  <!-- 16. Stablecoin volume -->
  <Slide kind="stat">
    <p class="huge">~$30T</p>
    <p>in stablecoin transfer volume in 2024 (~estimate, after MEV/bot filtering — Visa Onchain Analytics, Allium). For comparison: Visa processed ~$15T in payments volume the same year.</p>
  </Slide>

  <!-- 17. Section 4 -->
  <Slide kind="section">
    <h1>Picking a rail</h1>
  </Slide>

  <!-- 18. Three questions -->
  <Slide kind="process">
    <h2>Three questions before you wire anything.</h2>
    <div class="wb-slide-flow">
      <div><b>Who needs the money?</b> Consumer-facing → cards. Bank-to-bank → ACH/SEPA. Cross-border B2B → SWIFT or stablecoin.</div>
      <div><b>How fast does it need to settle?</b> Days → ACH. Same-day → SWIFT gpi. Seconds → RTP, FedNow, USDC.</div>
      <div><b>Who eats the failure?</b> Cards: chargebacks on you. Instant rails: credit-push, no clawback.</div>
    </div>
  </Slide>

  <!-- 19. What's next -->
  <Slide kind="content">
    <h2>The next five years: settlement stops being free.</h2>
    <p>Card float subsidized "free" rewards for 60 years. Instant rails kill the float. Banks notice. Expect explicit per-transfer pricing, treasury teams that arbitrage rails the way they arbitrage FX, and stablecoin settlement quietly winning the cross-border B2B leg.</p>
  </Slide>

  <!-- 20. Q&A -->
  <Slide kind="qa">
    <h1>Questions?</h1>
    <p>shane@shinyobjectz.com · workbooks.sh</p>
  </Slide>

</Presentation>
