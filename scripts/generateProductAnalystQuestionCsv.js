import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "data", "generated-interview-imports");

const COMPANIES = {
  ecommerce: ["Amazon", "Flipkart", "Meesho", "Swiggy", "Lenskart", "Eternal Limited", "7-Eleven"],
  product: [
    "Google", "Adobe", "Microsoft", "LinkedIn", "Samsung", "Nokia", "Honeywell",
    "Walmart Labs", "New Relic", "Info Edge",
  ],
  fintech: [
    "PhonePe", "Razorpay", "Groww", "Navi", "Visa", "Intuit", "JPMorganChase", "Zeta",
  ],
  enterprise: [
    "Atlassian", "Twilio", "SAP", "Oracle", "Cisco", "Whatfix", "o9 Solutions", "Eightfold AI",
  ],
  startup: ["Rapido", "ShareChat", "Go Comet", "Mareana", "SeedlingLabs"],
  service: [
    "Accenture", "Deloitte", "EY", "ZS Associates", "Fractal Analytics", "TCS NQT",
    "Cognizant", "ThoughtWorks",
  ],
};

const SOURCES = {
  case: "https://www.geeksforgeeks.org/business-analyst-interview-questions/",
  productSense: "https://www.tryexponent.com/blog/product-analyst-interview-questions",
  guesstimate: "https://www.preplounge.com/en/case-interview-basics/market-sizing",
  aptitude: "https://www.indiabix.com/aptitude/",
  hr: "https://www.geeksforgeeks.org/hr-interview-questions/",
};

const q = (id, category, title, question, topics, subtopics, source, criteria) => ({
  id, category, title, question, topics, subtopics, source, criteria,
});

const m = (id, category, title, question, topics, subtopics, source, options, answer, explanation) => ({
  id, category, title, question, topics, subtopics, source, options, answer, explanation,
});

const h = (id, category, title, question, topics, subtopics, source, criteria, signals) => ({
  id, category, title, question, topics, subtopics, source, criteria, signals,
});

