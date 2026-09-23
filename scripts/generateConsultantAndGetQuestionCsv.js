import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "data", "generated-interview-imports");

const CONSULTANT_COMPANIES = {
  service: [
    "Accenture", "Deloitte", "EY", "Cognizant", "TCS NQT", "Infosys", "LTIMindtree",
    "ThoughtWorks", "ZS Associates", "Genpact", "Fractal Analytics", "Mphasis",
    "BRILLIO", "Prodapt", "GyanSys",
  ],
  enterprise: ["IBM", "Microsoft", "Oracle", "Cisco", "SAP", "Adobe"],
  fintech: ["Goldman Sachs", "JPMorganChase", "Intuit", "DE Shaw", "Morgan Stanley", "Visa"],
};

const GET_COMPANIES = {
  fintech: ["PhonePe", "Razorpay", "Goldman Sachs", "Intuit", "Groww", "Visa", "HSBC", "Wells Fargo"],
  service: ["Accenture", "TCS NQT", "Infosys", "Cognizant", "Deloitte", "EY", "LTIMindtree", "ThoughtWorks"],
  product: ["Google", "Samsung", "Qualcomm", "Nvidia", "Honeywell", "Dell Technologies", "Siemens", "ABB"],
  enterprise: ["Microsoft", "IBM", "Oracle", "Cisco", "Adobe", "SAP", "Atlassian", "HPE"],
  ecommerce: ["Amazon", "Flipkart", "Swiggy", "Meesho", "Lenskart", "Eternal Limited", "7-Eleven"],
  cyber: ["Sigmoid", "Palo Alto Networks", "ZScaler", "Saviynt", "IMPACT ANALYTICS", "Arctic Wolf"],
  semiconductors: ["Texas Instruments", "ARM", "Infineon", "Micron Semiconductors", "NXP", "Analog Devices"],
  startup: ["Rapido", "ShareChat", "Go Comet", "SeedlingLabs", "Mareana"],
  others: ["Acko", "Pure Storage", "Cadence", "MathCo", "BitGo", "NETGEAR"],
};

const SOURCES = {
  case: "https://www.preplounge.com/en/consulting-forum/consulting-case-interview-examples-142",
  guesstimate: "https://www.preplounge.com/en/case-interview-basics/market-sizing",
  hr: "https://www.geeksforgeeks.org/hr-interview-questions/",
  aptitude: "https://www.indiabix.com/aptitude/",
  cs: "https://www.geeksforgeeks.org/commonly-asked-c-programming-interview-questions-set-1/",
};

const q = (id, pool, title, question, topics, subtopics, criteria) => ({
  id, pool, title, question, topics, subtopics, criteria, source: SOURCES.case,
});
const m = (id, pool, title, question, topics, subtopics, options, answer, explanation, source) => ({
  id, pool, title, question, topics, subtopics, options, answer, explanation, source,
});
const h = (id, pool, title, question, topics, subtopics, criteria, signals) => ({
  id, pool, title, question, topics, subtopics, criteria, signals, source: SOURCES.hr,
});

