// Default categories, keyword rules, and merchant normalization.

// kind: need | want | income | transfer
export const DEFAULT_CATEGORIES = [
  { id: 'housing', name: 'Housing', kind: 'need', budget: 0 },
  { id: 'utilities', name: 'Utilities', kind: 'need', budget: 0 },
  { id: 'phone-internet', name: 'Phone & Internet', kind: 'need', budget: 0 },
  { id: 'groceries', name: 'Groceries', kind: 'need', budget: 0 },
  { id: 'transportation', name: 'Transportation', kind: 'need', budget: 0 },
  { id: 'gas', name: 'Gas & Fuel', kind: 'need', budget: 0 },
  { id: 'insurance', name: 'Insurance', kind: 'need', budget: 0 },
  { id: 'healthcare', name: 'Healthcare', kind: 'need', budget: 0 },
  { id: 'childcare', name: 'Childcare & Education', kind: 'need', budget: 0 },
  { id: 'fees', name: 'Fees & Interest', kind: 'need', budget: 0 },
  { id: 'dining', name: 'Dining Out', kind: 'want', budget: 0 },
  { id: 'coffee', name: 'Coffee', kind: 'want', budget: 0 },
  { id: 'shopping', name: 'Shopping', kind: 'want', budget: 0 },
  { id: 'subscriptions', name: 'Subscriptions', kind: 'want', budget: 0 },
  { id: 'entertainment', name: 'Entertainment', kind: 'want', budget: 0 },
  { id: 'fitness', name: 'Fitness', kind: 'want', budget: 0 },
  { id: 'personal-care', name: 'Personal Care', kind: 'want', budget: 0 },
  { id: 'travel', name: 'Travel', kind: 'want', budget: 0 },
  { id: 'gifts', name: 'Gifts & Donations', kind: 'want', budget: 0 },
  { id: 'income', name: 'Income', kind: 'income', budget: 0 },
  { id: 'cc-payment', name: 'Credit Card Payment', kind: 'transfer', budget: 0 },
  { id: 'transfer', name: 'Transfers', kind: 'transfer', budget: 0 },
  { id: 'uncategorized', name: 'Uncategorized', kind: 'want', budget: 0 },
];