// ── Case Interview (50) ───────────────────────────────────────────────
const caseQuestions = [
  // E-commerce (10)
  q("pa-case-med-001", "ecommerce", "Food delivery market sizing",
    "Estimate the number of food delivery orders per day in a metro city like Bangalore. State assumptions clearly and walk through your calculation.",
    ["case-interview", "guesstimate", "market-sizing"], ["assumptions", "top-down", "sanity-check"], SOURCES.guesstimate,
    ["Structures the problem into population, adoption, frequency, and order size components", "States reasonable assumptions with explicit reasoning", "Performs clear step-by-step arithmetic", "Sanity-checks the final number against intuition or benchmarks", "Summarizes key drivers and sensitivity"]),
  q("pa-case-med-002", "ecommerce", "Cart abandonment spike",
    "Checkout completion dropped 6 points after adding an extra OTP step. How would you diagnose the issue and recommend next steps?",
    ["case-interview", "product-analytics", "metrics"], ["funnel-analysis", "diagnosis", "recommendation"], SOURCES.case,
    ["Localizes drop to checkout funnel step and relevant segments", "Lists hypotheses such as friction, latency, payment failures, or fraud concerns", "Proposes data pulls, cohort views, and qualitative feedback", "Weighs rollback, redesign, or optional OTP with trade-offs", "Recommends a measurable follow-up experiment or fix"]),
  q("pa-case-med-003", "ecommerce", "Free delivery threshold",
    "Leadership wants to increase average order value by raising the free-delivery minimum. How would you analyze whether this is a good idea?",
    ["case-interview", "pricing", "product-strategy"], ["unit-economics", "customer-behavior", "tradeoffs"], SOURCES.productSense,
    ["Defines success metrics such as AOV, conversion, margin, and retention", "Anticipates customer segmentation effects on price-sensitive users", "Discusses competitive context and elasticity qualitatively", "Proposes experiment or phased rollout rather than blind launch", "States risks such as order frequency drop or competitor response"]),
  q("pa-case-med-004", "ecommerce", "Search zero-result rate",
    "30% of searches return zero products. As a product analyst, how would you prioritize fixes?",
    ["case-interview", "product-analytics", "prioritization"], ["search-quality", "impact-effort", "roadmap"], SOURCES.case,
    ["Quantifies revenue or conversion impact of zero-result queries", "Segments by category, query type, and user intent", "Prioritizes fixes such as synonyms, catalog gaps, or query rewriting", "Balances quick wins versus long-term catalog investments", "Defines success metrics and monitoring after launch"]),
  q("pa-case-med-005", "ecommerce", "Seller onboarding drop-off",
    "Only 20% of sellers who start registration complete onboarding. Structure your investigation and recommendation.",
    ["case-interview", "funnel-analysis", "operations"], ["onboarding", "diagnosis", "recommendation"], SOURCES.case,
    ["Maps onboarding steps and identifies largest drop-off points", "Hypothesizes documentation, verification, UX, or support issues", "Suggests qualitative seller interviews and support ticket review", "Prioritizes fixes by impact and implementation effort", "Defines target completion rate and tracking plan"]),
  q("pa-case-med-006", "ecommerce", "Discount versus margin",
    "A category manager wants deeper discounts to win market share, but finance flags margin erosion. How do you frame the decision?",
    ["case-interview", "business-strategy", "metrics"], ["tradeoffs", "stakeholders", "recommendation"], SOURCES.productSense,
    ["Clarifies objective: share, profit, or LTV over a defined horizon", "Compares short-term volume gains with margin and repeat purchase effects", "Mentions segment-level or category-level analysis", "Proposes controlled promotion tests instead of blanket discounts", "Communicates recommendation with risks and guardrails"]),
  q("pa-case-med-007", "ecommerce", "New category launch",
    "Should a horizontal marketplace launch a new electronics category? Outline the analysis framework you would use.",
    ["case-interview", "market-entry", "strategy"], ["market-sizing", "competition", "go-no-go"], SOURCES.case,
    ["Assesses customer demand, purchase frequency, and attach rate to existing users", "Evaluates competitive intensity and differentiation", "Considers supply, logistics, returns, and support costs", "Identifies risks such as capital lock-in or weak unit economics", "Recommends pilot, partnership, or defer with clear criteria"]),
  q("pa-case-med-008", "ecommerce", "Return rate increase",
    "Product return rate rose from 8% to 12% in fashion. What analyses and actions would you suggest?",
    ["case-interview", "product-analytics", "operations"], ["returns", "root-cause", "quality"], SOURCES.case,
    ["Breaks returns down by SKU, seller, size, and reason codes", "Separates expectation mismatch from quality or logistics issues", "Links to listing quality, images, sizing guides, or delivery damage", "Prioritizes supplier, UX, or policy interventions", "Sets monitoring metrics post-intervention"]),
  q("pa-case-med-009", "ecommerce", "Loyalty program ROI",
    "The CEO asks whether the loyalty program is worth its cost. How would you evaluate it?",
    ["case-interview", "metrics", "roi"], ["loyalty", "incrementality", "cohort-analysis"], SOURCES.productSense,
    ["Defines program costs and benefit levers such as frequency and retention", "Compares enrolled versus comparable non-enrolled cohorts cautiously", "Discusses incrementality versus self-selection bias", "Uses simple ROI or break-even framing with assumptions", "Recommends iterate, expand, or redesign based on findings"]),
  q("pa-case-med-010", "ecommerce", "Peak sale readiness",
    "A major sale is four weeks away and last year's site slowed during peak traffic. What would you recommend as product analyst?",
    ["case-interview", "operations", "planning"], ["peak-traffic", "risk", "coordination"], SOURCES.case,
    ["Identifies user-facing metrics at risk such as conversion and latency", "Coordinates with engineering on capacity, caching, and fallback flows", "Plans monitoring dashboards and war-room metrics", "Prepares contingency such as queue or feature toggles", "Defines post-mortem and success criteria for the event"]),

  // Product companies (10)
  q("pa-case-med-011", "product", "Daily active users drop",
    "A social app's DAU fell 10% week-over-week with no product release. Walk through your diagnostic approach.",
    ["case-interview", "product-analytics", "metrics"], ["dau", "diagnosis", "segmentation"], SOURCES.productSense,
    ["Checks data pipeline integrity and definition changes first", "Segments by platform, geography, acquisition channel, and cohort", "Investigates external factors, outages, or policy changes", "Maps to activation, retention, or re-engagement funnel issues", "Recommends targeted experiments or fixes with success metrics"]),
  q("pa-case-med-012", "product", "Feature prioritization roadmap",
    "Engineering capacity allows only one of three features next quarter: offline mode, better search, or referral rewards. How do you decide?",
    ["case-interview", "prioritization", "product-strategy"], ["impact-effort", "framework", "stakeholders"], SOURCES.productSense,
    ["Clarifies company goal such as retention, acquisition, or revenue", "Scores options on user impact, effort, risk, and strategic fit", "Uses qualitative and quantitative inputs such as requests and usage data", "Considers dependencies and learning value of each option", "Makes a justified recommendation with trade-offs stated"]),
  q("pa-case-med-013", "product", "North Star metric proposal",
    "Leadership asks you to propose one North Star metric for a B2B collaboration tool. How would you approach this?",
    ["case-interview", "metrics", "product-strategy"], ["north-star", "kpi", "b2b"], SOURCES.productSense,
    ["Links metric to core customer value and business model", "Ensures measurability, actionability, and sensitivity to product changes", "Avoids vanity metrics with weak causal connection", "Suggests complementary guardrail metrics", "Explains definition, grain, and reporting cadence"]),
  q("pa-case-med-014", "product", "Notification fatigue",
    "Push notification opt-out rate doubled after increasing send frequency. What would you recommend?",
    ["case-interview", "product-analytics", "engagement"], ["notifications", "retention", "experimentation"], SOURCES.case,
    ["Analyzes opt-out by user segment and notification type", "Balances re-engagement benefit with user annoyance and brand risk", "Proposes personalization, caps, or preference controls", "Suggests A/B test on frequency or content relevance", "Defines guardrail metrics such as uninstalls and session depth"]),
  q("pa-case-med-015", "product", "Freemium conversion",
    "Free-to-paid conversion is stuck at 2%. Structure an analysis plan to improve monetization.",
    ["case-interview", "monetization", "funnel-analysis"], ["freemium", "conversion", "pricing"], SOURCES.productSense,
    ["Maps free user journey to paid trigger points and drop-offs", "Segments by use case, team size, or engagement depth", "Investigates pricing, packaging, and paywall placement hypotheses", "Benchmarks qualitatively against category norms", "Recommends experiments with clear primary metric"]),
  q("pa-case-med-016", "product", "Competitive feature gap",
    "Users cite a competitor feature in app-store reviews. How do you evaluate whether to build it?",
    ["case-interview", "competitive-analysis", "prioritization"], ["voice-of-customer", "strategy", "roadmap"], SOURCES.productSense,
    ["Quantifies review volume and user segment affected", "Assesses strategic importance versus me-too risk", "Estimates build cost, maintenance, and opportunity cost", "Considers alternative solutions or partnerships", "Recommends build, partner, or defer with evidence"]),
  q("pa-case-med-017", "product", "Onboarding time to value",
    "New users who complete setup in day one retain 3x better. How would you improve onboarding as an analyst?",
    ["case-interview", "activation", "product-analytics"], ["onboarding", "retention", "experiments"], SOURCES.case,
    ["Defines setup completion and time-to-value events clearly", "Identifies friction steps via funnel and session analysis", "Proposes UX, guidance, or incentive interventions", "Suggests A/B tests on simplified flows", "Tracks long-term retention not only completion rate"]),
  q("pa-case-med-018", "product", "Enterprise vs SMB focus",
    "Sales wants to focus on enterprise clients but product metrics look stronger in SMB. How do you advise leadership?",
    ["case-interview", "strategy", "segmentation"], ["b2b", "tradeoffs", "recommendation"], SOURCES.productSense,
    ["Compares revenue, churn, support cost, and sales cycle by segment", "Aligns recommendation with company stage and capacity", "Notes product and GTM implications of each focus", "Avoids one-metric decision making", "Proposes dual-track or phased strategy if appropriate"]),
  q("pa-case-med-019", "product", "Dark mode request",
    "Thousands of users requested dark mode. How do you decide priority against other backlog items?",
    ["case-interview", "prioritization", "voice-of-customer"], ["roadmap", "impact-effort", "qualitative"], SOURCES.productSense,
    ["Estimates affected user base and engagement impact beyond vote count", "Considers accessibility, platform parity, and engineering cost", "Checks whether request correlates with retention or NPS movers", "Places item in objective prioritization framework", "Communicates transparent decision to stakeholders"]),
  q("pa-case-med-020", "product", "Usage metric definition debate",
    "Two teams define 'active user' differently, causing conflicting reports. How do you resolve this?",
    ["case-interview", "metrics", "governance"], ["definitions", "alignment", "analytics"], SOURCES.case,
    ["Documents current definitions and impact of discrepancy", "Facilitates agreement on business purpose of the metric", "Proposes single canonical definition with documented exceptions", "Implements versioning or naming to avoid confusion", "Sets governance for future metric changes"]),

  // Fintech (8)
  q("pa-case-med-021", "fintech", "UPI failure rate spike",
    "UPI payment success rate dropped 2 points yesterday. Outline your investigation as a product analyst.",
    ["case-interview", "product-analytics", "operations"], ["payments", "diagnosis", "incident"], SOURCES.case,
    ["Checks data freshness and scope of affected banks, merchants, or regions", "Segments failures by error code, device, and amount bucket", "Coordinates with ops and engineering on incident timeline", "Assesses customer and revenue impact", "Recommends communication, rollback, or fix validation steps"]),
  q("pa-case-med-022", "fintech", "KYC drop-off",
    "40% of users abandon KYC before completion. How would you analyze and improve conversion?",
    ["case-interview", "funnel-analysis", "compliance"], ["kyc", "onboarding", "conversion"], SOURCES.case,
    ["Maps KYC steps and identifies highest drop steps", "Hypothesizes document friction, trust, or technical errors", "Reviews support tickets and session recordings if available", "Balances compliance requirements with UX simplification", "Proposes experiments and compliance review for changes"]),
  q("pa-case-med-023", "fintech", "Credit limit increase request",
    "Product wants to offer higher credit limits to drive usage. What analyses would you run first?",
    ["case-interview", "risk", "product-strategy"], ["credit", "tradeoffs", "segmentation"], SOURCES.case,
    ["Clarifies goal: usage, revenue, or retention versus default risk", "Segments users by repayment behavior and utilization", "Discusses risk guardrails and regulatory constraints qualitatively", "Proposes controlled rollout or score-based eligibility", "Defines monitoring metrics for delinquency and engagement"]),
  q("pa-case-med-024", "fintech", "Referral program design",
    "Design a referral program for a payments app targeting student users. What key decisions would you analyze?",
    ["case-interview", "growth", "product-strategy"], ["referrals", "incentives", "unit-economics"], SOURCES.productSense,
    ["Defines referrer and referee incentives and fraud prevention", "Estimates cost per acquisition versus other channels", "Considers cap rules, verification, and payout timing", "Identifies metrics such as viral coefficient and quality of referred users", "Recommends pilot geography or cohort before full launch"]),
  q("pa-case-med-025", "fintech", "Merchant adoption lag",
    "Small merchants sign up but few accept payments in the first week. What would you investigate?",
    ["case-interview", "adoption", "funnel-analysis"], ["merchants", "activation", "support"], SOURCES.case,
    ["Defines activation milestone such as first successful transaction", "Segments by category, city, and onboarding channel", "Investigates hardware, training, pricing, or trust barriers", "Reviews competitor merchant value proposition", "Recommends onboarding improvements and success metrics"]),
  q("pa-case-med-026", "fintech", "Bill pay reminder feature",
    "Should the app add smart bill-pay reminders? Build a case for or against.",
    ["case-interview", "feature-evaluation", "prioritization"], ["bill-pay", "engagement", "roi"], SOURCES.productSense,
    ["Estimates addressable users with recurring bills and missed payments", "Assesses engagement, retention, and cross-sell potential", "Considers notification fatigue and development cost", "Compares with alternative features on impact-effort basis", "States clear go or no-go with assumptions"]),
  q("pa-case-med-027", "fintech", "Pricing subscription tier",
    "A wealth app plans a premium subscription. What analyses support pricing and packaging decisions?",
    ["case-interview", "pricing", "monetization"], ["subscription", "willingness-to-pay", "segmentation"], SOURCES.case,
    ["Identifies target segment and value drivers for premium features", "Discusses competitive pricing and anchoring qualitatively", "Suggests survey, conjoint, or A/B price tests where feasible", "Models simple uptake scenarios at different price points", "Recommends packaging and trial strategy"]),
  q("pa-case-med-028", "fintech", "Fraud false decline complaints",
    "Customer complaints about false payment declines rose 30%. How would you balance fraud prevention and UX?",
    ["case-interview", "tradeoffs", "product-analytics"], ["fraud", "customer-experience", "metrics"], SOURCES.case,
    ["Quantifies decline rate, complaint rate, and fraud loss trends", "Segments by transaction type, amount, and user tenure", "Collaborates with risk on threshold and step-up auth options", "Proposes user messaging and retry flows to reduce friction", "Defines joint metrics for fraud loss and successful completions"]),

  // Enterprise SaaS (8)
  q("pa-case-med-029", "enterprise", "Trial-to-paid conversion",
    "B2B SaaS trial conversion fell from 18% to 14%. Structure your analysis.",
    ["case-interview", "saas", "conversion"], ["trial", "funnel-analysis", "b2b"], SOURCES.productSense,
    ["Verifies cohort definitions and seasonality effects", "Segments by company size, industry, and acquisition source", "Analyzes product usage milestones during trial", "Reviews sales follow-up and pricing changes", "Recommends product or process experiments with owners"]),
  q("pa-case-med-030", "enterprise", "Seat expansion opportunity",
    "Accounts use only 30% of purchased seats. How would you identify expansion opportunities?",
    ["case-interview", "saas", "growth"], ["expansion", "usage-analytics", "account-health"], SOURCES.case,
    ["Defines seat utilization and active user metrics per account", "Flags accounts with high usage near seat cap or team growth signals", "Prioritizes sales or in-product upsell triggers", "Considers churn risk on underutilized accounts separately", "Proposes dashboard or playbook for customer success"]),
  q("pa-case-med-031", "enterprise", "Feature adoption low",
    "A newly launched analytics module has 5% adoption among eligible customers. What next steps?",
    ["case-interview", "adoption", "product-analytics"], ["feature-launch", "enablement", "diagnosis"], SOURCES.productSense,
    ["Checks discoverability, permissions, and onboarding for the module", "Segments adopters versus non-adopters for behavioral differences", "Gathers qualitative feedback from CS and power users", "Proposes in-app guidance, training, or packaging changes", "Sets adoption targets and re-measurement timeline"]),
  q("pa-case-med-032", "enterprise", "Churn early warning",
    "Design a simple framework to flag accounts at risk of churning next quarter.",
    ["case-interview", "saas", "retention"], ["churn", "health-score", "metrics"], SOURCES.case,
    ["Selects leading indicators such as login decline, support tickets, or payment issues", "Defines account health tiers with transparent rules", "Avoids over-complex black-box scoring for first version", "Aligns with customer success playbooks for intervention", "Plans backtesting on historical churned accounts"]),
  q("pa-case-med-033", "enterprise", "Annual vs monthly pricing",
    "Finance proposes pushing annual plans with a discount. Analyze customer and revenue impact.",
    ["case-interview", "pricing", "saas"], ["billing", "cash-flow", "retention"], SOURCES.productSense,
    ["Compares LTV, cash flow timing, and churn differences by billing period", "Segments customers likely to prefer annual versus monthly", "Models simple revenue scenarios with uptake assumptions", "Considers downgrade and refund policy implications", "Recommends test or targeted campaign rather than forced migration"]),
  q("pa-case-med-034", "enterprise", "Integration request backlog",
    "Sales requests many third-party integrations. How do you prioritize as product analyst?",
    ["case-interview", "prioritization", "roadmap"], ["integrations", "impact-effort", "b2b"], SOURCES.case,
    ["Quantifies revenue tied to each integration request", "Groups requests by platform type and maintenance burden", "Considers strategic partnerships versus one-off builds", "Uses scoring framework shared with product and engineering", "Communicates roadmap trade-offs to sales transparently"]),
  q("pa-case-med-035", "enterprise", "NPS detractor themes",
    "NPS dropped 8 points and detractors cite 'hard to use.' How do you turn feedback into action?",
    ["case-interview", "voice-of-customer", "product-analytics"], ["nps", "qualitative", "prioritization"], SOURCES.productSense,
    ["Validates sample size and segment mix of NPS respondents", "Themes open-text comments into actionable issue buckets", "Links themes to product areas and support ticket data", "Prioritizes fixes by frequency and severity", "Defines follow-up survey or metric to track recovery"]),
  q("pa-case-med-036", "enterprise", "Usage-based pricing debate",
    "Product debates moving from flat seats to usage-based pricing. What analysis would you provide?",
    ["case-interview", "pricing", "strategy"], ["usage-based", "segmentation", "tradeoffs"], SOURCES.case,
    ["Maps current usage distribution across customers", "Identifies winners and losers under usage-based model", "Discusses predictability for customers and revenue volatility for company", "Suggests hybrid model or caps as compromise", "Recommends pilot with transparent customer communication"]),

  // Startup (6)
  q("pa-case-med-037", "startup", "Burn versus growth",
    "A startup burns cash quickly while chasing user growth. What metrics and questions would you raise in a product review?",
    ["case-interview", "startup", "metrics"], ["unit-economics", "growth", "sustainability"], SOURCES.productSense,
    ["Separates vanity growth from retained engaged users", "Asks about CAC, payback, and contribution margin qualitatively", "Examines channel quality and cohort retention", "Highlights runway and focus trade-offs", "Recommends metric hierarchy aligned to stage"]),
  q("pa-case-med-038", "startup", "Pivot decision support",
    "Weekly retention improved slightly but acquisition stalled after a pivot. How would you advise founders?",
    ["case-interview", "startup", "strategy"], ["pivot", "retention", "pmf"], SOURCES.productSense,
    ["Clarifies hypothesis the pivot was testing", "Compares leading indicators across old and new user cohorts", "Assesses whether acquisition or product value is the bottleneck", "Recommends focused experiments rather than broad changes", "Sets explicit success criteria and timeline for next decision"]),
  q("pa-case-med-039", "startup", "Limited analytics stack",
    "You join a startup with only basic event tracking. What do you instrument first?",
    ["case-interview", "startup", "product-analytics"], ["instrumentation", "prioritization", "metrics"], SOURCES.case,
    ["Identifies core funnel aligned to business model", "Prioritizes high-leverage events over exhaustive tracking", "Ensures identity, timestamps, and key properties are reliable", "Defers advanced analytics until core metrics are trustworthy", "Documents definitions for team alignment"]),
  q("pa-case-med-040", "startup", "Fake door test",
    "Explain how you would run a fake-door test to validate demand for a premium feature before building it.",
    ["case-interview", "experimentation", "product-strategy"], ["fake-door", "validation", "mvp"], SOURCES.productSense,
    ["Describes exposing UI entry point without full backend implementation", "Defines primary metric such as click or signup intent rate", "Notes ethical UX such as clear messaging after click", "Plans segment analysis and qualitative follow-up", "Sets go/no-go criteria for build investment"]),
  q("pa-case-med-041", "startup", "City expansion choice",
    "A ride-hailing startup can launch in only one new city next quarter. How would you compare options?",
    ["case-interview", "market-entry", "guesstimate"], ["expansion", "prioritization", "supply-demand"], SOURCES.guesstimate,
    ["Lists factors such as demand, supply availability, regulation, and competition", "Uses rough sizing or proxy metrics where data is limited", "Considers operational complexity and unit economics", "Recommends pilot approach and success metrics", "States assumptions openly due to uncertainty"]),
  q("pa-case-med-042", "startup", "Investor metric dashboard",
    "Founders need a weekly dashboard for investors. Which five metrics would you include for a consumer app?",
    ["case-interview", "startup", "metrics"], ["reporting", "kpis", "investors"], SOURCES.productSense,
    ["Picks metrics tied to growth, engagement, retention, and monetization", "Avoids vanity counts without context", "Ensures definitions are consistent week to week", "Includes one quality or cohort metric not only totals", "Keeps dashboard concise and actionable"]),

  // Service / consulting (8)
  q("pa-case-med-043", "service", "Client ROI for analytics project",
    "A retail client asks whether a customer segmentation project is worth 10 weeks of work. How do you build the business case?",
    ["case-interview", "consulting", "roi"], ["business-case", "segmentation", "stakeholders"], SOURCES.case,
    ["Clarifies client decision the segmentation will drive", "Estimates benefit levers such as campaign lift or inventory efficiency", "Compares benefit range to project cost and timeline", "Identifies data readiness risks", "Recommends phased approach or pilot if uncertainty is high"]),
  q("pa-case-med-044", "service", "Ambiguous client request",
    "A client says they want 'AI' to improve sales but provides no detail. What do you do in the first meeting?",
    ["case-interview", "consulting", "problem-framing"], ["scoping", "stakeholders", "discovery"], SOURCES.case,
    ["Asks clarifying questions on business pain, decisions, and data", "Reframes request into measurable problem statement", "Sets expectations on feasibility and timeline", "Proposes discovery phase before solution commitment", "Documents assumptions and next steps"]),
  q("pa-case-med-045", "service", "Profit decline case",
    "A client's profit declined 15% despite stable revenue. Structure your analysis.",
    ["case-interview", "consulting", "profitability"], ["cost-analysis", "structure", "recommendation"], SOURCES.case,
    ["Breaks profit into revenue and cost components", "Investigates variable costs, mix shift, and one-time expenses", "Compares segments such as product lines or regions", "Forms hypotheses and data requests systematically", "Delivers prioritized recommendations with quick wins and long-term fixes"]),
  q("pa-case-med-046", "service", "Market entry for retailer",
    "Should a domestic retailer enter an adjacent country market? Outline your case approach.",
    ["case-interview", "market-entry", "consulting"], ["market-sizing", "competition", "risk"], SOURCES.guesstimate,
    ["Assesses market size, growth, and customer fit", "Evaluates regulatory, supply chain, and brand challenges", "Compares entry modes such as partnership versus owned ops", "Quantifies investment and breakeven qualitatively", "States recommendation with key sensitivities"]),
  q("pa-case-med-047", "service", "Operations bottleneck",
    "A warehouse client faces delayed shipments. How would you analyze bottlenecks as a business analyst?",
    ["case-interview", "operations", "consulting"], ["process-analysis", "throughput", "root-cause"], SOURCES.case,
    ["Maps process steps from order to dispatch", "Identifies constraint step using volume and time data", "Distinguishes staffing, layout, system, or supplier causes", "Quantifies impact of bottleneck on SLA", "Recommends targeted improvements with expected uplift"]),
  q("pa-case-med-048", "service", "Pricing workshop output",
    "After a pricing workshop, three business units propose conflicting price changes. How do you facilitate alignment?",
    ["case-interview", "consulting", "pricing"], ["stakeholders", "facilitation", "tradeoffs"], SOURCES.case,
    ["Documents each proposal's assumptions and expected impact", "Compares customer segment and margin effects", "Uses common framework such as price waterfall or elasticity discussion", "Surfaces enterprise-level constraints and brand consistency", "Drives toward decision or controlled test plan"]),
  q("pa-case-med-049", "service", "Data quality escalation",
    "Client dashboards show conflicting sales numbers across teams. How do you resolve as analyst on the project?",
    ["case-interview", "data-quality", "consulting"], ["metrics-governance", "alignment", "debugging"], SOURCES.case,
    ["Traces definitions, sources, and refresh timing for each number", "Identifies transformation or filter differences", "Facilitates agreement on single source of truth", "Documents metric dictionary for client", "Implements validation checks to prevent recurrence"]),
  q("pa-case-med-050", "service", "Change management for new KPI",
    "You introduce a new KPI for store managers. How do you ensure adoption and correct use?",
    ["case-interview", "change-management", "consulting"], ["kpi", "training", "adoption"], SOURCES.case,
    ["Explains why the KPI matters and how it links to incentives", "Provides simple definitions and worked examples", "Plans training, office hours, and feedback loop", "Monitors misuse patterns and clarifies FAQs", "Iterates definition if gaming or confusion appears"]),
];