const consultantCaseQuestions = [
  q("con-case-med-001", "service", "Profit decline diagnosis",
    "A retail client's profit fell 12% while revenue grew 5%. Structure your analysis and likely hypotheses.",
    ["case-interview", "profitability"], ["cost-analysis", "structure"], ["Segments profit into revenue, COGS, and opex", "Forms hypotheses on mix shift, discounting, or cost inflation", "Requests data by product line and region", "Prioritizes quick data pulls versus deep dives", "Ends with testable next steps"]),
  q("con-case-med-002", "service", "Market sizing tea stalls",
    "Estimate the number of tea stalls in Mumbai. State assumptions and calculate.",
    ["case-interview", "guesstimate"], ["market-sizing", "assumptions"], ["Breaks into population, consumption rate, and stalls per area", "States explicit assumptions with sanity check", "Clear step-by-step arithmetic", "Compares result to intuition or benchmarks", "Summarizes key drivers"]),
  q("con-case-med-003", "service", "Cost reduction for bank",
    "A bank asks you to cut operating cost by 8% in 12 months without hurting customer satisfaction. Outline approach.",
    ["case-interview", "operations"], ["cost-reduction", "financial-services"], ["Clarifies baseline cost buckets and constraints", "Separates structural versus discretionary spend", "Balances quick wins with sustainable changes", "Defines guardrail metrics for customer experience", "Proposes phased roadmap with owners"]),
  q("con-case-med-004", "service", "Market entry decision",
    "Should a domestic insurer enter a neighboring country market? What framework would you use?",
    ["case-interview", "market-entry"], ["strategy", "framework"], ["Assesses market size growth and regulation", "Evaluates competitive landscape and differentiation", "Estimates investment and breakeven qualitatively", "Lists risks such as compliance and brand", "Gives conditional go/no-go with criteria"]),
  q("con-case-med-005", "service", "Pricing strategy",
    "A SaaS client considers raising prices 10%. How would you evaluate impact?",
    ["case-interview", "pricing"], ["elasticity", "revenue"], ["Defines customer segments and willingness to pay", "Models churn and new sales effects qualitatively", "Compares to competitor pricing", "Recommends test or phased rollout", "States risks and monitoring metrics"]),
  q("con-case-med-006", "service", "Warehouse fulfillment bottleneck",
    "A warehouse client's order fulfillment SLA missed targets for three months. Diagnose and recommend.",
    ["case-interview", "operations"], ["bottleneck", "sla"], ["Maps process steps and locates constraint", "Checks staffing, layout, system, and supplier issues", "Quantifies impact where possible", "Prioritizes fixes by effort and SLA lift", "Defines monitoring after changes"]),
  q("con-case-med-007", "service", "Merger synergy case",
    "Two logistics firms merge. What synergy areas would you investigate first?",
    ["case-interview", "mergers"], ["synergies", "integration"], ["Identifies route overlap, fleet utilization, and back-office duplication", "Separates cost synergies from revenue cross-sell", "Flags integration risks and culture", "Suggests 100-day plan themes", "Quantifies order-of-magnitude where feasible"]),
  q("con-case-med-008", "service", "Breakeven for new product",
    "A manufacturer launches a new product line. How do you compute breakeven volume?",
    ["case-interview", "finance"], ["breakeven", "fixed-cost"], ["States fixed versus variable cost components", "Uses contribution margin per unit", "Breakeven = fixed costs divided by unit contribution", "Discusses sensitivity to price and volume", "Links to go-to-market assumptions"]),
  q("con-case-med-009", "service", "Customer churn root cause",
    "A telecom client loses 4% monthly subscribers. Structure root-cause analysis.",
    ["case-interview", "analytics"], ["churn", "diagnosis"], ["Segments churn by plan, tenure, and region", "Hypothesizes price, service quality, and competition", "Combines survey, usage, and billing data", "Prioritizes interventions by impact", "Defines success metrics for retention"]),
  q("con-case-med-010", "service", "Supply chain disruption",
    "A client's supply chain faced port delays. Advise short- and long-term actions.",
    ["case-interview", "supply-chain"], ["risk", "operations"], ["Quantifies affected SKUs and revenue at risk", "Short-term rerouting and safety stock options", "Long-term supplier diversification", "Communicates trade-offs on cost versus service", "Builds monitoring for future disruptions"]),
  q("con-case-med-011", "enterprise", "Digital transformation ROI",
    "An enterprise client spent heavily on ERP migration with unclear ROI. How do you assess value?",
    ["case-interview", "digital"], ["erp", "roi"], ["Defines baseline KPIs before migration", "Separates one-time costs from run-rate benefits", "Interviews stakeholders on adoption gaps", "Quantifies tangible and intangible benefits cautiously", "Recommends course correction if benefits lag"]),
  q("con-case-med-012", "enterprise", "Cloud migration case",
    "Should a client migrate legacy apps to cloud in one big bang or phased waves?",
    ["case-interview", "technology"], ["cloud", "migration"], ["Assesses app criticality and dependency map", "Compares risk, cost, and timeline of each approach", "Considers skill and operating model change", "Recommends phased approach with criteria for exceptions", "Defines success measures per wave"]),
  q("con-case-med-013", "fintech", "Fraud cost trade-off",
    "A payments client wants to cut fraud losses but fears false declines. Frame the decision.",
    ["case-interview", "fintech"], ["fraud", "tradeoffs"], ["Quantifies fraud loss versus false decline revenue impact", "Discusses threshold and review capacity", "Segments merchant or customer types", "Proposes pilot with guardrails", "Recommends metrics beyond accuracy"]),
  q("con-case-med-014", "service", "Organizational redesign",
    "A client has duplicate teams across regions after acquisitions. How would you approach org design?",
    ["case-interview", "organization"], ["post-merger", "design"], ["Maps current roles and decision rights", "Identifies duplication and gaps", "Balances centralization versus local autonomy", "Plans change management and timeline", "Defines KPIs for new operating model"]),
  q("con-case-med-015", "service", "Capacity planning",
    "A BPO client expects 30% call volume growth next festival season. Plan capacity.",
    ["case-interview", "operations"], ["capacity", "forecasting"], ["Forecasts volume by interval and channel", "Calculates headcount with shrinkage and occupancy", "Plans hiring and training lead times", "Considers overflow and technology options", "Defines contingency triggers"]),
  q("con-case-med-016", "service", "Product portfolio pruning",
    "A conglomerate has 200 SKUs with 40% contributing negligible margin. Recommend approach.",
    ["case-interview", "strategy"], ["portfolio", "sku-rationalization"], ["Segments SKUs by margin volume and strategic value", "Assesses customer impact of delisting", "Phases discontinuation with communication plan", "Reinvests savings in winners", "Monitors revenue leakage"]),
  q("con-case-med-017", "service", "Sales force effectiveness",
    "Sales productivity dropped despite higher headcount. Investigate.",
    ["case-interview", "sales"], ["productivity", "diagnosis"], ["Checks quota setting, territory design, and lead quality", "Compares ramp time for new hires", "Reviews compensation and activity metrics", "Interviews sales and customers qualitatively", "Prioritizes interventions"]),
  q("con-case-med-018", "service", "Working capital improvement",
    "A distributor has rising receivables and inventory. Improve working capital.",
    ["case-interview", "finance"], ["working-capital", "cash-flow"], ["Breaks into receivables, payables, and inventory days", "Identifies root causes by business unit", "Proposes credit policy, collection, and stock policies", "Quantifies cash release potential", "Sets targets and governance"]),
  q("con-case-med-019", "service", "Regulatory compliance cost",
    "New regulation increases compliance cost 15%. Advise the COO.",
    ["case-interview", "regulation"], ["compliance", "cost"], ["Maps processes affected by regulation", "Estimates one-time versus recurring cost", "Identifies automation or outsourcing options", "Prioritizes by risk of non-compliance", "Communicates trade-offs to leadership"]),
  q("con-case-med-020", "service", "Vendor consolidation",
    "Client uses 40 IT vendors. Build case for consolidation.",
    ["case-interview", "procurement"], ["vendor-management", "cost"], ["Quantifies spend and overlap by vendor", "Assesses risk of single-vendor dependence", "Proposes target vendor tiers and RFP approach", "Plans transition milestones", "Defines savings and service KPIs"]),
  q("con-case-med-021", "enterprise", "Data platform business case",
    "Client wants a central data platform. What benefits justify investment?",
    ["case-interview", "data"], ["business-case", "platform"], ["Lists use cases such as reporting, analytics, and ML", "Estimates cost of current fragmentation", "Compares build versus buy options", "Phases rollout by domain", "Defines adoption metrics"]),
  q("con-case-med-022", "fintech", "Branch network optimization",
    "A bank considers closing rural branches. Structure the analysis.",
    ["case-interview", "financial-services"], ["network", "optimization"], ["Analyzes branch P&L and customer activity", "Considers digital adoption and access alternatives", "Assesses regulatory and reputational risks", "Models customer migration scenarios", "Recommends phased closure or redesign"]),
  q("con-case-med-023", "service", "Manufacturing yield improvement",
    "Factory yield is 91% versus industry 95%. Outline improvement plan.",
    ["case-interview", "manufacturing"], ["yield", "quality"], ["Segments defects by line and root cause", "Compares to best-in-class practices", "Prioritizes quick fixes versus capital projects", "Sets statistical process control where relevant", "Defines target yield and timeline"]),
  q("con-case-med-024", "service", "Marketing spend ROI",
    "Marketing spend rose 20% but sales grew 5%. Diagnose.",
    ["case-interview", "marketing"], ["roi", "analytics"], ["Breaks spend by channel and campaign", "Checks attribution and lag effects", "Compares CAC and LTV by segment", "Identifies underperforming channels", "Recommends reallocation tests"]),
  q("con-case-med-025", "service", "Guesstimate cinema screens",
    "Estimate annual cinema ticket revenue for a tier-2 Indian city.",
    ["case-interview", "guesstimate"], ["market-sizing", "revenue"], ["Estimates population, visit frequency, ticket price", "Accounts for number of screens and occupancy", "Sanity-checks against national averages", "States assumptions clearly", "Provides reasonable range"]),
  q("con-case-med-026", "service", "Hospital wait time",
    "Emergency department wait times increased 40%. Recommend fixes.",
    ["case-interview", "healthcare"], ["operations", "wait-time"], ["Maps patient flow and bottleneck step", "Checks staffing, triage, and bed availability", "Considers fast-track for low acuity", "Balances quality and throughput", "Defines metrics post-intervention"]),
  q("con-case-med-027", "service", "Energy cost reduction",
    "A hotel chain wants to cut energy cost 10%. Approach?",
    ["case-interview", "operations"], ["energy", "hospitality"], ["Benchmarks consumption per room", "Identifies HVAC, lighting, and laundry drivers", "Evaluates capex versus opex measures", "Plans pilot property first", "Tracks savings and guest comfort"]),
  q("con-case-med-028", "service", "Inventory obsolescence",
    "Electronics distributor holds aging inventory worth crores. What do you recommend?",
    ["case-interview", "inventory"], ["obsolescence", "write-down"], ["Classifies inventory by age and demand forecast", "Options: discount, bundle, return to vendor, scrap", "Quantifies write-down impact on P&L", "Fixes purchasing and forecasting process", "Prevents recurrence"]),
  q("con-case-med-029", "service", "Public sector efficiency",
    "A government agency processing permits is backlogged 6 months. Improve service.",
    ["case-interview", "public-sector"], ["process", "backlog"], ["Maps steps and approval layers", "Identifies digitalization opportunities", "Sets SLAs and transparency metrics", "Plans change with stakeholder buy-in", "Phases quick wins"]),
  q("con-case-med-030", "service", "Customer segmentation",
    "A retailer has transaction data but no clear segments. How do you define segments for strategy?",
    ["case-interview", "analytics"], ["segmentation", "strategy"], ["Chooses behavioral and value-based variables", "Avoids over-segmenting for actionability", "Validates segments with business intuition", "Links segments to marketing and assortment actions", "Plans test and learn"]),
  q("con-case-med-031", "enterprise", "Cybersecurity investment",
    "CISO requests budget doubling after an incident. Evaluate request.",
    ["case-interview", "technology"], ["cybersecurity", "budget"], ["Assesses risk reduction versus current controls", "Prioritizes gaps by threat and impact", "Compares to industry benchmarks", "Proposes phased investments with metrics", "Balances prevention detection and response"]),
  q("con-case-med-032", "fintech", "Unit economics of neobank",
    "A neobank loses money per active user. Path to profitability?",
    ["case-interview", "fintech"], ["unit-economics", "strategy"], ["Breaks revenue and cost per user", "Identifies cross-sell and interchange levers", "Discusses CAC and retention trade-offs", "Sets milestone targets by cohort", "Recommends focus segments"]),
  q("con-case-med-033", "service", "Outsourcing vs insource",
    "Client debates insourcing IT support versus outsourcing. Framework?",
    ["case-interview", "strategy"], ["outsourcing", "make-buy"], ["Compares cost, quality, control, and speed", "Considers core versus non-core activities", "Evaluates transition risk and vendor market", "Recommends hybrid model if appropriate", "Defines decision criteria"]),
  q("con-case-med-034", "service", "Airline on-time performance",
    "On-time departure rate fell below 75%. Root cause and fix.",
    ["case-interview", "operations"], ["airline", "otp"], ["Analyzes delay codes: maintenance, crew, weather, turnaround", "Focuses on largest delay category first", "Coordinates ops, ground, and scheduling", "Sets realistic targets and accountability", "Monitors daily"]),
  q("con-case-med-035", "service", "Franchise expansion",
    "A QSR brand plans 100 new franchises in two years. Key risks?",
    ["case-interview", "growth"], ["franchise", "expansion"], ["Assesses franchisee selection and training", "Evaluates supply chain and quality control", "Models unit economics and cannibalization", "Plans support infrastructure", "Defines success KPIs per store"]),
  q("con-case-med-036", "service", "Talent retention",
    "Annual attrition hit 25% in consulting delivery team. Recommend actions.",
    ["case-interview", "hr-analytics"], ["retention", "consulting"], ["Segments exit reasons from exit interviews", "Compares compensation, project fit, and growth", "Distinguishes regrettable versus non-regrettable attrition", "Proposes targeted interventions", "Sets leading indicators"]),
  q("con-case-med-037", "service", "Carbon reduction target",
    "Manufacturing client committed to 30% emissions cut by 2030. High-level roadmap?",
    ["case-interview", "sustainability"], ["esg", "operations"], ["Baselines emissions by source", "Prioritizes energy, process, and logistics levers", "Estimates cost and feasibility", "Aligns with reporting standards", "Phases investments"]),
  q("con-case-med-038", "service", "Pricing for government tender",
    "How would you price a large fixed-bid government IT tender?",
    ["case-interview", "pricing"], ["bidding", "risk"], ["Estimates effort with contingency", "Includes risk premium for scope creep", "Compares to win probability and strategic value", "Defines cost floor versus target margin", "Plans contract terms mitigation"]),
  q("con-case-med-039", "service", "Post-merger culture integration",
    "Merged firms have conflicting sales cultures. Advise integration lead.",
    ["case-interview", "change-management"], ["culture", "pmi"], ["Diagnoses cultural differences with surveys and interviews", "Identifies shared values and non-negotiables", "Designs rituals, incentives, and leadership modeling", "Sets integration milestones", "Measures engagement"]),
  q("con-case-med-040", "service", "Call center script change",
    "New sales script lowered conversions. Evaluate and recommend.",
    ["case-interview", "operations"], ["experimentation", "sales"], ["Compares cohorts on script version", "Reviews qualitative agent feedback", "Checks if target segment changed", "Recommends A/B test or rollback", "Defines conversion and compliance metrics"]),
  q("con-case-med-041", "enterprise", "License audit risk",
    "Software license audit may expose compliance gap. Client asks for plan.",
    ["case-interview", "technology"], ["compliance", "software-asset"], ["Inventories deployments versus entitlements", "Quantifies exposure and negotiation options", "Fixes governance and discovery tools", "Communicates with legal and vendor", "Prevents future gap"]),
  q("con-case-med-042", "fintech", "Credit portfolio growth",
    "Lender wants 40% loan book growth in risky macro environment. Assess.",
    ["case-interview", "financial-services"], ["credit", "risk"], ["Stress-tests portfolio under adverse scenarios", "Reviews underwriting and collection capacity", "Balances growth versus NPA risk", "Recommends segment caps and monitoring", "Defines early warning indicators"]),
  q("con-case-med-043", "service", "Lean implementation",
    "Factory wants lean without prior experience. Where to start?",
    ["case-interview", "operations"], ["lean", "manufacturing"], ["Value stream map current state", "Pick pilot line for quick wins", "Train teams on basic tools", "Measure cycle time and waste", "Scale after proof"]),
  q("con-case-med-044", "service", "E-commerce returns cost",
    "Returns are 18% of GMV and rising. Reduce cost while keeping customers happy.",
    ["case-interview", "ecommerce"], ["returns", "cost"], ["Analyzes return reasons by category", "Improves listing accuracy and sizing tools", "Adjusts return policy trade-offs carefully", "Targets fraud and wardrobing", "Tracks NPS and return rate"]),
  q("con-case-med-045", "service", "Strategy offsite prep",
    "CEO asks you to prepare agenda for two-day strategy offsite. What topics and outputs?",
    ["case-interview", "strategy"], ["facilitation", "planning"], ["Aligns on vision and strategic pillars", "Includes external trends and competitive scan", "Balances aspiration with resource constraints", "Defines decisions needed not just discussions", "Plans follow-up owners and timelines"]),
  q("con-case-med-046", "service", "Procurement savings target",
    "CPO must find 7% savings on indirect spend in one year. Approach?",
    ["case-interview", "procurement"], ["savings", "negotiation"], ["Categories spend and addressable portion", "Uses benchmark and should-cost where possible", "Plans supplier negotiations and demand management", "Tracks savings definitions to avoid double counting", "Manages stakeholder expectations"]),
  q("con-case-med-047", "service", "New CEO first 100 days",
    "What analytics would you provide a new CEO in first 100 days?",
    ["case-interview", "strategy"], ["ceo", "diagnostics"], ["Financial and operational health dashboard", "Customer and employee pulse metrics", "Competitive and market trends", "Quick win and risk lists", "Clear data caveats"]),
  q("con-case-med-048", "service", "Water utility leakage",
    "City loses 30% water to leakage. Structure improvement program.",
    ["case-interview", "public-sector"], ["infrastructure", "operations"], ["Maps leakage by network zone", "Prioritizes pipe replacement versus detection tech", "Estimates cost and water saved", "Plans phased investment and billing impact", "Defines KPIs"]),
  q("con-case-med-049", "service", "Ambiguous client ask",
    "Client says improve performance but gives no metric. What do you do in week one?",
    ["case-interview", "problem-framing"], ["scoping", "stakeholders"], ["Interviews sponsors to define success metrics", "Documents current baseline performance", "Aligns scope, timeline, and deliverables", "Sets hypothesis-driven workplan", "Manages expectations in writing"]),
  q("con-case-med-050", "service", "Recommendation with weak data",
    "You must recommend a vendor with incomplete benchmark data. How do you proceed?",
    ["case-interview", "decision-making"], ["vendors", "uncertainty"], ["States assumptions and data gaps explicitly", "Uses weighted scorecard with sensitivity", "Conducts references and pilots where possible", "Presents risk-adjusted recommendation", "Plans validation after selection"]),
];

