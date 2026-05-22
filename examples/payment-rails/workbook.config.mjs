// Conference deck: "How payment rails actually move money".
// 25-min slot, 400 attendees, mixed business + engineering.
// Auto-pick logo mode — omit `source:` and the CLI fans across all
// 7 sources. `swift` and `fed` resolve to the curated pack.
export default {
  name: "How payment rails actually move money",
  slug: "payment-rails",
  entry: "src/index.html",
  type: "presentation",
  wasmVariant: "none",
  description:
    "Conference deck on card networks, ACH, RTP, SWIFT, SEPA, and stablecoin rails.",
  logos: [
    { id: "visa" },
    { id: "mastercard" },
    { id: "stripe" },
    { id: "paypal" },
    { id: "square" },
    { id: "adyen" },
    { id: "plaid" },
    { id: "swift" },
    { id: "fed" },
    { id: "circle" },
  ],
};