// ── Aptitude MCQ (25) ─────────────────────────────────────────────────
const aptitudeMcqs = [
  m("pa-apt-mcq-001", "service", "Simple interest",
    "Find the simple interest on Rs. 8,000 at 5% per annum for 3 years.",
    ["aptitude", "quantitative"], ["simple-interest", "percentage"], SOURCES.aptitude,
    ["Rs. 1,000", "Rs. 1,200", "Rs. 1,500", "Rs. 800"], "B", "SI = P×R×T/100 = 8000×5×3/100 = Rs. 1,200."),
  m("pa-apt-mcq-002", "service", "Percentage increase",
    "A product's price rises from Rs. 400 to Rs. 500. What is the percentage increase?",
    ["aptitude", "quantitative"], ["percentage", "change"], SOURCES.aptitude,
    ["20%", "25%", "30%", "15%"], "B", "Increase = 100/400 = 25%."),
  m("pa-apt-mcq-003", "ecommerce", "Profit margin",
    "An item costs Rs. 600 and sells for Rs. 750. What is the profit margin on selling price?",
    ["aptitude", "quantitative"], ["profit", "margin"], SOURCES.aptitude,
    ["20%", "25%", "30%", "15%"], "A", "Profit = 150; margin on SP = 150/750 = 20%."),
  m("pa-apt-mcq-004", "product", "Ratio division",
    "Divide Rs. 1,200 among A, B, and C in the ratio 2:3:5. What is C's share?",
    ["aptitude", "quantitative"], ["ratio", "division"], SOURCES.aptitude,
    ["Rs. 240", "Rs. 360", "Rs. 600", "Rs. 480"], "C", "Total parts = 10; C gets 5/10 × 1200 = Rs. 600."),
  m("pa-apt-mcq-005", "fintech", "Compound growth",
    "Revenue grows 10% monthly from Rs. 1,00,000. Approximate revenue after 2 months?",
    ["aptitude", "quantitative"], ["growth", "compound"], SOURCES.aptitude,
    ["Rs. 1,10,000", "Rs. 1,20,000", "Rs. 1,21,000", "Rs. 1,30,000"], "C", "After 2 months: 100000 × 1.1 × 1.1 = Rs. 1,21,000."),
  m("pa-apt-mcq-006", "enterprise", "Average speed",
    "A car travels 60 km at 30 km/h and returns 60 km at 60 km/h. What is the average speed for the whole trip?",
    ["aptitude", "quantitative"], ["speed", "average"], SOURCES.aptitude,
    ["40 km/h", "45 km/h", "50 km/h", "35 km/h"], "A", "Total distance 120 km; time = 2 + 1 = 3 h; average = 40 km/h."),
  m("pa-apt-mcq-007", "startup", "Break-even units",
    "Fixed cost Rs. 50,000; variable cost Rs. 20 per unit; price Rs. 70 per unit. Break-even units?",
    ["aptitude", "quantitative"], ["break-even", "unit-economics"], SOURCES.aptitude,
    ["500", "1,000", "750", "1,250"], "B", "Contribution = 50; BE = 50000/50 = 1,000 units."),
  m("pa-apt-mcq-008", "service", "Logical syllogism",
    "All analysts use spreadsheets. Rahul is an analyst. Which conclusion follows?",
    ["aptitude", "logical-reasoning"], ["syllogism", "deduction"], SOURCES.aptitude,
    ["Rahul uses spreadsheets", "Rahul does not use spreadsheets", "All spreadsheet users are analysts", "None follows"], "A", "If all analysts use spreadsheets and Rahul is an analyst, Rahul uses spreadsheets."),
  m("pa-apt-mcq-009", "product", "Number series",
    "Find the next number: 2, 6, 12, 20, 30, ?",
    ["aptitude", "logical-reasoning"], ["series", "pattern"], SOURCES.aptitude,
    ["40", "42", "44", "38"], "B", "Differences are +4, +6, +8, +10, so next +12 gives 42."),
  m("pa-apt-mcq-010", "ecommerce", "Table interpretation",
    "A store sold 200 units in Q1 and 250 in Q2. What was the Q1-to-Q2 growth rate?",
    ["aptitude", "data-interpretation"], ["tables", "growth"], SOURCES.aptitude,
    ["20%", "25%", "30%", "50%"], "B", "Growth = (250-200)/200 = 25%."),
  m("pa-apt-mcq-011", "fintech", "Probability coin",
    "A fair coin is tossed twice. What is the probability of exactly one head?",
    ["aptitude", "quantitative"], ["probability", "counting"], SOURCES.aptitude,
    ["1/4", "1/2", "3/4", "1/3"], "B", "Outcomes HT, TH out of 4 equally likely; probability = 2/4 = 1/2."),
  m("pa-apt-mcq-012", "enterprise", "Work efficiency",
    "A completes a task in 12 days, B in 18 days. Working together, how many days to finish?",
    ["aptitude", "quantitative"], ["work-rate", "combined"], SOURCES.aptitude,
    ["7.2 days", "8 days", "6 days", "9 days"], "A", "Combined rate 1/12 + 1/18 = 5/36; time = 36/5 = 7.2 days."),
  m("pa-apt-mcq-013", "startup", "CAGR approximation",
    "Revenue grows from Rs. 10L to Rs. 12.1L in 2 years. Approximate CAGR?",
    ["aptitude", "quantitative"], ["cagr", "growth"], SOURCES.aptitude,
    ["10%", "8%", "12%", "15%"], "A", "1.21 = (1+r)^2 so r ≈ 10%."),
  m("pa-apt-mcq-014", "service", "Direction sense",
    "Facing north, you turn right, then right again, then left. Which direction are you facing?",
    ["aptitude", "logical-reasoning"], ["direction", "spatial"], SOURCES.aptitude,
    ["East", "West", "North", "South"], "A", "North → east → south → east."),
  m("pa-apt-mcq-015", "product", "Weighted average",
    "Product A: 100 units at Rs. 10. Product B: 50 units at Rs. 16. Weighted average price?",
    ["aptitude", "quantitative"], ["weighted-average", "mix"], SOURCES.aptitude,
    ["Rs. 11", "Rs. 12", "Rs. 13", "Rs. 14"], "B", "Total value 1000+800=1800; units 150; avg = 12."),
  m("pa-apt-mcq-016", "ecommerce", "Discount stacking",
    "Price Rs. 2,000 with 10% off, then additional 10% on reduced price. Final price?",
    ["aptitude", "quantitative"], ["discount", "sequential"], SOURCES.aptitude,
    ["Rs. 1,600", "Rs. 1,620", "Rs. 1,800", "Rs. 1,700"], "B", "After first: 1800; second 10% off → 1620."),
  m("pa-apt-mcq-017", "fintech", "Ratio to percentage",
    "In a portfolio, debt to equity is 3:2. What percentage is debt of total?",
    ["aptitude", "quantitative"], ["ratio", "percentage"], SOURCES.aptitude,
    ["40%", "50%", "60%", "75%"], "C", "Debt share = 3/(3+2) = 60%."),
  m("pa-apt-mcq-018", "enterprise", "Clock angle",
    "At 3:00, what is the angle between hour and minute hands?",
    ["aptitude", "logical-reasoning"], ["clocks", "angles"], SOURCES.aptitude,
    ["90°", "60°", "120°", "45°"], "A", "At 3:00 the hands are perpendicular: 90°."),
  m("pa-apt-mcq-019", "startup", "Market share math",
    "Company A has 40% share, B has 30%. Rest is others. Others' share?",
    ["aptitude", "data-interpretation"], ["market-share", "subtraction"], SOURCES.aptitude,
    ["20%", "25%", "30%", "35%"], "C", "100% - 40% - 30% = 30%."),
  m("pa-apt-mcq-020", "service", "Coding-decoding",
    "If ANALYST is coded as BOBMZTU, how is DATA coded?",
    ["aptitude", "logical-reasoning"], ["coding", "pattern"], SOURCES.aptitude,
    ["EBUB", "EBUZ", "FBUB", "EBVB"], "A", "Each letter +1: DATA → EBUB."),
  m("pa-apt-mcq-021", "product", "Pie chart read",
    "In a pie chart, 25% represents marketing spend of Rs. 5L. Total budget?",
    ["aptitude", "data-interpretation"], ["pie-chart", "percentage"], SOURCES.aptitude,
    ["Rs. 15L", "Rs. 20L", "Rs. 25L", "Rs. 10L"], "B", "5L is 25% so total = 5/0.25 = Rs. 20L."),
  m("pa-apt-mcq-022", "ecommerce", "Unit conversion",
    "An app has 2 million MAU and 20% DAU/MAU ratio. Approximate DAU?",
    ["aptitude", "data-interpretation"], ["metrics", "ratios"], SOURCES.aptitude,
    ["200,000", "400,000", "100,000", "2,000,000"], "B", "DAU = 20% of 2M = 400,000."),
  m("pa-apt-mcq-023", "fintech", "Installment interest",
    "Rs. 12,000 loan repaid as Rs. 1,100 × 12 months. Total interest paid?",
    ["aptitude", "quantitative"], ["interest", "installment"], SOURCES.aptitude,
    ["Rs. 1,200", "Rs. 1,320", "Rs. 1,100", "Rs. 2,400"], "A", "Total paid 13,200; interest = 13,200 - 12,000 = 1,200."),
  m("pa-apt-mcq-024", "enterprise", "Set overlap",
    "In a survey, 60% use Tool X, 50% use Tool Y, 30% use both. What percent use at least one?",
    ["aptitude", "quantitative"], ["sets", "venn"], SOURCES.aptitude,
    ["80%", "70%", "90%", "100%"], "A", "P(A∪B) = 60+50-30 = 80%."),
  m("pa-apt-mcq-025", "startup", "Run rate",
    "Monthly revenue is Rs. 8L in March. Assuming no seasonality, annual run rate?",
    ["aptitude", "quantitative"], ["run-rate", "annualization"], SOURCES.aptitude,
    ["Rs. 80L", "Rs. 96L", "Rs. 88L", "Rs. 72L"], "B", "8L × 12 months = Rs. 96L annual run rate."),
];