const consultantProjectQuestions = [
  h("con-proj-med-001", "service", "Capstone project walkthrough",
    "Walk me through your final-year or capstone project. What was your specific contribution?",
    ["project-resume", "behavioral"], ["ownership", "technical"], ["Clear problem statement and personal role", "Explains design or analysis choices", "Shares measurable outcome or learning", "Acknowledges team context honestly", "Structured concise narrative"],
    ["ownership", "technicalDepth", "outcomes"]),
  h("con-proj-med-002", "service", "Trade-off in project",
    "Describe a major trade-off you made in an academic or internship project.",
    ["project-resume", "behavioral"], ["tradeoffs", "decision"], ["Names alternatives considered", "Explains criteria for decision", "Shows reasoning not random choice", "Discusses outcome and hindsight", "Links to consulting relevance"],
    ["technicalDepth", "tradeoffs", "reflection"]),
  h("con-proj-med-003", "enterprise", "Data analysis project",
    "Tell me about a project where you analyzed data to support a recommendation.",
    ["project-resume", "behavioral"], ["analytics", "storytelling"], ["Defines question and data sources", "Describes methods at appropriate depth", "Connects analysis to recommendation", "Notes limitations", "Shows impact or feedback received"],
    ["ownership", "technicalDepth", "outcomes"]),
  h("con-proj-med-004", "service", "Failed approach",
    "Describe a project approach that did not work initially. What did you change?",
    ["project-resume", "behavioral"], ["failure", "iteration"], ["Honest description of failure", "Shows analysis of why it failed", "Explains pivot with evidence", "Improved result or learning", "Demonstrates resilience"],
    ["situationClarity", "actionOwnership", "reflection"]),
  h("con-proj-med-005", "fintech", "Stakeholder in project",
    "How did you manage conflicting feedback from two professors or mentors on a project?",
    ["project-resume", "behavioral"], ["stakeholders", "communication"], ["Explains conflicting inputs clearly", "Shows facilitation or escalation approach", "Reached decision or alignment", "Maintained relationships", "Reflects on communication lesson"],
    ["actionOwnership", "communication", "reflection"]),
  h("con-proj-med-006", "service", "Tool or method choice",
    "Why did you choose a particular tool or methodology for your project over alternatives?",
    ["project-resume", "behavioral"], ["methodology", "justification"], ["Lists alternatives considered", "Criteria linked to project goals", "Acknowledges limitations of chosen approach", "Outcome tied to choice", "Shows critical thinking"],
    ["technicalDepth", "tradeoffs", "reasoning"]),
  h("con-proj-med-007", "service", "Team role clarity",
    "In a group project, how did you ensure everyone delivered on time?",
    ["project-resume", "behavioral"], ["teamwork", "planning"], ["Describes planning and role assignment", "Shows proactive follow-up", "Handled slippage constructively", "Project delivered acceptably", "Reflection on leadership without arrogance"],
    ["actionOwnership", "collaboration", "outcomes"]),
  h("con-proj-med-008", "service", "Research depth",
    "Explain the most complex concept from your project to a non-technical audience.",
    ["project-resume", "behavioral"], ["communication", "simplification"], ["Chooses appropriate analogy", "Avoids unnecessary jargon", "Checks understanding", "Accurate without oversimplifying", "Consulting-relevant skill"],
    ["communication", "technicalDepth", "clarity"]),
  h("con-proj-med-009", "enterprise", "Internship deliverable",
    "What was the most valuable deliverable you produced during an internship?",
    ["project-resume", "behavioral"], ["internship", "impact"], ["Specific deliverable described", "Personal contribution clear", "Business or team impact stated", "Skills developed mentioned", "Connects to consulting work"],
    ["ownership", "outcomes", "impact"]),
  h("con-proj-med-010", "service", "Ethics in project",
    "Did you face any ethical or data privacy consideration in a project? How did you handle it?",
    ["project-resume", "behavioral"], ["ethics", "integrity"], ["Identifies ethical dimension", "Describes action taken", "Consulted guidelines or mentors if relevant", "Outcome respected integrity", "Shows professional judgment"],
    ["integrity", "actionOwnership", "reflection"]),
  h("con-proj-med-011", "service", "Quant result",
    "Share a time your project conclusion surprised you after running numbers.",
    ["project-resume", "behavioral"], ["analytics", "intellectual-honesty"], ["Initial hypothesis stated", "Data contradicted expectation", "Adjusted conclusion accordingly", "Communicated finding honestly", "Shows objectivity"],
    ["technicalDepth", "reflection", "integrity"]),
  h("con-proj-med-012", "service", "Scope creep",
    "How did you handle scope creep in a project with a fixed deadline?",
    ["project-resume", "behavioral"], ["scope", "prioritization"], ["Recognized scope expansion", "Prioritized must-have deliverables", "Negotiated scope with advisor or client", "Delivered on time with clear caveats", "Lesson learned"],
    ["actionOwnership", "tradeoffs", "outcomes"]),
  h("con-proj-med-013", "service", "Presentation skills",
    "Describe your best project presentation. What made it effective?",
    ["project-resume", "behavioral"], ["presentation", "communication"], ["Audience and goal defined", "Structure and visuals mentioned", "Handled Q&A well", "Feedback or result noted", "Self-awareness on strengths"],
    ["communication", "outcomes", "reflection"]),
  h("con-proj-med-014", "fintech", "Learning new domain",
    "Tell me about a project where you had to learn an unfamiliar industry or domain quickly.",
    ["project-resume", "behavioral"], ["learning", "adaptability"], ["Learning plan described", "Sources and mentors used", "Applied knowledge in deliverable", "Timeline pressure acknowledged", "Outcome despite novelty"],
    ["learningAgility", "actionOwnership", "outcomes"]),
  h("con-proj-med-015", "service", "Resume consistency",
    "I see a skill on your resume from a project — demonstrate it with a concrete example.",
    ["project-resume", "behavioral"], ["resume", "verification"], ["Picks claimed skill honestly", "Provides specific example not generic", "Depth matches fresher level", "Admits gaps if probed", "Builds credibility"],
    ["technicalDepth", "honesty", "communication"]),
];