// Evaluated top to bottom; first match wins. Patterns are case-insensitive regex.
export const DEFAULT_RULES = [
  ['cc-payment', 'payment\\W*thank you|automatic payment|card payment|crd autopay|credit crd|crcardpmt|e-?payment|epay|' +
    '(chase|citi|amex|american express|capital one|discover|barclay|synchrony|bk of amer|bank of america|wells fargo card|apple card|gs bank).*(autopay|auto pay|payment|pmt|pymt)'],
  ['income', 'payroll|direct dep|dir dep|salary|paycheck|interest paid|tax refund|irs treas'],
  // Before transfers so rent paid through Zelle/Venmo still counts as housing.
  ['housing', '\\brent\\b|mortgage|hoa|apartment|apts\\b|property mgmt|landlord'],
  ['transfer', '\\btransfer\\b|\\bxfer\\b|zelle|venmo|cash app|paypal transfer|atm withdrawal'],
  ['fees', 'interest charge|finance charge|late fee|annual fee|overdraft|service fee|foreign transaction'],
  ['subscriptions', 'netflix|spotify|hulu|disney\\+|disney plus|hbo|max\\.com|paramount|peacock|youtube premium|youtube tv|apple\\.com/bill|apple music|icloud|google storage|google one|amazon prime|prime video|audible|patreon|onlyfans|siriusxm|sirius|adobe|microsoft 365|dropbox|chatgpt|openai|anthropic|claude\\.ai|crunchyroll|nytimes|wsj|substack|duolingo|xbox|playstation|nintendo|steam'],
  ['phone-internet', 'verizon|at&t|att\\*|t-mobile|tmobile|sprint|comcast|xfinity|spectrum|cox comm|frontier|optimum|mint mobile|visible|cricket|starlink'],
  ['utilities', 'electric|energy|power co|water|sewer|utility|utilities|gas company|natural gas|duke energy|pg&e|con ed|waste|trash'],
  ['insurance', 'geico|state farm|progressive|allstate|liberty mutual|farmers ins|usaa ins|insurance|nationwide'],
  ['healthcare', 'cvs|walgreens|rite aid|pharmacy|dental|dentist|medical|hospital|clinic|doctor|optometr|vision|urgent care|labcorp|quest diag'],
  ['groceries', 'kroger|safeway|whole foods|wholefds|trader joe|aldi|publix|\\bheb\\b|h-e-b|wegmans|food lion|giant|stop & shop|meijer|winco|sprouts|albertsons|vons|ralphs|grocery|market basket|costco|sam\'?s club|instacart'],
  ['gas', 'shell|exxon|\\bmobil\\b|chevron|\\bbp\\b|marathon|speedway|sunoco|wawa|quiktrip|\\bqt\\b|circle k|valero|citgo|76 |arco|racetrac|love\'?s|pilot|casey\'?s|sheetz|fuel'],
  ['transportation', 'uber(?! eats)|lyft|parking|toll|transit|metro|amtrak|dmv|jiffy lube|autozone|o\'?reilly|car wash'],
  ['coffee', 'starbucks|dunkin|dutch bros|peet\'?s|coffee|caribou'],
  ['dining', 'uber eats|doordash|grubhub|postmates|mcdonald|burger king|wendy|taco bell|chipotle|chick-fil|subway|domino|pizza|panera|restaurant|grill|diner|cafe|kitchen|sushi|bbq|tst\\*|sq \\*.*(eat|food)|sonic drive|popeyes|kfc|panda express|five guys|olive garden|applebee|ihop|denny|bar & |pub\\b|brewing'],
  ['fitness', 'planet fitness|la fitness|anytime fitness|gym|peloton|orangetheory|crossfit|ymca|equinox'],
  ['entertainment', 'amc|regal|cinema|theater|theatre|ticketmaster|stubhub|eventbrite|bowling|golf|concert|museum'],
  ['travel', 'airline|delta air|united air|american air|southwest|jetblue|spirit air|frontier air|hotel|marriott|hilton|hyatt|airbnb|vrbo|expedia|booking\\.com'],
  ['personal-care', 'salon|barber|spa\\b|nails|ulta|sephora|great clips|supercuts'],
  ['childcare', 'daycare|tuition|school|kindercare|college|university'],
  ['gifts', 'donation|charity|church|gofundme|red cross'],
  ['shopping', 'amazon|amzn|target|walmart|best buy|ebay|etsy|home depot|lowe\'?s|ikea|kohl|macy|tj maxx|marshalls|ross|old navy|gap|nike|apple store|wayfair|temu|shein|dollar tree|dollar general|five below'],
].map(([category, pattern]) => ({ category, pattern }));

const NOISE = [
  /^(pos|debit card|dbt crd|checkcard|check card|purchase|recurring|preauthorized|ach|card|visa|mc)\b\s*(purchase|debit|pmt|payment|authorized on \S+)?\s*/i,
  /\b(sq|tst|sp|py|pp|dd|paypal|ppd)\s*\*\s*/i,
];

/** Turns "POS PURCHASE NETFLIX.COM 866-579-7172 CA #1234" into "NETFLIX.COM". */
export function merchantKey(description = '') {
  let s = String(description).toUpperCase();
  for (const re of NOISE) s = s.replace(re, '');
  s = s
    .replace(/\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, ' ')        // embedded dates
    .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, ' ')    // phone numbers
    .replace(/[#*]\s*\w*\d\w*/g, ' ')                      // #1234, *A1B2C
    .replace(/\b[A-Z]*\d[\w-]*\b/g, ' ')                   // tokens containing digits
    .replace(/\s(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\s*$/, ' ')
    .replace(/[^A-Z&.'+ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = s.split(' ').filter(Boolean).slice(0, 3);
  return words.join(' ') || String(description).trim().toUpperCase().slice(0, 24);
}

// Card and loan accounts: an unmatched credit is a refund or payment, not income.
const DEBT_ACCOUNT = /^(credit|auto-loan|mortgage|student-loan|personal-loan|medical-debt|other-debt)$/;

export function categorize(description, amount, rules, accountType = "checking") {
  const text = String(description);
  for (const r of rules) {
    try {
      if (new RegExp(r.pattern, 'i').test(text)) return r.category;
    } catch { /* ignore invalid user regex */ }
  }
  // Unmatched credits on a card are usually refunds, not income.
  return amount > 0 && !DEBT_ACCOUNT.test(accountType) ? "income" : "uncategorized";
}

/** User rules take priority over built-ins. */
export function allRules(vault) {
  return [...(vault.rules || []), ...DEFAULT_RULES];
}