// ── HR Behavioral (15) ──────────────────────────────────────────────────
const hrQuestions = [
  h("pa-hr-med-001", "product", "Why product analyst role",
    "Why do you want to become a product analyst, and why at our company?",
    ["hr", "behavioral", "motivation"], ["career-fit", "company-research", "communication"], SOURCES.hr,
    ["Gives a specific, genuine link between personal strengths and the analyst role", "Shows understanding of what product analysts do day to day", "References concrete company products, users, or mission", "Avoids generic or purely financial answers", "Connects past projects or coursework to the role"],
    ["motivation", "roleUnderstanding", "companyFit"]),
  h("pa-hr-med-002", "ecommerce", "Ambiguous assignment",
    "Tell me about a time you received an unclear assignment. How did you deliver useful output?",
    ["hr", "behavioral", "problem-solving"], ["ambiguity", "clarification", "ownership"], SOURCES.hr,
    ["Describes a specific situation with context and stakes", "Explains how they asked questions and aligned on success criteria", "Shows proactive structure rather than waiting passively", "Shares measurable or concrete outcome", "Reflects on what they learned"],
    ["situationClarity", "actionOwnership", "resultSpecificity", "reflection"]),
  h("pa-hr-med-003", "enterprise", "Stakeholder disagreement",
    "Describe a time two stakeholders wanted conflicting priorities. How did you handle it?",
    ["hr", "behavioral", "stakeholders"], ["conflict", "facilitation", "prioritization"], SOURCES.hr,
    ["Sets up conflicting priorities clearly without blaming", "Explains data or framework used to compare options", "Demonstrates respectful facilitation and listening", "Shows outcome or agreed decision path", "Reflects on communication lessons"],
    ["situationClarity", "actionOwnership", "resultSpecificity", "reflection"]),
  h("pa-hr-med-004", "service", "Tight deadline",
    "Tell me about a time you had to analyze something quickly with incomplete data. What did you do?",
    ["hr", "behavioral", "pressure"], ["deadline", "judgment", "communication"], SOURCES.hr,
    ["Acknowledges time and data constraints honestly", "Prioritizes the most decision-critical analyses first", "States assumptions explicitly to stakeholders", "Delivers actionable recommendation or next steps", "Notes what they would improve with more time"],
    ["situationClarity", "actionOwnership", "resultSpecificity", "reflection"]),
  h("pa-hr-med-005", "fintech", "Data mistake",
    "Tell me about a time you made a mistake in an analysis or report. How did you respond?",
    ["hr", "behavioral", "integrity"], ["mistake", "accountability", "learning"], SOURCES.hr,
    ["Admits the mistake specifically without deflecting blame", "Explains how they detected or owned the error quickly", "Describes corrective actions and stakeholder communication", "Shares process changes to prevent recurrence", "Shows maturity and learning"],
    ["situationClarity", "actionOwnership", "resultSpecificity", "reflection"]),
  h("pa-hr-med-006", "startup", "Initiative without authority",
    "Give an example of when you drove an improvement though you were not the official leader.",
    ["hr", "behavioral", "leadership"], ["initiative", "influence", "ownership"], SOURCES.hr,
    ["Identifies a clear problem worth solving", "Shows how they influenced others without formal authority", "Describes personal actions and collaboration", "Quantifies or qualifies impact where possible", "Reflects on influence skills used"],
    ["situationClarity", "actionOwnership", "resultSpecificity", "reflection"]),
  h("pa-hr-med-007", "product", "Difficult feedback",
    "Tell me about a time you received tough feedback on your work. How did you use it?",
    ["hr", "behavioral", "growth"], ["feedback", "learning", "resilience"], SOURCES.hr,
    ["Describes feedback specifically and initial reaction honestly", "Shows constructive response and behavior change", "Links to improved outcome in a later situation", "Avoids defensiveness or blaming the reviewer", "Demonstrates growth mindset"],
    ["situationClarity", "actionOwnership", "resultSpecificity", "reflection"]),
  h("pa-hr-med-008", "ecommerce", "Team conflict",
    "Describe a conflict within a team project. What role did you play in resolving it?",
    ["hr", "behavioral", "teamwork"], ["conflict", "collaboration", "communication"], SOURCES.hr,
    ["Explains conflict source neutrally", "Shows active listening and empathy", "Describes concrete steps taken toward resolution", "Shares project or relationship outcome", "Reflects on personal contribution"],
    ["situationClarity", "actionOwnership", "resultSpecificity", "reflection"]),
  h("pa-hr-med-009", "enterprise", "Learning new tool",
    "Tell me about a time you had to learn a new analytics tool or method quickly for a project.",
    ["hr", "behavioral", "learning"], ["self-learning", "adaptability", "project"], SOURCES.hr,
    ["Names the tool or method and why it was needed", "Explains learning approach such as docs, peers, or tutorials", "Connects learning to project delivery", "Shares outcome or skill retained", "Shows resourcefulness"],
    ["situationClarity", "actionOwnership", "resultSpecificity", "reflection"]),
  h("pa-hr-med-010", "service", "Presenting to non-technical audience",
    "Describe a time you explained data findings to people without a technical background.",
    ["hr", "behavioral", "communication"], ["storytelling", "stakeholders", "simplicity"], SOURCES.hr,
    ["Identifies audience and their decision needs", "Avoids jargon and uses visuals or analogies", "Focuses on so-what and recommended action", "Handles questions thoughtfully", "Result shows understanding or decision made"],
    ["situationClarity", "actionOwnership", "resultSpecificity", "reflection"]),
  h("pa-hr-med-011", "fintech", "Ethical dilemma",
    "Tell me about a situation where you felt pressure to present data in a misleading way. What did you do?",
    ["hr", "behavioral", "integrity"], ["ethics", "integrity", "courage"], SOURCES.hr,
    ["Describes pressure without exaggerating villain narrative", "Shows commitment to accurate representation", "Explains how they communicated risks or limitations", "Outcome may include compromise but integrity remains", "Reflects on professional standards"],
    ["situationClarity", "actionOwnership", "resultSpecificity", "reflection"]),
  h("pa-hr-med-012", "startup", "Failure project",
    "Tell me about a project that did not go as planned. What happened and what did you learn?",
    ["hr", "behavioral", "failure"], ["failure", "learning", "resilience"], SOURCES.hr,
    ["Shares honest context and their role", "Avoids blaming others exclusively", "Identifies specific lessons on planning, data, or communication", "Shows behavior change afterward", "Demonstrates resilience"],
    ["situationClarity", "actionOwnership", "resultSpecificity", "reflection"]),
  h("pa-hr-med-013", "product", "Prioritizing personal workload",
    "Describe a time you had multiple urgent requests. How did you prioritize?",
    ["hr", "behavioral", "prioritization"], ["time-management", "stakeholders", "judgment"], SOURCES.hr,
    ["Lists competing requests and business impact", "Explains prioritization criteria transparently", "Communicates trade-offs to stakeholders proactively", "Delivers on the most critical items", "Reflects on improving prioritization"],
    ["situationClarity", "actionOwnership", "resultSpecificity", "reflection"]),
  h("pa-hr-med-014", "ecommerce", "User empathy",
    "Tell me about a time you advocated for the user or customer in a product decision.",
    ["hr", "behavioral", "customer-focus"], ["user-advocacy", "empathy", "product"], SOURCES.hr,
    ["Identifies user pain with specific evidence or observation", "Explains how they brought voice-of-customer into decision", "Shows collaboration with product or business teams", "Shares outcome for users or metrics", "Reflects on customer-centric mindset"],
    ["situationClarity", "actionOwnership", "resultSpecificity", "reflection"]),
  h("pa-hr-med-015", "service", "Why should we hire you",
    "Why should we hire you for this fresher product analyst role?",
    ["hr", "behavioral", "closing"], ["self-assessment", "fit", " strengths"], SOURCES.hr,
    ["Highlights 2-3 relevant strengths with brief evidence", "Connects strengths to role requirements analytically", "Shows enthusiasm and willingness to learn", "Avoids unsubstantiated superlatives", "Ends with clear value proposition to the team"],
    ["situationClarity", "actionOwnership", "resultSpecificity", "reflection"]),
];