const consultantHrQuestions = [
  h("con-hr-med-001", "service", "Why consulting",
    "Why do you want to join management consulting as a fresher?",
    ["hr", "motivation"], ["consulting", "career"], ["Specific reasons beyond prestige or salary", "Links skills to consulting work", "Shows understanding of consulting lifestyle", "Authentic personal story", "Long-term interest signaled"],
    ["motivation", "roleUnderstanding"]),
  h("con-hr-med-002", "service", "Why this firm",
    "Why our firm over other consulting or IT services companies?",
    ["hr", "motivation"], ["company-fit", "research"], ["References specific firm strengths researched", "Connects to personal goals and values", "Avoids generic praise", "Shows knowledge of service lines or culture", "Credible and prepared"],
    ["companyFit", "motivation"]),
  h("con-hr-med-003", "service", "Travel and hours",
    "Consulting can involve travel and long hours. How do you feel about that?",
    ["hr", "work-style"], ["travel", "realistic-expectations"], ["Acknowledges reality honestly", "Shows coping strategies and support systems", "Connects trade-off to learning", "Not dismissive or overly dramatic", "Mature balanced answer"],
    ["realism", "commitment"]),
  h("con-hr-med-004", "service", "Leadership example",
    "Tell me about a time you led without formal authority.",
    ["hr", "behavioral"], ["leadership", "influence"], ["Clear situation and goal", "Actions taken to influence others", "Outcome for team", "Reflection on leadership style", "STAR structure"],
    ["situationClarity", "actionOwnership", "resultSpecificity", "reflection"]),
  h("con-hr-med-005", "service", "Handling criticism",
    "Describe feedback that was hard to hear. How did you respond?",
    ["hr", "behavioral"], ["feedback", "growth"], ["Specific feedback described", "Initial reaction honest", "Constructive response and change", "Later improved outcome", "Growth mindset"],
    ["situationClarity", "actionOwnership", "reflection"]),
  h("con-hr-med-006", "service", "Client-facing readiness",
    "Have you interacted with external clients or stakeholders? Share an example.",
    ["hr", "behavioral"], ["client", "communication"], ["Context of stakeholder interaction", "Professional behavior demonstrated", "Handled question or conflict appropriately", "Positive or learning outcome", "Readiness for client work"],
    ["communication", "professionalism", "outcomes"]),
  h("con-hr-med-007", "fintech", "Consulting integrity choice",
    "Tell me about a time you chose integrity over an easier option.",
    ["hr", "behavioral"], ["ethics", "integrity"], ["Clear dilemma", "Values-driven decision", "Consequences accepted", "Lesson stated", "Maturity"],
    ["integrity", "actionOwnership", "reflection"]),
  h("con-hr-med-008", "service", "Stress management",
    "Describe a high-pressure period during college. How did you cope?",
    ["hr", "behavioral"], ["stress", "resilience"], ["Context and stakes", "Healthy coping mechanisms", "Delivered on commitments", "Avoids toxic glorification", "Self-awareness"],
    ["situationClarity", "actionOwnership", "resilience"]),
  h("con-hr-med-009", "service", "Diversity and teamwork",
    "Tell me about working with people very different from you.",
    ["hr", "behavioral"], ["diversity", "teamwork"], ["Respectful description of differences", "Adapted communication or approach", "Successful collaboration outcome", "Learned perspective", "Inclusive attitude"],
    ["collaboration", "empathy", "reflection"]),
  h("con-hr-med-010", "enterprise", "Strength and weakness",
    "What is your greatest strength and one weakness you are working on?",
    ["hr", "behavioral"], ["self-awareness", "development"], ["Strength with brief evidence", "Weakness genuine not cliche disguised as strength", "Active improvement steps for weakness", "Relevant to consulting", "Balanced tone"],
    ["selfAwareness", "growth"]),
  h("con-hr-med-011", "service", "Failure story",
    "Tell me about a failure and what you learned.",
    ["hr", "behavioral"], ["failure", "learning"], ["Owns failure without blaming only others", "Specific lesson", "Behavior change afterward", "Shows humility", "Consulting-relevant resilience"],
    ["situationClarity", "reflection", "growth"]),
  h("con-hr-med-012", "service", "Five-year consulting plan",
    "Where do you see yourself in five years in consulting?",
    ["hr", "career-goals"], ["planning", "consulting"], ["Realistic consulting career path", "Commitment to learning and delivery", "Open to multiple paths within firm", "Not only exit-focused answer", "Aligned with firm development model"],
    ["careerPlanning", "motivation"]),
  h("con-hr-med-013", "service", "Handling ambiguity",
    "Describe a situation with unclear instructions. What did you do?",
    ["hr", "behavioral"], ["ambiguity", "initiative"], ["Did not stay passive", "Clarified goals with stakeholders", "Structured approach despite ambiguity", "Delivered useful output", "Consulting-relevant"],
    ["actionOwnership", "problemFraming", "outcomes"]),
  h("con-hr-med-014", "service", "Why not core industry",
    "Why consulting instead of a core engineering or product role?",
    ["hr", "motivation"], ["career-choice", "comparison"], ["Thoughtful comparison not industry bashing", "Highlights variety and impact motivations", "Acknowledges trade-offs", "Personal fit emphasized", "Convincing rationale"],
    ["motivation", "roleUnderstanding"]),
  h("con-hr-med-015", "service", "Questions for interviewer",
    "What would you ask your interviewer at the end of a consulting interview?",
    ["hr", "behavioral"], ["closing", "engagement"], ["Questions show research and curiosity", "Not only compensation or leave questions", "Relevant to role and firm culture", "Demonstrates genuine interest", "Professional tone"],
    ["engagement", "preparation", "communication"]),
];

