<script>
  import { Presentation, Slide, getLogos } from "@work.books/runtime/presentation";

  const logos = getLogos();
</script>

<Presentation
  title="What 'specialty' coffee actually means"
  aspectRatio="16:9"
>
  <!-- 1. TITLE -->
  <Slide kind="title">
    <h1>What "specialty"<br/>actually means.</h1>
    <p>A 25-minute talk · the protocol, not the marketing</p>
  </Slide>

  <!-- 2. SITUATION -->
  <Slide kind="content">
    <span class="eyebrow">The premise</span>
    <h2>You've been told "specialty" means premium.</h2>
    <p>
      Better beans. Single origin. A nicer bag.
      Probably <strong>around $22 a pound</strong>.
    </p>
    <div class="logo-row">
      {#each Object.entries(logos) as [name, logo] (name)}
        <img src={logo.dataUrl} alt={name} title={name} />
      {/each}
    </div>
  </Slide>

  <!-- 3. QUOTE — marketing framing -->
  <Slide kind="quote">
    <blockquote>
      Specialty coffee is the term used to describe coffees of the
      highest quality.
    </blockquote>
    <cite>— the line every premium bag prints</cite>
  </Slide>

  <!-- 4. REVEAL — there's a real definition -->
  <Slide kind="content">
    <span class="eyebrow">What the trade actually means</span>
    <h2>There is a real definition. It is a number.</h2>
    <p>
      The <strong>Specialty Coffee Association</strong> defines it
      as a score on a 100-point cupping scale, measured by
      certified graders.
    </p>
  </Slide>

  <!-- 5. SECTION 1 -->
  <Slide kind="section">
    <h1 data-eyebrow="01 / The Protocol">The protocol</h1>
  </Slide>

  <!-- 6. STAT — 80/100 -->
  <Slide kind="stat">
    <p class="huge">80<span class="unit">/ 100</span></p>
    <p class="caption">
      The cupping-score floor. Below 80 is not "specialty" — it's
      commercial-grade. Even by one point.
    </p>
  </Slide>

  <!-- 7. CONTENT — Q graders -->
  <Slide kind="content">
    <span class="eyebrow">How the score is produced</span>
    <h2>Trained graders, blind, in triplicate.</h2>
    <p>
      <strong>Q graders</strong> are certified by the Coffee Quality
      Institute. They score 10 sensory attributes — fragrance,
      flavor, aftertaste, acidity, body, balance, uniformity, clean
      cup, sweetness, overall — on identical brews, three cups at a
      time, blind.
    </p>
  </Slide>

  <!-- 8. PROCESS — the cupping flow -->
  <Slide kind="process">
    <h2>How a cupping actually runs.</h2>
    <div class="steps">
      <div class="step">
        <span class="n">01</span>
        <b>Grind &amp; sniff</b>
        <span class="body">8.25 g per 150 ml, dry fragrance scored first.</span>
      </div>
      <div class="step">
        <span class="n">02</span>
        <b>Pour &amp; bloom</b>
        <span class="body">Water just off boil. Crust forms. Score wet aroma at 4 min.</span>
      </div>
      <div class="step">
        <span class="n">03</span>
        <b>Break &amp; slurp</b>
        <span class="body">Three breaks of the crust. Slurp from a spoon to spray the palate.</span>
      </div>
      <div class="step">
        <span class="n">04</span>
        <b>Score &amp; reconcile</b>
        <span class="body">Independent scoresheets per cup. Reconcile against the table.</span>
      </div>
    </div>
  </Slide>

  <!-- 9. STAT — Q graders worldwide -->
  <Slide kind="stat">
    <p class="huge">~5,000<span class="unit">worldwide</span></p>
    <p class="caption">
      Certified Q graders globally. Re-certification every three
      years. The scarcity is intentional — the score only means
      something if the graders calibrate to each other.
    </p>
  </Slide>

  <!-- 10. CONTENT — defects -->
  <Slide kind="content">
    <span class="eyebrow">The hard gate</span>
    <h2>Defect count is a gate, not a penalty.</h2>
    <p>
      <strong>Zero primary defects</strong> in a 350g sample, no
      more than 5 secondary. One full black bean and the lot can't
      be called specialty — regardless of cup score.
    </p>
  </Slide>

  <!-- 11. SECTION 2 -->
  <Slide kind="section">
    <h1 data-eyebrow="02 / What The Score Measures">The production reality</h1>
  </Slide>

  <!-- 12. CONTENT — altitude -->
  <Slide kind="content">
    <span class="eyebrow">The strongest single correlate</span>
    <h2>Altitude is the cheapest predictor of cup score.</h2>
    <p>
      Cooler nights at elevation slow cherry maturation. Slower
      sugar development means denser beans and more complex
      acidity. <strong>1,500m+ is the rough specialty threshold</strong>.
    </p>
  </Slide>

  <!-- 13. CHART — altitude vs score -->
  <Slide kind="chart">
    <h2>Cup score climbs with altitude — to a point.</h2>
    <figure class="wb-chart">
      <svg viewBox="0 0 900 460" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cup score versus growing altitude">
        <!-- axes -->
        <line x1="80" y1="400" x2="860" y2="400" stroke="#8A7968" stroke-width="1.5"/>
        <line x1="80" y1="40"  x2="80"  y2="400" stroke="#8A7968" stroke-width="1.5"/>

        <!-- 80-point threshold rule -->
        <line x1="80" y1="200" x2="860" y2="200" stroke="#C8643C" stroke-width="1.5" stroke-dasharray="6 6"/>
        <text x="850" y="192" text-anchor="end" font-family="Inter, sans-serif" font-size="16" fill="#C8643C">80 — specialty threshold</text>

        <!-- band: rough cloud of growing regions -->
        <g fill="#2B1810" opacity="0.85">
          <circle cx="160" cy="340" r="6"/>
          <circle cx="200" cy="320" r="6"/>
          <circle cx="240" cy="310" r="6"/>
          <circle cx="280" cy="290" r="6"/>
          <circle cx="320" cy="270" r="6"/>
          <circle cx="360" cy="245" r="6"/>
          <circle cx="400" cy="225" r="6"/>
          <circle cx="440" cy="210" r="6"/>
          <circle cx="480" cy="195" r="6"/>
          <circle cx="520" cy="180" r="6"/>
          <circle cx="560" cy="165" r="6"/>
          <circle cx="600" cy="150" r="6"/>
          <circle cx="640" cy="140" r="6"/>
          <circle cx="680" cy="138" r="6"/>
          <circle cx="720" cy="140" r="6"/>
          <circle cx="760" cy="148" r="6"/>
        </g>

        <!-- trend curve -->
        <path d="M 100 360 Q 320 280 520 180 T 800 140" stroke="#C8643C" stroke-width="3" fill="none"/>

        <!-- annotations -->
        <text x="200" y="380" font-family="Inter, sans-serif" font-size="16" fill="#8A7968">800m</text>
        <text x="440" y="380" font-family="Inter, sans-serif" font-size="16" fill="#8A7968">1,500m</text>
        <text x="680" y="380" font-family="Inter, sans-serif" font-size="16" fill="#8A7968">2,000m+</text>
        <text x="420" y="430" font-family="Inter, sans-serif" font-size="18" fill="#2B1810" text-anchor="middle">Growing altitude</text>

        <text x="60" y="404" font-family="Inter, sans-serif" font-size="16" fill="#8A7968" text-anchor="end">70</text>
        <text x="60" y="204" font-family="Inter, sans-serif" font-size="16" fill="#8A7968" text-anchor="end">80</text>
        <text x="60" y="54"  font-family="Inter, sans-serif" font-size="16" fill="#8A7968" text-anchor="end">90</text>
        <text x="40" y="220" font-family="Inter, sans-serif" font-size="18" fill="#2B1810" text-anchor="middle" transform="rotate(-90 40 220)">Cup score</text>
      </svg>
      <figcaption>
        Stylized relationship. Real curves vary by varietal &amp;
        processing. Sources: SCA published cupping scores, World Coffee
        Research origin reports, 2018–2024.
      </figcaption>
    </figure>
  </Slide>

  <!-- 14. CONTENT — varietal + processing -->
  <Slide kind="content">
    <span class="eyebrow">The other two levers</span>
    <h2>Varietal and processing carry the rest.</h2>
    <p>
      <strong>Gesha, SL28, Bourbon</strong> cup higher than
      Catimor at the same altitude. <strong>Natural and honey
      processing</strong> shift the flavor profile more than the
      farm does.
    </p>
  </Slide>

  <!-- 15. COMPARISON — three origins -->
  <Slide kind="comparison">
    <h2>Three origins. Three signatures.</h2>
    <div class="cols three">
      <div class="col">
        <h3>Ethiopia</h3>
        <p class="origin">Yirgacheffe</p>
        <p>1,800–2,200m · heirloom varietals · washed.</p>
        <p class="notes">Jasmine, bergamot, lemon. The textbook
          floral cup.</p>
      </div>
      <div class="col">
        <h3>Guatemala</h3>
        <p class="origin">Huehuetenango</p>
        <p>1,500–2,000m · Bourbon, Caturra · washed.</p>
        <p class="notes">Cocoa, stone fruit, brown sugar. Round
          and structured.</p>
      </div>
      <div class="col">
        <h3>Ethiopia</h3>
        <p class="origin">Sidamo</p>
        <p>1,400–2,200m · heirloom · natural or washed.</p>
        <p class="notes">Berry, wine, stone fruit when natural.
          The fruit-forward cup.</p>
      </div>
    </div>
  </Slide>

  <!-- 16. STAT — world production -->
  <Slide kind="stat">
    <p class="huge">~10M<span class="unit">tons / yr</span></p>
    <p class="caption">
      Total world green-coffee production. Brazil and Vietnam
      together are roughly half of that.
    </p>
  </Slide>

  <!-- 17. STAT — specialty share -->
  <Slide kind="stat">
    <p class="huge">~20<span class="unit">% of volume</span></p>
    <p class="caption">
      The share that even claims "specialty". The share that would
      actually cup at 80+ in a blind test is smaller.
    </p>
  </Slide>

  <!-- 18. SECTION 3 -->
  <Slide kind="section">
    <h1 data-eyebrow="03 / The Gap">The gap</h1>
  </Slide>

  <!-- 19. CONTENT — the indictment -->
  <Slide kind="content">
    <span class="eyebrow">The honest part</span>
    <h2>Most "specialty" on shelves was never cupped.</h2>
    <p>
      The bag prints the word. The roaster ordered the green
      against a sample they trust. The lot itself often has
      <strong>no graded score on file</strong>.
    </p>
  </Slide>

  <!-- 20. COMPARISON — label vs contract -->
  <Slide kind="comparison">
    <h2>The label vs the contract.</h2>
    <div class="cols">
      <div class="col">
        <h3>The bag says</h3>
        <p class="origin">"Specialty grade"</p>
        <p>Single origin. Roast date. Tasting notes.
          A story about a farm.</p>
        <p class="notes">No score. No grader's name. No defect count.</p>
      </div>
      <div class="col">
        <h3>The contract requires</h3>
        <p class="origin">≥ 80 cup score</p>
        <p>Zero primary defects. ≤ 5 secondary. Sample-approved
          by a named Q grader.</p>
        <p class="notes">This is what specialty means as a trade term.</p>
      </div>
    </div>
  </Slide>

  <!-- 21. CONTENT — the close / call to action -->
  <Slide kind="content">
    <span class="eyebrow">What to do Monday</span>
    <h2>Ask your roaster for the cup score and the grader.</h2>
    <p>
      If they can name both, you're buying specialty as the trade
      means it. If they can't, you're buying <strong>a story about
      coffee</strong> — which can still be a fine product, just
      not the same one.
    </p>
  </Slide>

  <!-- 22. QA -->
  <Slide kind="qa">
    <h1>Questions.</h1>
    <p>Notes &amp; sources · workbooks.sh/w/specialty-coffee</p>
  </Slide>
</Presentation>