const companyTagsFor = (category, index) => {
  const companies = COMPANIES[category];
  return Array.from({ length: 4 }, (_, offset) => companies[(index * 4 + offset) % companies.length]);
};

const caseRubricFor = (criteria) =>
  criteria.map((text, index) => ({
    text,
    category: ["structure", "assumptions", "analysis", "recommendation", "communication"][index] || "coverage",
    importance: index < 3 ? "mustHave" : "goodToHave",
    expectedAnswerMode: "conceptual",
  }));

const hrRubricFor = (criteria) =>
  criteria.map((text, index) => ({
    text,
    category: ["situationClarity", "actionOwnership", "resultSpecificity", "reflection", "communication"][index] || "coverage",
    importance: index < 3 ? "mustHave" : "goodToHave",
    expectedAnswerMode: "story",
  }));

const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const writeCsv = async (fileName, columns, rows) => {
  const output = [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n");
  await fs.writeFile(path.join(outputDir, fileName), `${output}\n`, "utf8");
};

const normalizeKey = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

await fs.mkdir(outputDir, { recursive: true });

const categoryOffsets = Object.fromEntries(Object.keys(COMPANIES).map((category) => [category, 0]));
const tagsForItem = (item) => {
  const index = categoryOffsets[item.category]++;
  return companyTagsFor(item.category, index);
};

const caseCsv = "pa-case-interview-medium-rubric-50.csv";
const aptitudeCsv = "pa-aptitude-medium-mcq-25.csv";
const hrCsv = "pa-hr-medium-behavioral-15.csv";

const rubricColumns = [
  "questionId", "title", "question", "companyTags", "topics", "subtopics", "url",
  "rubric", "source", "verified", "qualityScore",
];
const mcqColumns = [
  "questionId", "title", "question", "companyTags", "topics", "subtopics", "url",
  "optionA", "optionB", "optionC", "optionD", "correctOptionId", "explanation",
  "source", "verified", "qualityScore",
];
const hrColumns = [
  ...rubricColumns.slice(0, 8),
  "behavioralSignals",
  ...rubricColumns.slice(8),
];

await writeCsv(
  caseCsv,
  rubricColumns,
  caseQuestions.map((item) => ({
    questionId: item.id,
    title: item.title,
    question: item.question,
    companyTags: tagsForItem(item).join("|"),
    topics: item.topics.join("|"),
    subtopics: item.subtopics.join("|"),
    url: item.source,
    rubric: JSON.stringify(caseRubricFor(item.criteria)),
    source: "public_interview_pattern_curated",
    verified: "false",
    qualityScore: "0.9",
  }))
);

for (const key of Object.keys(categoryOffsets)) categoryOffsets[key] = 0;

await writeCsv(
  aptitudeCsv,
  mcqColumns,
  aptitudeMcqs.map((item) => ({
    questionId: item.id,
    title: item.title,
    question: item.question,
    companyTags: tagsForItem(item).join("|"),
    topics: item.topics.join("|"),
    subtopics: item.subtopics.join("|"),
    url: item.source,
    optionA: item.options[0],
    optionB: item.options[1],
    optionC: item.options[2],
    optionD: item.options[3],
    correctOptionId: item.answer,
    explanation: item.explanation,
    source: "public_interview_pattern_curated",
    verified: "false",
    qualityScore: "0.9",
  }))
);

for (const key of Object.keys(categoryOffsets)) categoryOffsets[key] = 0;

await writeCsv(
  hrCsv,
  hrColumns,
  hrQuestions.map((item) => ({
    questionId: item.id,
    title: item.title,
    question: item.question,
    companyTags: tagsForItem(item).join("|"),
    topics: item.topics.join("|"),
    subtopics: item.subtopics.join("|"),
    url: item.source,
    rubric: JSON.stringify(hrRubricFor(item.criteria)),
    behavioralSignals: (item.signals || []).join("|"),
    source: "public_interview_pattern_curated",
    verified: "false",
    qualityScore: "0.9",
  }))
);

const summary = {
  outputDir,
  files: [
    { name: caseCsv, roundType: "Case Interview", evaluationStrategy: "rubric_llm", rows: caseQuestions.length },
    { name: aptitudeCsv, roundType: "Aptitude", evaluationStrategy: "mcq_exact", rows: aptitudeMcqs.length },
    { name: hrCsv, roundType: "HR", evaluationStrategy: "behavioral_llm", rows: hrQuestions.length },
  ],
  roleTag: "Business/Product Analyst",
  totalRows: caseQuestions.length + aptitudeMcqs.length + hrQuestions.length,
};

const allNew = [...caseQuestions, ...aptitudeMcqs, ...hrQuestions];

if (process.env.MONGO_URI) {
  const mongoose = (await import("mongoose")).default;
  const InterviewQuestion = (await import("../models/InterviewQuestion.js")).default;
  const CompanyStatic = (await import("../models/CompanyStatic.js")).default;
  await mongoose.connect(process.env.MONGO_URI);

  const existing = await InterviewQuestion.find({}, { questionId: 1, title: 1, question: 1 }).lean();
  const knownCompanies = new Set(
    (await CompanyStatic.find({}, { name: 1 }).lean()).map((c) => c.name)
  );

  const existingIds = new Set(existing.map((row) => row.questionId));
  const existingTitleKeys = new Set(existing.map((row) => normalizeKey(row.title)));
  const existingQuestionKeys = new Set(existing.map((row) => normalizeKey(row.question?.slice(0, 120))));

  const unknownCompanies = new Set();
  for (const item of allNew) {
    for (const company of companyTagsFor(item.category, 0)) {
      if (!knownCompanies.has(company)) unknownCompanies.add(company);
    }
  }

  summary.dbDedupe = {
    duplicateIds: allNew.filter((item) => existingIds.has(item.id)).map((item) => item.id),
    duplicateTitles: allNew.filter((item) => existingTitleKeys.has(normalizeKey(item.title))).map((item) => item.title),
    duplicateQuestionPrefixes: allNew
      .filter((item) => existingQuestionKeys.has(normalizeKey(item.question.slice(0, 120))))
      .map((item) => item.id),
    unknownCompanies: [...unknownCompanies],
  };

  if (
    summary.dbDedupe.duplicateIds.length ||
    summary.dbDedupe.duplicateTitles.length ||
    summary.dbDedupe.duplicateQuestionPrefixes.length ||
    summary.dbDedupe.unknownCompanies.length
  ) {
    console.error(JSON.stringify(summary, null, 2));
    await mongoose.disconnect();
    process.exit(1);
  }
  await mongoose.disconnect();
}

console.log(JSON.stringify(summary, null, 2));