// GET Aptitude MCQ (25)
const getAptitudeMcqs = [
  m("get-apt-mcq-001", "service", "GET simple interest", "Find SI on Rs. 5,000 at 8% for 2 years.", ["aptitude", "quant"], ["simple-interest"], ["Rs. 400", "Rs. 800", "Rs. 640", "Rs. 500"], "B", "SI = 5000×8×2/100 = 800.", SOURCES.aptitude),
  m("get-apt-mcq-002", "product", "Percentage decrease", "Price drops from 800 to 680. Percentage decrease?", ["aptitude", "quant"], ["percentage"], ["15%", "12%", "20%", "18%"], "A", "120/800 = 15%.", SOURCES.aptitude),
  m("get-apt-mcq-003", "fintech", "Ratio problem", "Divide Rs. 900 in ratio 2:3:4. Largest share?", ["aptitude", "quant"], ["ratio"], ["Rs. 200", "Rs. 300", "Rs. 400", "Rs. 450"], "C", "9 parts; 4/9×900 = 400.", SOURCES.aptitude),
  m("get-apt-mcq-004", "enterprise", "Time and work", "A completes work in 10 days, B in 15 days. Together?", ["aptitude", "quant"], ["time-work"], ["6 days", "5 days", "7 days", "8 days"], "A", "Rate 1/10+1/15 = 1/6; 6 days.", SOURCES.aptitude),
  m("get-apt-mcq-005", "ecommerce", "Profit calculation", "CP Rs. 240, SP Rs. 300. Profit percent on CP?", ["aptitude", "quant"], ["profit"], ["20%", "25%", "30%", "15%"], "B", "60/240 = 25%.", SOURCES.aptitude),
  m("get-apt-mcq-006", "semiconductors", "GET number series", "2, 6, 12, 20, 30, ?", ["aptitude", "logical"], ["series"], ["40", "42", "44", "38"], "B", "Differences +4,+6,+8,+10 → +12 gives 42.", SOURCES.aptitude),
  m("get-apt-mcq-007", "startup", "Logical deduction", "All managers attend meetings. Rahul attends meetings. Can we conclude Rahul is a manager?", ["aptitude", "logical"], ["syllogism"], ["No", "Yes", "Only if Rahul is senior", "Cannot say anything"], "A", "Affirming the consequent is invalid.", SOURCES.aptitude),
  m("get-apt-mcq-008", "cyber", "GET average speed", "60 km at 40 km/h and 60 km at 60 km/h. Average speed?", ["aptitude", "quant"], ["speed"], ["48 km/h", "50 km/h", "45 km/h", "52 km/h"], "A", "Total 120 km in 2.5 h → 48 km/h.", SOURCES.aptitude),
  m("get-apt-mcq-009", "others", "GET clock angle", "Angle at 4:00?", ["aptitude", "logical"], ["clocks"], ["120°", "90°", "150°", "60°"], "A", "4×30° = 120°.", SOURCES.aptitude),
  m("get-apt-mcq-010", "fintech", "Compound amount", "Rs. 10,000 at 10% compounded annually for 2 years?", ["aptitude", "quant"], ["compound-interest"], ["Rs. 12,100", "Rs. 12,000", "Rs. 11,000", "Rs. 12,200"], "A", "10000×1.1×1.1 = 12100.", SOURCES.aptitude),
  m("get-apt-mcq-011", "service", "GET letter coding", "If CODE is DPEF, then DATA is?", ["aptitude", "logical"], ["coding"], ["EBUB", "EBUZ", "FUB", "EBUA"], "A", "Each letter +1.", SOURCES.aptitude),
  m("get-apt-mcq-012", "product", "Mixture allegation", "Mix 20% and 50% salt solutions to get 32%. Ratio?", ["aptitude", "quant"], ["mixture"], ["3:2", "2:3", "1:1", "4:1"], "A", "Alligation: (50-32):(32-20) = 18:12 = 3:2.", SOURCES.aptitude),
  m("get-apt-mcq-013", "enterprise", "Pipe filling", "Pipe A fills tank in 6 h, B empties in 12 h. Both open, fill time?", ["aptitude", "quant"], ["pipes"], ["12 h", "6 h", "4 h", "8 h"], "A", "Net 1/6-1/12 = 1/12 → 12 h.", SOURCES.aptitude),
  m("get-apt-mcq-014", "ecommerce", "Data interpretation", "Sales Mon 40, Tue 50. Tue vs Mon increase?", ["aptitude", "data"], ["percent-change"], ["20%", "25%", "10%", "15%"], "B", "10/40 = 25%.", SOURCES.aptitude),
  m("get-apt-mcq-015", "semiconductors", "Probability", "Fair die rolled once. Probability of even number?", ["aptitude", "quant"], ["probability"], ["1/2", "1/3", "2/3", "1/6"], "A", "3 even outcomes out of 6.", SOURCES.aptitude),
  m("get-apt-mcq-016", "startup", "LCM", "LCM of 12 and 18?", ["aptitude", "quant"], ["lcm"], ["36", "72", "24", "48"], "A", "LCM(12,18)=36.", SOURCES.aptitude),
  m("get-apt-mcq-017", "cyber", "Direction", "North, right, right, left. Facing?", ["aptitude", "logical"], ["direction"], ["East", "West", "North", "South"], "A", "N→E→S→E.", SOURCES.aptitude),
  m("get-apt-mcq-018", "others", "HCF", "HCF of 48 and 72?", ["aptitude", "quant"], ["hcf"], ["12", "24", "6", "8"], "B", "HCF is 24.", SOURCES.aptitude),
  m("get-apt-mcq-019", "fintech", "Train problem", "Train 180 m long at 54 km/h crosses pole in?", ["aptitude", "quant"], ["trains"], ["12 s", "10 s", "15 s", "18 s"], "A", "54 km/h=15 m/s; 180/15=12 s.", SOURCES.aptitude),
  m("get-apt-mcq-020", "service", "Blood relation", "A is B's father. B is C's mother. A is C's?", ["aptitude", "logical"], ["relations"], ["Grandfather", "Father", "Uncle", "Brother"], "A", "A is parent of B; B is parent of C → grandfather.", SOURCES.aptitude),
  m("get-apt-mcq-021", "product", "GET worker efficiency", "If 8 workers finish in 12 days, 12 workers finish in?", ["aptitude", "quant"], ["work"], ["8 days", "6 days", "10 days", "9 days"], "A", "8×12 = 12×d → d=8.", SOURCES.aptitude),
  m("get-apt-mcq-022", "enterprise", "Permutation", "Arrangements of word CAT?", ["aptitude", "quant"], ["permutation"], ["6", "3", "9", "12"], "A", "3! = 6.", SOURCES.aptitude),
  m("get-apt-mcq-023", "ecommerce", "Discount chain", "Rs. 1000 with 20% then 10% off. Final price?", ["aptitude", "quant"], ["discount"], ["Rs. 720", "Rs. 700", "Rs. 800", "Rs. 750"], "A", "800 then 720.", SOURCES.aptitude),
  m("get-apt-mcq-024", "semiconductors", "Missing term", "5, 11, 23, 47, ?", ["aptitude", "logical"], ["series"], ["95", "94", "96", "93"], "A", "Pattern ×2+1 each step.", SOURCES.aptitude),
  m("get-apt-mcq-025", "startup", "Calendar", "If today is Monday, day after 50 days?", ["aptitude", "logical"], ["calendar"], ["Tuesday", "Wednesday", "Thursday", "Friday"], "A", "50 mod 7 = 1 → Tuesday.", SOURCES.aptitude),
];

// GET CS Fundamentals MCQ (25)
const getCsMcqs = [
  m("get-csf-mcq-001", "enterprise", "OOP pillar", "Which is NOT a pillar of OOP?", ["cs-fundamentals", "oop"], ["oop"], ["Encapsulation", "Inheritance", "Compilation", "Polymorphism"], "C", "Compilation is not an OOP pillar.", SOURCES.cs),
  m("get-csf-mcq-002", "product", "GET process vs thread", "Compared to threads, processes typically have:", ["cs-fundamentals", "os"], ["process-thread"], ["Separate address space", "Shared address space always", "Lower creation cost always", "No isolation"], "A", "Processes have isolated memory; threads share within process.", SOURCES.cs),
  m("get-csf-mcq-003", "service", "Deadlock condition", "Which is NOT a necessary condition for deadlock?", ["cs-fundamentals", "os"], ["deadlock"], ["Mutual exclusion", "Preemption allowed freely", "Hold and wait", "Circular wait"], "B", "Deadlock requires no preemption among held resources.", SOURCES.cs),
  m("get-csf-mcq-004", "fintech", "ACID property", "In DBMS, 'I' in ACID stands for:", ["cs-fundamentals", "dbms"], ["acid"], ["Isolation", "Integration", "Indexing", "Integrity only"], "A", "ACID: Atomicity, Consistency, Isolation, Durability.", SOURCES.cs),
  m("get-csf-mcq-005", "ecommerce", "Normalization goal", "Main goal of normalization is to:", ["cs-fundamentals", "dbms"], ["normalization"], ["Reduce redundancy", "Increase redundancy", "Remove all indexes", "Speed up every query always"], "A", "Normalization reduces update anomalies and redundancy.", SOURCES.cs),
  m("get-csf-mcq-006", "cyber", "GET TCP vs UDP", "TCP differs from UDP mainly because TCP is:", ["cs-fundamentals", "networks"], ["tcp-udp"], ["Connection-oriented and reliable", "Always faster with no headers", "Only for video streaming", "Connectionless"], "A", "TCP provides reliable ordered delivery with connection setup.", SOURCES.cs),
  m("get-csf-mcq-007", "semiconductors", "HTTP method", "Which HTTP method is idempotent and used to retrieve data?", ["cs-fundamentals", "networks"], ["http"], ["GET", "POST", "PATCH", "CONNECT"], "A", "GET retrieves representation; safe and idempotent.", SOURCES.cs),
  m("get-csf-mcq-008", "startup", "Stack property", "Stack data structure follows:", ["cs-fundamentals", "dsa"], ["stack"], ["LIFO", "FIFO", "Random access", "Priority order"], "A", "Stack is Last-In-First-Out.", SOURCES.cs),
  m("get-csf-mcq-009", "others", "Queue property", "Queue data structure follows:", ["cs-fundamentals", "dsa"], ["queue"], ["FIFO", "LIFO", "Sorted order only", "Tree traversal"], "A", "Queue is First-In-First-Out.", SOURCES.cs),
  m("get-csf-mcq-010", "enterprise", "Binary search complexity", "Average time complexity of binary search on sorted array:", ["cs-fundamentals", "dsa"], ["complexity"], ["O(log n)", "O(n)", "O(n log n)", "O(1)"], "A", "Binary search halves search space each step.", SOURCES.cs),
  m("get-csf-mcq-011", "product", "Primary key", "A primary key in a relational table must be:", ["cs-fundamentals", "dbms"], ["keys"], ["Unique and not null", "Nullable", "Only numeric", "Always composite"], "A", "Primary key uniquely identifies rows; no nulls.", SOURCES.cs),
  m("get-csf-mcq-012", "service", "Foreign key", "Foreign key enforces:", ["cs-fundamentals", "dbms"], ["referential-integrity"], ["Referential integrity", "Only indexing", "Encryption", "Deadlock prevention"], "A", "FK ensures referenced parent row exists.", SOURCES.cs),
  m("get-csf-mcq-013", "fintech", "GET virtual memory", "Virtual memory primarily allows:", ["cs-fundamentals", "os"], ["memory-management"], ["Programs larger than physical RAM to run", "Faster disk than RAM always", "No paging", "Only single-task OS"], "A", "VM uses paging/swapping to extend effective memory.", SOURCES.cs),
  m("get-csf-mcq-014", "ecommerce", "Paging", "Paging divides memory into fixed-size blocks called:", ["cs-fundamentals", "os"], ["paging"], ["Frames/Pages", "Segments only", "Clusters only", "Sectors only"], "A", "Paging uses fixed-size pages and frames.", SOURCES.cs),
  m("get-csf-mcq-015", "cyber", "DNS role", "DNS primarily translates:", ["cs-fundamentals", "networks"], ["dns"], ["Domain names to IP addresses", "IP to MAC only", "Emails to URLs", "Ports to processes"], "A", "DNS resolves human-readable names to IPs.", SOURCES.cs),
  m("get-csf-mcq-016", "semiconductors", "OSI layer HTTP", "HTTP operates at which OSI layer?", ["cs-fundamentals", "networks"], ["osi"], ["Application", "Transport", "Network", "Data link"], "A", "HTTP is application layer protocol.", SOURCES.cs),
  m("get-csf-mcq-017", "startup", "Polymorphism", "Runtime polymorphism in OOP is commonly achieved via:", ["cs-fundamentals", "oop"], ["polymorphism"], ["Method overriding", "Method overloading only", "Macros", "Comments"], "A", "Dynamic dispatch via overridden virtual methods.", SOURCES.cs),
  m("get-csf-mcq-018", "others", "Abstraction", "Abstraction in OOP means:", ["cs-fundamentals", "oop"], ["abstraction"], ["Hiding complexity exposing essentials", "Duplicating all code", "Removing interfaces", "Only using global variables"], "A", "Abstraction hides implementation details.", SOURCES.cs),
  m("get-csf-mcq-019", "enterprise", "Sorting stable", "Which sorting algorithm is stable by typical implementation?", ["cs-fundamentals", "dsa"], ["sorting"], ["Merge sort", "Heap sort", "Selection sort", "Shell sort typical"], "A", "Merge sort preserves relative order of equal elements.", SOURCES.cs),
  m("get-csf-mcq-020", "product", "Hash collision", "In hashing, collision means:", ["cs-fundamentals", "dsa"], ["hashing"], ["Two keys map to same index", "Hash table is full", "Key is null", "Table cannot resize"], "A", "Collisions handled by chaining or open addressing.", SOURCES.cs),
  m("get-csf-mcq-021", "service", "SQL JOIN", "INNER JOIN returns rows where:", ["cs-fundamentals", "dbms"], ["sql"], ["Join condition matches in both tables", "All rows from left table", "All rows from both unconditionally", "No condition needed"], "A", "Inner join keeps matching pairs only.", SOURCES.cs),
  m("get-csf-mcq-022", "fintech", "Transaction isolation", "Dirty read occurs when a transaction reads:", ["cs-fundamentals", "dbms"], ["isolation"], ["Uncommitted data from another transaction", "Only archived data", "Encrypted data", "Indexed data only"], "A", "Dirty read sees uncommitted changes.", SOURCES.cs),
  m("get-csf-mcq-023", "ecommerce", "Recursion base", "Every correct recursive function needs:", ["cs-fundamentals", "programming"], ["recursion"], ["Base case", "Global variable only", "Infinite loop", "Multiple mains"], "A", "Base case stops recursion.", SOURCES.cs),
  m("get-csf-mcq-024", "cyber", "Firewall purpose", "A network firewall primarily:", ["cs-fundamentals", "networks"], ["security"], ["Filters traffic by rules", "Stores database backups", "Compiles code", "Schedules CPU"], "A", "Firewall enforces access control on traffic.", SOURCES.cs),
  m("get-csf-mcq-025", "semiconductors", "Big-O linear", "Which complexity is linear?", ["cs-fundamentals", "dsa"], ["complexity"], ["O(n)", "O(log n)", "O(1)", "O(n²)"], "A", "O(n) grows linearly with input size.", SOURCES.cs),
];

const getHrQuestions = [
  h("get-hr-med-001", "service", "Why GET program", "Why do you want to join a Graduate Engineer Trainee program?", ["hr", "motivation"], ["get", "career"], ["Links fresher readiness to structured training", "Shows long-term engineering interest", "Avoids only brand-name answer", "Mentions learning and rotation benefits", "Authentic motivation"],
    ["motivation", "roleUnderstanding"]),
  h("get-hr-med-002", "product", "Why this company", "Why do you want to work at our company?", ["hr", "motivation"], ["company-fit"], ["Specific company research shown", "Connects values to personal goals", "References products or culture concretely", "Not generic flattery", "Credible intent"],
    ["companyFit", "motivation"]),
  h("get-hr-med-003", "fintech", "Adaptability", "Tell me about a time you adapted quickly to a new environment.", ["hr", "behavioral"], ["adaptability"], ["Clear situation of change", "Positive proactive actions", "Outcome or smooth transition", "Learning highlighted", "GET-relevant"],
    ["situationClarity", "actionOwnership", "reflection"]),
  h("get-hr-med-004", "enterprise", "Team project conflict", "Describe resolving conflict in a team project.", ["hr", "behavioral"], ["teamwork"], ["Neutral conflict description", "Listening and resolution steps", "Project success focus", "Personal role clear", "Reflection"],
    ["collaboration", "actionOwnership", "reflection"]),
  h("get-hr-med-005", "ecommerce", "Learning from failure", "Tell me about a mistake in college and what you learned.", ["hr", "behavioral"], ["failure"], ["Owns mistake honestly", "Specific corrective actions", "Improved later behavior", "Humility", "Growth mindset"],
    ["situationClarity", "reflection", "growth"]),
  h("get-hr-med-006", "semiconductors", "Technical challenge", "Describe a challenging technical problem you solved.", ["hr", "behavioral"], ["problem-solving"], ["Problem defined clearly", "Approach systematic", "Personal contribution evident", "Outcome stated", "Appropriate fresher depth"],
    ["technicalDepth", "actionOwnership", "outcomes"]),
  h("get-hr-med-007", "startup", "Initiative", "Give an example when you took initiative without being asked.", ["hr", "behavioral"], ["initiative"], ["Identified gap or opportunity", "Acted without micromanagement", "Positive impact", "Shows ownership", "GET trait"],
    ["actionOwnership", "initiative", "outcomes"]),
  h("get-hr-med-008", "cyber", "Handling feedback", "Tell me about difficult feedback you received.", ["hr", "behavioral"], ["feedback"], ["Feedback described specifically", "Non-defensive response", "Behavior change shown", "Improved result", "Maturity"],
    ["reflection", "growth", "actionOwnership"]),
  h("get-hr-med-009", "others", "Time management", "How do you balance academics, projects, and placements prep?", ["hr", "behavioral"], ["time-management"], ["Concrete prioritization method", "Realistic schedule", "Examples of execution", "Adjusts when needed", "Organized approach"],
    ["planning", "discipline", "reflection"]),
  h("get-hr-med-010", "service", "Leadership in college", "Describe a leadership role in college activities.", ["hr", "behavioral"], ["leadership"], ["Role and scope defined", "Actions not only title", "Team outcome", "Learned leadership lesson", "Authentic"],
    ["actionOwnership", "collaboration", "outcomes"]),
  h("get-hr-med-011", "product", "Relocation", "Are you willing to relocate for training or project assignment?", ["hr", "work-style"], ["relocation"], ["Clear willing answer with reasoning", "Acknowledges family or constraints honestly if any", "Flexibility emphasized", "Professional tone", "Realistic commitment"],
    ["commitment", "realism"]),
  h("get-hr-med-012", "fintech", "Strengths for GET", "What strengths make you suitable for a GET role?", ["hr", "behavioral"], ["self-assessment"], ["2-3 strengths with brief evidence", "Linked to trainee expectations", "Avoids unsubstantiated claims", "Balanced not arrogant", "Clear value"],
    ["selfAwareness", "roleUnderstanding"]),
  h("get-hr-med-013", "enterprise", "Weakness improvement", "What weakness are you actively improving?", ["hr", "behavioral"], ["development"], ["Genuine weakness", "Concrete improvement plan", "Progress evidence if possible", "Relevant to early career", "Self-awareness"],
    ["selfAwareness", "growth"]),
  h("get-hr-med-014", "ecommerce", "Extra-curricular", "How have extra-curricular activities shaped you professionally?", ["hr", "behavioral"], ["extracurricular"], ["Specific activity named", "Skills transferred to work", "Not vague hobby list", "Shows well-roundedness", "GET fit"],
    ["communication", "growth", "motivation"]),
  h("get-hr-med-015", "service", "GET five-year vision", "Where do you see yourself five years after joining as a GET?", ["hr", "career-goals"], ["career-planning"], ["Realistic technical or leadership growth path", "Commitment to engineering excellence", "Aligned with company ladder", "Not only managerial cliché", "Thoughtful plan"],
    ["careerPlanning", "motivation"]),
];

const consultantTagsFor = (pool, index) => {
  const companies = CONSULTANT_COMPANIES[pool];
  return Array.from({ length: 4 }, (_, i) => companies[(index * 4 + i) % companies.length]);
};

const getTagsFor = (pool, index) => {
  const companies = GET_COMPANIES[pool];
  return Array.from({ length: 4 }, (_, i) => companies[(index * 4 + i) % companies.length]);
};

const caseRubricFor = (criteria) =>
  criteria.map((text, index) => ({
    text,
    category: ["structure", "assumptions", "analysis", "recommendation", "communication"][index] || "coverage",
    importance: index < 3 ? "mustHave" : "goodToHave",
    expectedAnswerMode: "conceptual",
  }));

const projectRubricFor = (criteria) =>
  criteria.map((text, index) => ({
    text,
    category: ["ownership", "technicalDepth", "tradeoffs", "outcomes", "communication"][index] || "coverage",
    importance: index < 3 ? "mustHave" : "goodToHave",
    expectedAnswerMode: "story",
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
  const output = [columns.map(csvEscape).join(","), ...rows.map((row) => columns.map((c) => csvEscape(row[c])).join(","))].join("\n");
  await fs.writeFile(path.join(outputDir, fileName), `${output}\n`, "utf8");
};

const normalizeKey = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

await fs.mkdir(outputDir, { recursive: true });

const rubricCols = ["questionId", "title", "question", "companyTags", "topics", "subtopics", "url", "rubric", "source", "verified", "qualityScore"];
const mcqCols = [...rubricCols.slice(0, 7), "optionA", "optionB", "optionC", "optionD", "correctOptionId", "explanation", ...rubricCols.slice(8)];
const hrCols = [...rubricCols.slice(0, 8), "behavioralSignals", ...rubricCols.slice(8)];

const files = [
  { name: "consultant-case-interview-medium-rubric-50.csv", role: "Consultant", round: "Case Interview", eval: "rubric_llm", data: consultantCaseQuestions, type: "case" },
  { name: "consultant-project-resume-medium-behavioral-15.csv", role: "Consultant", round: "Project/Resume Deep Dive", eval: "behavioral_llm", data: consultantProjectQuestions, type: "project" },
  { name: "consultant-hr-medium-behavioral-15.csv", role: "Consultant", round: "HR", eval: "behavioral_llm", data: consultantHrQuestions, type: "hr" },
  { name: "get-aptitude-medium-mcq-25.csv", role: "Graduate Engineer Trainee (GET)", round: "Aptitude", eval: "mcq_exact", data: getAptitudeMcqs, type: "mcq" },
  { name: "get-cs-fundamentals-medium-mcq-25.csv", role: "Graduate Engineer Trainee (GET)", round: "CS Fundamentals", eval: "mcq_exact", data: getCsMcqs, type: "mcq" },
  { name: "get-hr-medium-behavioral-15.csv", role: "Graduate Engineer Trainee (GET)", round: "HR", eval: "behavioral_llm", data: getHrQuestions, type: "hr" },
];

let conIdx = 0;
let getIdx = 0;

for (const spec of files) {
  if (spec.type === "case") {
    await writeCsv(spec.name, rubricCols, spec.data.map((item) => ({
      questionId: item.id, title: item.title, question: item.question,
      companyTags: consultantTagsFor(item.pool, conIdx++).join("|"),
      topics: item.topics.join("|"), subtopics: item.subtopics.join("|"), url: item.source,
      rubric: JSON.stringify(caseRubricFor(item.criteria)),
      source: "public_interview_pattern_curated", verified: "false", qualityScore: "0.9",
    })));
  } else if (spec.type === "project") {
    await writeCsv(spec.name, hrCols, spec.data.map((item) => ({
      questionId: item.id, title: item.title, question: item.question,
      companyTags: consultantTagsFor(item.pool, conIdx++).join("|"),
      topics: item.topics.join("|"), subtopics: item.subtopics.join("|"), url: item.source,
      rubric: JSON.stringify(projectRubricFor(item.criteria)),
      behavioralSignals: (item.signals || []).join("|"),
      source: "public_interview_pattern_curated", verified: "false", qualityScore: "0.9",
    })));
  } else if (spec.type === "hr" && spec.role === "Consultant") {
    await writeCsv(spec.name, hrCols, spec.data.map((item) => ({
      questionId: item.id, title: item.title, question: item.question,
      companyTags: consultantTagsFor(item.pool, conIdx++).join("|"),
      topics: item.topics.join("|"), subtopics: item.subtopics.join("|"), url: item.source,
      rubric: JSON.stringify(hrRubricFor(item.criteria)),
      behavioralSignals: (item.signals || []).join("|"),
      source: "public_interview_pattern_curated", verified: "false", qualityScore: "0.9",
    })));
  } else if (spec.type === "mcq") {
    await writeCsv(spec.name, mcqCols, spec.data.map((item) => ({
      questionId: item.id, title: item.title, question: item.question,
      companyTags: getTagsFor(item.pool, getIdx++).join("|"),
      topics: item.topics.join("|"), subtopics: item.subtopics.join("|"), url: item.source,
      optionA: item.options[0], optionB: item.options[1], optionC: item.options[2], optionD: item.options[3],
      correctOptionId: item.answer, explanation: item.explanation,
      source: "public_interview_pattern_curated", verified: "false", qualityScore: "0.9",
    })));
  } else if (spec.type === "hr") {
    await writeCsv(spec.name, hrCols, spec.data.map((item) => ({
      questionId: item.id, title: item.title, question: item.question,
      companyTags: getTagsFor(item.pool, getIdx++).join("|"),
      topics: item.topics.join("|"), subtopics: item.subtopics.join("|"), url: item.source,
      rubric: JSON.stringify(hrRubricFor(item.criteria)),
      behavioralSignals: (item.signals || []).join("|"),
      source: "public_interview_pattern_curated", verified: "false", qualityScore: "0.9",
    })));
  }
}

const allNew = [
  ...consultantCaseQuestions, ...consultantProjectQuestions, ...consultantHrQuestions,
  ...getAptitudeMcqs, ...getCsMcqs, ...getHrQuestions,
];

const summary = {
  outputDir,
  files: files.map((f) => ({ name: f.name, role: f.role, roundType: f.round, evaluationStrategy: f.eval, rows: f.data.length })),
  totalRows: allNew.length,
};

if (process.env.MONGO_URI) {
  const mongoose = (await import("mongoose")).default;
  const InterviewQuestion = (await import("../models/InterviewQuestion.js")).default;
  const CompanyStatic = (await import("../models/CompanyStatic.js")).default;
  await mongoose.connect(process.env.MONGO_URI);
  const existing = await InterviewQuestion.find({}, { questionId: 1, title: 1, question: 1 }).lean();
  const known = new Set((await CompanyStatic.find({}, { name: 1 }).lean()).map((c) => c.name));
  const ids = new Set(existing.map((r) => r.questionId));
  const titles = new Set(existing.map((r) => normalizeKey(r.title)));
  const qs = new Set(existing.map((r) => normalizeKey(r.question?.slice(0, 120))));
  const allCompanies = [...Object.values(CONSULTANT_COMPANIES).flat(), ...Object.values(GET_COMPANIES).flat()];
  summary.dbDedupe = {
    duplicateIds: allNew.filter((i) => ids.has(i.id)).map((i) => i.id),
    duplicateTitles: allNew.filter((i) => titles.has(normalizeKey(i.title))).map((i) => i.title),
    duplicateQuestionPrefixes: allNew.filter((i) => qs.has(normalizeKey(i.question.slice(0, 120)))).map((i) => i.id),
    unknownCompanies: [...new Set(allCompanies)].filter((c) => !known.has(c)),
  };
  if (summary.dbDedupe.duplicateIds.length || summary.dbDedupe.duplicateTitles.length || summary.dbDedupe.duplicateQuestionPrefixes.length || summary.dbDedupe.unknownCompanies.length) {
    console.error(JSON.stringify(summary, null, 2));
    await mongoose.disconnect();
    process.exit(1);
  }
  await mongoose.disconnect();
}

console.log(JSON.stringify(summary, null, 2));
