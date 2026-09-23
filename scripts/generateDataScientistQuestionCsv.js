import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "data", "generated-interview-imports");

const COMPANIES = {
  fintech: [
    "Arcesium", "Axis Bank", "Goldman Sachs", "Groww", "HSBC", "Intuit", "JPMorganChase",
    "JusPay", "Morgan Stanley", "Navi", "PhonePe", "Razorpay", "Visa", "Wells Fargo", "Zeta",
  ],
  ecommerce: ["Amazon", "Flipkart", "Meesho", "Swiggy", "Lenskart", "Eternal Limited", "7-Eleven"],
  cyber: [
    "Sigmoid", "IMPACT ANALYTICS", "Palo Alto Networks", "Fractal Analytics", "Saviynt",
    "ZScaler", "Arctic Wolf", "PrimeNumbers",
  ],
  enterprise: [
    "Adobe", "Atlassian", "Cisco", "Eightfold AI", "IBM", "LinkedIn", "Microsoft",
    "Oracle", "SAP", "Twilio", "Whatfix", "o9 Solutions",
  ],
  product: [
    "Google", "Nvidia", "Qualcomm", "Samsung", "GE Healthcare", "Honeywell", "Nokia",
    "Walmart Labs", "New Relic", "Confluent",
  ],
  service: [
    "Accenture", "Cognizant", "Deloitte", "EY", "Fractal Analytics", "Genpact", "Infosys",
    "LTIMindtree", "TCS NQT", "ThoughtWorks", "ZS Associates", "Mphasis",
  ],
  semiconductors: [
    "Texas Instruments", "Analog Devices", "ARM", "Infineon", "Micron Semiconductors",
  ],
  startup: ["Rapido", "ShareChat", "SeedlingLabs", "Go Comet", "Mareana"],
};

const SOURCES = {
  stats: "https://www.geeksforgeeks.org/statistics/",
  ab: "https://www.geeksforgeeks.org/a-b-testing/",
  dsInterview: "https://www.interviewquery.com/interview-guides/data-scientist",
  goldmanDs: "https://www.datainterview.com/blog/goldman-sachs-data-scientist-interview",
  flipkart: "https://www.geeksforgeeks.org/interview-experiences/flipkart-interview-experience-for-sde/",
  fractal: "https://www.geeksforgeeks.org/interview-experiences/fractal-analytics-interview-experience/",
};

const q = (id, category, title, question, topics, subtopics, source, criteria) => ({
  id,
  category,
  title,
  question,
  topics,
  subtopics,
  source,
  criteria,
});

const m = (id, category, title, question, topics, subtopics, source, options, answer, explanation) => ({
  id,
  category,
  title,
  question,
  topics,
  subtopics,
  source,
  options,
  answer,
  explanation,
});

const descriptive = [
  // Fintech (15)
  q("ds-med-rubric-001", "fintech", "Campaign response with rare positives",
    "A marketing team reports 98% accuracy on a loan-offer response model, but only 1.2% of users respond. How would you evaluate the model and explain why accuracy is insufficient?",
    ["statistics", "classification", "model-evaluation"], ["imbalanced-data", "precision-recall", "business-metrics"], SOURCES.goldmanDs,
    ["Explains that high accuracy can come from predicting the majority non-response class", "Recommends precision, recall, F1, PR-AUC, and lift at relevant thresholds", "Connects metrics to campaign cost and expected conversions", "Discusses baseline rate and calibration of predicted probabilities", "Proposes segment-level evaluation and a holdout validation design"]),
  q("ds-med-rubric-002", "fintech", "Designing a pricing A/B test",
    "Product wants to test a new fee structure on mobile payments. Outline how you would design the experiment, choose sample size, and decide whether to launch.",
    ["experimentation", "ab-testing", "statistics"], ["sample-size", "power", "guardrails"], SOURCES.ab,
    ["Defines primary metric such as revenue per user or net transaction value", "Discusses randomization unit, duration, and novelty or seasonality effects", "Mentions power analysis, minimum detectable effect, and alpha control", "Adds guardrail metrics like completion rate and complaint volume", "Explains decision criteria including practical significance and risk"]),
  q("ds-med-rubric-003", "fintech", "Interpreting logistic regression coefficients",
    "A credit propensity model uses logistic regression. A coefficient for 'number of prior late payments' is 0.45. How would you explain this to a non-technical stakeholder?",
    ["regression", "statistics", "communication"], ["logistic-regression", "odds-ratio", "interpretation"], SOURCES.stats,
    ["Translates the coefficient into odds-ratio or percentage change in odds", "Clarifies that it is association, not proof of causation, holding other variables constant", "Notes sign, magnitude, and statistical significance if available", "Discusses confounding variables and model limitations", "Uses plain language without misrepresenting predictive versus causal claims"]),
  q("ds-med-rubric-004", "fintech", "Sample ratio mismatch",
    "An A/B test on a checkout flow shows a 55/45 split instead of the planned 50/50 after one day. What could cause this and how would you respond?",
    ["experimentation", "ab-testing", "data-quality"], ["sample-ratio-mismatch", "randomization", "diagnostics"], SOURCES.ab,
    ["Identifies possible assignment bugs, filtering, bot traffic, or platform-specific rollout issues", "Checks SRM with a chi-square test or equivalent", "Avoids drawing causal conclusions until randomization integrity is restored", "Investigates by segment, device, and time of assignment", "Recommends stopping, fixing, or restarting the experiment if integrity cannot be verified"]),
  q("ds-med-rubric-005", "fintech", "Multiple comparison problem",
    "An analyst runs twenty hypothesis tests on customer segments and reports three 'significant' results at p < 0.05. Why might this be misleading?",
    ["statistics", "hypothesis-testing", "experimentation"], ["multiple-testing", "false-discovery", "p-values"], SOURCES.stats,
    ["Explains inflated false-positive rate when many tests are run without correction", "Mentions Bonferroni, Benjamini-Hochberg, or pre-registration of primary metrics", "Distinguishes exploratory findings from confirmatory claims", "Recommends replication or holdout validation for surprising segment wins", "Communicates uncertainty rather than treating p-values as proof"]),
  q("ds-med-rubric-006", "fintech", "Choosing between linear and tree models",
    "You must predict monthly account balance for budgeting alerts. Compare when you would use linear regression versus a gradient-boosted tree model.",
    ["model-selection", "regression", "statistics"], ["interpretability", "nonlinearity", "baseline"], SOURCES.dsInterview,
    ["States linear regression strengths for interpretability and stable extrapolation with linear trends", "Notes tree models for nonlinear interactions and heterogeneous segments", "Discusses validation strategy, overfitting risk, and feature scaling needs", "Compares error metrics and business explainability requirements", "Recommends starting with a simple baseline before complex models"]),
  q("ds-med-rubric-007", "fintech", "Survivorship bias in portfolio analysis",
    "A report claims average customer portfolio return improved year-over-year, but closed accounts are excluded. Explain the bias and how you would fix the analysis.",
    ["statistics", "causal-inference", "data-quality"], ["survivorship-bias", "selection-bias", "cohort-analysis"], SOURCES.goldmanDs,
    ["Defines survivorship bias and why excluding closed accounts skews results upward", "Proposes including churned or closed accounts with appropriate censoring or cohort framing", "Uses time-based cohorts rather than only active users at period end", "Discusses whether the metric should be user-level or account-level", "Communicates corrected conclusions to stakeholders"]),
  q("ds-med-rubric-008", "fintech", "Confidence interval for a conversion rate",
    "A new onboarding flow converts 4.8% of users with n = 12,000. How would you compute and interpret a 95% confidence interval for the true conversion rate?",
    ["statistics", "probability", "product-analytics"], ["confidence-intervals", "binomial-proportion", "interpretation"], SOURCES.stats,
    ["Uses an appropriate interval method such as Wilson or normal approximation with checks", "Explains that the interval estimates uncertainty around the observed rate", "Interprets overlap with control variant when comparing experiments", "Warns against over-interpreting small absolute differences without interval context", "Connects interval width to sample size and desired precision"]),
  q("ds-med-rubric-009", "fintech", "Feature leakage in churn modeling",
    "A churn model performs unusually well in validation. You discover 'days_since_last_support_ticket_closed' is in the feature set. Why is this risky and how would you fix it?",
    ["feature-engineering", "data-leakage", "classification"], ["temporal-leakage", "point-in-time", "validation"], SOURCES.dsInterview,
    ["Explains that post-churn or post-outcome events can leak label information", "Rebuilds features using only information available at prediction time", "Uses time-based train-validation splits aligned to prediction horizon", "Audits other time-derived features for similar leakage", "Re-evaluates realistic performance after correction"]),
  q("ds-med-rubric-010", "fintech", "Bayesian versus frequentist framing",
    "A risk team asks whether a 95% confidence interval and a 95% credible interval mean the same thing. How would you explain the difference at a high level?",
    ["statistics", "probability", "communication"], ["bayesian", "frequentist", "interpretation"], SOURCES.stats,
    ["Contrasts parameter uncertainty (Bayesian) with long-run sampling behavior (frequentist)", "Avoids claiming the intervals are interchangeable without context", "Gives a simple example such as conversion rate or default probability", "Notes when each framing is useful in business decisions", "Keeps explanation accessible to non-statisticians"]),
  q("ds-med-rubric-011", "fintech", "Power analysis for experiment",
    "You expect a 0.3 percentage-point lift in activation rate from 12% to 12.3%. How would you estimate required sample size before launching?",
    ["experimentation", "statistics", "ab-testing"], ["power-analysis", "sample-size", "mdE"], SOURCES.ab,
    ["States baseline rate, expected lift, alpha, and desired power explicitly", "Uses a two-proportion sample-size formula or simulation", "Accounts for one-sided versus two-sided testing choice", "Discusses runtime, traffic allocation, and minimum experiment duration", "Explains trade-off between detecting small effects and experiment cost"]),
  q("ds-med-rubric-012", "fintech", "Segment analysis after experiment",
    "An overall A/B test is flat, but one city shows a large positive effect. Can you launch for that city only?",
    ["experimentation", "statistics", "causal-inference"], ["segment-peeking", "multiple-testing", "heterogeneity"], SOURCES.ab,
    ["Warns that post-hoc segment mining inflates false discovery risk", "Requires pre-specified segments or hierarchical models with correction", "Checks sample size and confidence intervals within the city", "Considers operational constraints and external validity", "Recommends confirmatory follow-up rather than immediate rollout on a cherry-picked segment"]),
  q("ds-med-rubric-013", "fintech", "Missing income data",
    "Income is missing for 35% of applicants. Compare mean imputation, median imputation, and a missingness indicator feature. Which approach would you prefer and why?",
    ["statistics", "feature-engineering", "data-quality"], ["missing-data", "imputation", "modeling"], SOURCES.dsInterview,
    ["Notes that naive mean imputation can distort variance and relationships", "Explains missingness indicator when missingness may be informative", "Considers model-based or segmented imputation for large missing rates", "Validates impact on calibration and fairness across groups", "Avoids leakage by fitting imputation within training folds only"]),
  q("ds-med-rubric-014", "fintech", "Calibrated probability forecasts",
    "Predicted default probabilities cluster around 0.02 and 0.80 but observed default rates do not match within bins. How would you diagnose and improve calibration?",
    ["statistics", "model-evaluation", "classification"], ["calibration", "reliability-diagram", "platt-scaling"], SOURCES.goldmanDs,
    ["Uses reliability or calibration curves by predicted probability decile", "Distinguishes discrimination (ranking) from calibration (absolute probability)", "Mentions Platt scaling, isotonic regression, or recalibration on holdout data", "Checks for covariate shift across portfolios or time", "Explains why well-calibrated probabilities matter for pricing and limits"]),
  q("ds-med-rubric-015", "fintech", "Causal claim from observational data",
    "Marketing spend increased and sign-ups increased the same month. A manager claims the campaign caused the growth. How would you push back constructively?",
    ["causal-inference", "statistics", "communication"], ["correlation-vs-causation", "confounding", "experimentation"], SOURCES.dsInterview,
    ["Separates correlation from causation and lists confounders such as seasonality or product launches", "Proposes quasi-experimental or experimental designs where possible", "Suggests diff-in-diff, matched markets, or geo experiments as alternatives", "Defines what evidence would be needed to support a causal claim", "Communicates uncertainty while offering a path to rigorous measurement"]),

  // E-commerce (10)
  q("ds-med-rubric-016", "ecommerce", "Funnel drop-off diagnosis",
    "Checkout completion fell from 68% to 61% after a UI change. Walk through how you would analyze the funnel and decide whether the UI caused the drop.",
    ["product-analytics", "experimentation", "statistics"], ["funnel-analysis", "conversion", "diagnostics"], SOURCES.flipkart,
    ["Breaks the funnel into steps to localize the drop", "Compares affected versus unaffected platforms, categories, and user cohorts", "Checks experiment randomization, sample ratio, and guardrails", "Considers seasonality, inventory, and payment failures as alternatives", "Recommends rollback, iteration, or confirmatory testing based on evidence"]),
  q("ds-med-rubric-017", "ecommerce", "Cohort retention analysis",
    "Define how you would compute 4-week retention for users who signed up in January versus February and interpret a widening gap.",
    ["product-analytics", "statistics", "time-series"], ["cohort-analysis", "retention", "kpi-definition"], SOURCES.dsInterview,
    ["Defines cohort by signup week and retention event clearly", "Uses consistent denominators and handles partial weeks appropriately", "Visualizes retention curves and compares cohort quality", "Investigates product, acquisition channel, or promo mix changes", "Translates retention gap into business impact such as LTV"]),
  q("ds-med-rubric-018", "ecommerce", "Search ranking experiment",
    "A new search ranker increases clicks but decreases order value per session. How would you evaluate whether to ship it?",
    ["experimentation", "product-analytics", "statistics"], ["multi-objective", "guardrails", "ab-testing"], SOURCES.flipkart,
    ["Treats clicks as a proxy and prioritizes downstream revenue metrics", "Uses guardrails for returns, latency, and relevance complaints", "Analyzes heterogeneous effects by category and user segment", "Checks statistical significance and practical business impact", "Proposes multi-objective optimization or constrained rollout"]),
  q("ds-med-rubric-019", "ecommerce", "Demand forecast with promotions",
    "Weekly SKU demand spikes during flash sales but is sparse otherwise. Outline a forecasting approach suitable for a fresher data scientist.",
    ["forecasting", "statistics", "time-series"], ["intermittent-demand", "seasonality", "promotions"], SOURCES.dsInterview,
    ["Recognizes intermittent demand and promotion-driven spikes", "Uses calendar, price, promotion, and hierarchy features", "Compares naive, seasonal, and global-model baselines", "Validates with rolling-origin backtesting across sale events", "Communicates forecast uncertainty for inventory planning"]),
  q("ds-med-rubric-020", "ecommerce", "Customer lifetime value basics",
    "How would you estimate 90-day LTV for a grocery delivery app with repeat purchases and high churn in month one?",
    ["product-analytics", "statistics", "forecasting"], ["ltv", "cohort-analysis", "survival"], SOURCES.dsInterview,
    ["Defines LTV horizon and revenue components explicitly", "Uses cohort-based historical curves or simple probabilistic models", "Handles early churn separately from mature repeat buyers", "Discusses censoring for young cohorts with incomplete observation", "Notes limitations and need for periodic refresh"]),
  q("ds-med-rubric-021", "ecommerce", "Propensity score matching",
    "You want to estimate the effect of free shipping on repeat purchase using historical data where shipping eligibility was not randomized. Explain propensity score matching at a high level.",
    ["causal-inference", "statistics", "product-analytics"], ["propensity-scores", "observational-data", "matching"], SOURCES.stats,
    ["Frames treatment and control groups with observed covariates", "Estimates propensity scores and matches comparable units", "Checks covariate balance before and after matching", "Acknowledges unmeasured confounding limitations", "Compares with randomized experiment as gold standard"]),
  q("ds-med-rubric-022", "ecommerce", "Outlier treatment in pricing analysis",
    "A few bulk orders dominate average order value. How would you summarize typical order value for a pricing dashboard?",
    ["statistics", "product-analytics", "data-quality"], ["outliers", "robust-statistics", "reporting"], SOURCES.stats,
    ["Compares mean, median, trimmed mean, and percentile summaries", "Investigates whether outliers are valid bulk customers or data errors", "Uses robust metrics for operational dashboards", "Segments B2B versus B2C if behavior differs", "Documents chosen metric and why it matches the business question"]),
  q("ds-med-rubric-023", "ecommerce", "Personalization metric selection",
    "A homepage personalization model is ready for evaluation. Which offline and online metrics would you track?",
    ["product-analytics", "model-evaluation", "experimentation"], ["personalization", "metrics", "ab-testing"], SOURCES.flipkart,
    ["Distinguishes ranking metrics from business outcomes such as conversion and revenue", "Uses holdout groups and counterfactual logging where applicable", "Monitors diversity, coverage, and cold-start performance", "Plans online A/B test with pre-registered primary metric", "Avoids optimizing only click-through without downstream value"]),
  q("ds-med-rubric-024", "ecommerce", "Seasonality in experiment analysis",
    "An A/B test ran through a festival week and a normal week. Why could pooled analysis be biased and how would you adjust?",
    ["experimentation", "statistics", "time-series"], ["seasonality", "heterogeneity", "stratification"], SOURCES.ab,
    ["Recognizes time-varying user behavior during festivals", "Stratifies or interacts treatment with week type in analysis", "Checks whether treatment effect differs by seasonality regime", "Avoids pooling incompatible periods without justification", "Recommends balanced duration across comparable time blocks"]),
  q("ds-med-rubric-025", "ecommerce", "Survey sample representativeness",
    "Post-purchase survey responses over-represent frequent buyers. How would you correct estimates of overall satisfaction?",
    ["statistics", "sampling", "product-analytics"], ["selection-bias", "weighting", "survey-design"], SOURCES.stats,
    ["Identifies non-random response mechanism and its direction of bias", "Uses inverse probability weighting or post-stratification if weights are estimable", "Compares respondents to non-respondents on observable variables", "Reports adjusted estimates with uncertainty", "Suggests design improvements such as random invitation timing"]),

  // AI/ML & analytics services (8)
  q("ds-med-rubric-026", "cyber", "Alert volume forecasting",
    "A security analytics team wants to forecast daily alert counts to staff analysts. What time-series approach would you propose and how would you validate it?",
    ["forecasting", "time-series", "statistics"], ["seasonality", "backtesting", "operations"], SOURCES.dsInterview,
    ["Treats alert counts as temporal data with day-of-week seasonality", "Uses baselines such as seasonal naive or Prophet/ARIMA class models", "Validates with rolling-origin forecasts and error metrics such as MAPE or sMAPE with caveats", "Checks stability across attack campaigns and product changes", "Connects forecasts to staffing capacity planning"]),
  q("ds-med-rubric-027", "cyber", "Rare-event baseline",
    "Only 0.05% of login events are confirmed incidents. What simple baseline would you compare an analyst's model against?",
    ["statistics", "classification", "model-evaluation"], ["baseline", "imbalanced-data", "precision-recall"], SOURCES.dsInterview,
    ["Uses always-negative or stratified random baseline reflecting prevalence", "Evaluates precision at top-k alerts given review capacity", "Explains why accuracy is misleading", "Requires improvement over baseline before deployment", "Tracks recall at fixed false-positive budget"]),
  q("ds-med-rubric-028", "cyber", "Anomaly score thresholding",
    "An unsupervised anomaly detector outputs continuous scores. How would you choose an operating threshold for analyst review?",
    ["statistics", "model-evaluation", "decision-threshold"], ["thresholding", "precision-recall", "capacity"], SOURCES.dsInterview,
    ["Frames decision under fixed daily review capacity", "Uses precision-recall or cost curve rather than default 0.5 cutoff", "Validates on labeled incidents with temporal split", "Plans periodic threshold recalibration as traffic changes", "Communicates trade-off between missed incidents and analyst load"]),
  q("ds-med-rubric-029", "cyber", "Class imbalance in threat labeling",
    "Labeled threats are scarce. Compare oversampling, class weights, and collecting more labels.",
    ["statistics", "classification", "model-selection"], ["imbalanced-data", "class-weights", "sampling"], SOURCES.stats,
    ["Explains pros and cons of oversampling including overfitting risk", "Notes class-weighted loss as a simpler alternative", "Prioritizes label quality and targeted labeling over naive duplication", "Validates with appropriate rare-event metrics", "Considers active learning for efficient labeling"]),
  q("ds-med-rubric-030", "cyber", "Feature importance for stakeholders",
    "A tree model ranks 'login hour' as top feature for incident prediction. How would you validate and explain this finding?",
    ["statistics", "communication", "model-evaluation"], ["feature-importance", "interpretability", "validation"], SOURCES.dsInterview,
    ["Distinguishes impurity importance from causal importance", "Checks stability across time splits and segments", "Uses partial dependence or SHAP cautiously with correlation caveats", "Tests whether hour is proxy for geography, role, or campaign", "Presents actionable but non-overclaimed insights"]),
  q("ds-med-rubric-031", "cyber", "Poisson versus normal errors",
    "You model daily incident counts per tenant. Why might Poisson or negative binomial regression be preferable to ordinary least squares?",
    ["statistics", "regression", "count-data"], ["poisson", "count-models", "distribution-choice"], SOURCES.stats,
    ["Recognizes nonnegative integer count outcome", "Notes variance-mean relationship in Poisson data", "Mentions overdispersion motivating negative binomial", "Contrasts with inappropriate normal assumptions on counts", "Evaluates with appropriate residual and prediction checks"]),
  q("ds-med-rubric-032", "cyber", "Geo experiment for policy change",
    "A new authentication policy will roll out city by city. How would you measure its impact on incident rate?",
    ["causal-inference", "experimentation", "statistics"], ["geo-experiment", "diff-in-diff", "policy-evaluation"], SOURCES.ab,
    ["Uses treated cities versus comparable control cities", "Discusses diff-in-diff or synthetic control at high level", "Controls for time trends and seasonality", "Checks spillover and compliance across regions", "Defines pre-period balance on key covariates"]),
  q("ds-med-rubric-033", "cyber", "Dashboard metric definition",
    "Leadership wants a single 'security health score.' Why is aggregating disparate metrics risky and what would you propose instead?",
    ["product-analytics", "statistics", "communication"], ["kpi-design", "composite-metrics", "stakeholders"], SOURCES.dsInterview,
    ["Warns that opaque composite scores hide trade-offs", "Recommends a small set of interpretable metrics with targets", "Ensures each metric has owner, definition, and data source", "Uses drill-down views rather than one misleading index", "Aligns metrics to decisions the leadership can actually take"]),

  // Enterprise (10)
  q("ds-med-rubric-034", "enterprise", "SaaS trial conversion modeling",
    "Design features and evaluation for predicting which free-trial users will convert to paid within 14 days.",
    ["classification", "feature-engineering", "product-analytics"], ["saas", "conversion", "validation"], SOURCES.dsInterview,
    ["Uses only pre-conversion behavior and firmographic features", "Defines label window and handles right-censoring for active trials", "Chooses PR-AUC or recall at top decile given imbalance", "Validates with time-based split by signup date", "Discusses actions such as sales outreach rather than only accuracy"]),
  q("ds-med-rubric-035", "enterprise", "Ticket escalation prediction",
    "Support tickets should be escalated early if likely to reopen. How would you frame the ML problem and success metrics?",
    ["classification", "product-analytics", "model-evaluation"], ["support-analytics", "precision-recall", "problem-framing"], SOURCES.dsInterview,
    ["Defines prediction horizon and reopen label clearly", "Balances precision to avoid unnecessary escalations with recall for bad experiences", "Uses ticket text and metadata features with leakage checks", "Evaluates by agent team and product line", "Integrates with workflow capacity constraints"]),
  q("ds-med-rubric-036", "enterprise", "North Star metric workshop",
    "A B2B product team asks you to propose one North Star metric. How would you facilitate the discussion?",
    ["product-analytics", "communication", "statistics"], ["north-star-metric", "kpi", "stakeholders"], SOURCES.dsInterview,
    ["Links metric to customer value and business model", "Ensures measurability, actionability, and sensitivity to product changes", "Avoids vanity metrics with weak causal link to outcomes", "Suggests complementary guardrail metrics", "Documents definition, grain, and cadence"]),
  q("ds-med-rubric-037", "enterprise", "Mixed effects for account data",
    "Usage varies strongly by account size and region. Why might a mixed-effects or hierarchical model help?",
    ["statistics", "regression", "model-selection"], ["hierarchical-modeling", "mixed-effects", "heterogeneity"], SOURCES.stats,
    ["Explains grouping structure such as users nested in accounts", "Notes partial pooling toward group means for sparse segments", "Contrasts with one global model ignoring group structure", "Discusses when complexity is justified by data size", "Validates with held-out accounts"]),
  q("ds-med-rubric-038", "enterprise", "Text feature for classification",
    "You have 200 labeled support emails and thousands unlabeled. Outline a practical text classification approach.",
    ["nlp", "classification", "model-selection"], ["text-classification", "small-data", "tf-idf"], SOURCES.dsInterview,
    ["Starts with TF-IDF or embeddings plus logistic regression baseline", "Uses cross-validation with stratification due to small label set", "Considers data augmentation or weak labels cautiously", "Evaluates per-class precision/recall for rare categories", "Plans human review loop for low-confidence predictions"]),
  q("ds-med-rubric-039", "enterprise", "Uplift modeling intro",
    "Marketing wants to target discounts only to users who would respond. Explain uplift modeling in plain terms.",
    ["causal-inference", "statistics", "product-analytics"], ["uplift-modeling", "heterogeneous-effects", "targeting"], SOURCES.dsInterview,
    ["Defines treatment effect at individual level versus average effect", "Contrasts response model with true uplift approach", "Notes need for randomized historical campaigns or specialized learners", "Warns against targeting likely buyers who would convert anyway", "Proposes evaluation via randomized policy test"]),
  q("ds-med-rubric-040", "enterprise", "Dimensionality reduction for exploration",
    "An analytics team has 60 correlated usage metrics. How would PCA help and what pitfalls would you mention?",
    ["statistics", "unsupervised-learning", "feature-engineering"], ["pca", "multicollinearity", "interpretation"], SOURCES.stats,
    ["Explains variance explanation and orthogonal components", "Warns that components may be hard to interpret operationally", "Requires scaling features before PCA", "Uses scree plot or cumulative variance rule for component choice", "Does not confuse exploratory PCA with causal feature selection"]),
  q("ds-med-rubric-041", "enterprise", "Experiment on enterprise admins",
    "Only 400 enterprise admins exist globally. Can you A/B test a dashboard change for them?",
    ["experimentation", "statistics", "ab-testing"], ["small-sample", "power", "alternatives"], SOURCES.ab,
    ["Recognizes limited power for small admin population", "Suggests longer duration, cross-over, or cluster randomization at account level if appropriate", "Uses precise primary metric and Bayesian or sequential methods cautiously", "Considers qualitative admin interviews as supplement", "Avoids overstating significance from tiny samples"]),
  q("ds-med-rubric-042", "enterprise", "Data drift in usage features",
    "Average session length feature distribution shifted after a product redesign. What analyses would you run before retraining?",
    ["statistics", "model-monitoring", "data-quality"], ["data-drift", "covariate-shift", "retraining"], SOURCES.dsInterview,
    ["Compares training versus recent production distributions with PSI or KS tests", "Checks whether label definition or logging changed", "Evaluates model performance by feature drift severity", "Determines whether retrain, recalibrate, or feature update is needed", "Documents monitoring thresholds for future alerts"]),
  q("ds-med-rubric-043", "enterprise", "Explain negative coefficient",
    "In a regression predicting seat expansion, 'training_completed' has a negative coefficient unexpectedly. How would you investigate?",
    ["statistics", "regression", "debugging"], ["multicollinearity", "confounding", "model-debugging"], SOURCES.stats,
    ["Checks sign flip due to correlated features or Simpson's paradox", "Inspects segments where relationship may differ", "Validates data quality and encoding of training_completed", "Compares simple bivariate trend with multivariate model", "Reports findings without overfitting a narrative"]),

  // Product (10)
  q("ds-med-rubric-044", "product", "Hardware yield analysis",
    "Manufacturing yield dropped from 92% to 89% over two weeks. Outline a statistical investigation plan.",
    ["statistics", "product-analytics", "hypothesis-testing"], ["yield", "process-control", "root-cause"], SOURCES.dsInterview,
    ["Checks whether change is beyond normal variation using control charts or tests", "Segments by line, supplier, shift, and batch", "Looks for recent process or material changes", "Distinguishes special cause from common cause variation", "Recommends confirmatory data collection before process changes"]),
  q("ds-med-rubric-045", "product", "Reliability data censoring",
    "Some devices have not failed by the end of the observation window. How does right censoring affect failure-rate estimation?",
    ["statistics", "survival-analysis", "product-analytics"], ["censoring", "kaplan-meier", "failure-rate"], SOURCES.stats,
    ["Defines censored observations and why they cannot be treated as failures", "Mentions Kaplan-Meier or survival models at high level", "Avoids underestimating time-to-failure by ignoring censoring", "Explains impact on sample size and follow-up duration", "Connects to warranty and maintenance planning"]),
  q("ds-med-rubric-046", "product", "Sensor calibration regression",
    "A sensor reading should predict lab-measured temperature within tolerance. How would you assess fit and outliers?",
    ["regression", "statistics", "data-quality"], ["calibration", "residual-analysis", "outliers"], SOURCES.stats,
    ["Uses scatterplot and residual analysis", "Computes RMSE/MAE within tolerance bands", "Investigates systematic bias across operating range", "Handles outliers due to sensor faults separately", "Recommends recalibration policy when drift exceeds spec"]),
  q("ds-med-rubric-047", "product", "Multivariate A/B on mobile app",
    "Two onboarding variants differ in both copy and number of screens. What caution would you raise in analysis?",
    ["experimentation", "statistics", "product-analytics"], ["factorial-design", "confounding", "ab-testing"], SOURCES.ab,
    ["Notes confounded factors if not factorially designed", "Recommends factorial or sequential tests to isolate effects", "Defines primary metric and guardrails upfront", "Checks interaction between copy and flow length", "Avoids attributing outcome to one change alone"]),
  q("ds-med-rubric-048", "product", "Clustering customer usage",
    "You cluster users by weekly feature usage to inform roadmap. How do you choose k and validate clusters?",
    ["unsupervised-learning", "statistics", "product-analytics"], ["clustering", "k-selection", "validation"], SOURCES.dsInterview,
    ["Compares elbow, silhouette, or business interpretability criteria", "Standardizes features before distance-based clustering", "Profiles clusters with actionable descriptors", "Validates stability on bootstrap or time splits", "Uses clusters for exploration not automatic causal claims"]),
  q("ds-med-rubric-049", "product", "Forecasting spare parts demand",
    "Spare parts demand is lumpy with long zero periods. Which forecasting pitfalls would you avoid?",
    ["forecasting", "statistics", "time-series"], ["intermittent-demand", "croston", "inventory"], SOURCES.dsInterview,
    ["Avoids MAPE instability with zeros", "Uses intermittent demand methods or aggregated hierarchy forecasts", "Incorporates maintenance schedules where available", "Provides prediction intervals for stock planning", "Backtests across multiple sites"]),
  q("ds-med-rubric-050", "product", "Quality metric sampling plan",
    "Only 5% of units can be lab tested. How would you design a sampling plan to estimate defect rate?",
    ["statistics", "sampling", "hypothesis-testing"], ["sample-design", "confidence-interval", "quality-control"], SOURCES.stats,
    ["Defines defect clearly and sampling frame", "Computes sample size for desired margin of error", "Uses random sampling across batches and shifts", "Reports interval estimate not only point estimate", "Plans escalation if upper confidence bound exceeds spec"]),
  q("ds-med-rubric-051", "product", "Bayes for small beta test",
    "A hardware beta has only 40 devices. How could a Bayesian approach help report reliability?",
    ["statistics", "probability", "product-analytics"], ["bayesian", "small-sample", "reliability"], SOURCES.stats,
    ["Incorporates prior engineering knowledge with observed failures", "Produces posterior interval for failure rate", "Communicates uncertainty honestly with small n", "Contrasts with overly precise frequentist claims", "Updates beliefs as more field data arrives"]),
  q("ds-med-rubric-052", "product", "Correlation in telemetry",
    "Two telemetry metrics correlate at 0.9. Should one be dropped before modeling?",
    ["statistics", "feature-engineering", "regression"], ["multicollinearity", "correlation", "feature-selection"], SOURCES.stats,
    ["Explains multicollinearity impact on coefficient stability", "Considers domain importance and measurement cost", "Uses VIF, regularization, or PCA as remedies", "Does not drop arbitrarily without business rationale", "Validates predictive performance after reduction"]),
  q("ds-med-rubric-053", "product", "Geo heterogeneity in adoption",
    "Product adoption differs sharply by region after launch. How would you analyze drivers without overfitting?",
    ["statistics", "product-analytics", "regression"], ["heterogeneity", "regularization", "segmentation"], SOURCES.dsInterview,
    ["Starts with parsimonious model plus region fixed effects", "Tests interaction terms only with correction or pre-specification", "Uses holdout regions for validation when possible", "Separates market maturity from product fit", "Presents actionable regional insights with uncertainty"]),

  // Service / consulting (12)
  q("ds-med-rubric-054", "service", "Client problem scoping",
    "A client asks for 'AI' to reduce churn but provides only a spreadsheet export. What do you do in the first week?",
    ["problem-framing", "communication", "product-analytics"], ["consulting", "scoping", "stakeholders"], SOURCES.fractal,
    ["Clarifies business objective, decision, and success metric", "Audits data freshness, grain, and label availability", "Proposes baseline analysis before complex modeling", "Sets realistic timeline and risks such as missing identifiers", "Documents assumptions and deliverables"]),
  q("ds-med-rubric-055", "service", "Baseline before complex model",
    "Why should you present a simple churn baseline to a consulting client before a gradient boosting model?",
    ["model-selection", "statistics", "communication"], ["baseline", "value-proof", "consulting"], SOURCES.fractal,
    ["Demonstrates incremental value of complexity", "Builds trust with interpretable benchmark", "Reveals data issues early with simple models", "Anchors expectations on realistic performance", "Speeds iteration before expensive feature work"]),
  q("ds-med-rubric-056", "service", "Translate R-squared",
    "A client sees R-squared of 0.42 and asks if the model is good enough. How do you respond?",
    ["statistics", "regression", "communication"], ["r-squared", "interpretation", "stakeholders"], SOURCES.stats,
    ["Explains variance explained versus unexplained", "Compares to baseline and business impact not only R-squared", "Notes domain context: 0.42 may be strong or weak depending on noise", "Discusses prediction interval usefulness for decisions", "Avoids equating R-squared with causality"]),
  q("ds-med-rubric-057", "service", "Train-test leakage in client pipeline",
    "Client scaled numeric features on the full dataset before splitting. Fix the workflow and explain the impact.",
    ["statistics", "data-leakage", "validation"], ["preprocessing-leakage", "cross-validation", "consulting"], SOURCES.fractal,
    ["Moves scaling inside cross-validation or train-only fit", "Explains optimistic bias introduced by global scaling", "Re-runs evaluation with corrected pipeline", "Documents reproducible preprocessing for production", "Teaches client team proper validation hygiene"]),
  q("ds-med-rubric-058", "service", "Present uncertainty to executives",
    "Your forecast shows 10% growth plus or minus 4 points. The CEO wants a single number. How do you handle the conversation?",
    ["communication", "statistics", "forecasting"], ["uncertainty", "forecast-intervals", "stakeholders"], SOURCES.fractal,
    ["Explains why interval reflects real uncertainty and risk", "Offers scenario ranges tied to decisions such as hiring or inventory", "Avoids false precision that could misguide capital allocation", "Uses visuals like fan charts for clarity", "Aligns on decision thresholds not point estimate alone"]),
  q("ds-med-rubric-059", "service", "Chi-square for campaign segments",
    "You test whether conversion differs across four customer segments using a chi-square test. State assumptions and alternatives.",
    ["statistics", "hypothesis-testing", "product-analytics"], ["chi-square", "categorical-data", "assumptions"], SOURCES.stats,
    ["Defines contingency table and null hypothesis", "Mentions expected count assumptions and Fisher alternative if sparse", "Corrects for multiple segments if exploratory", "Reports effect size not only p-value", "Suggests follow-up experiment for actionable segments"]),
  q("ds-med-rubric-060", "service", "Log transform skewed revenue",
    "Client revenue per user is heavily right-skewed. When is log transformation appropriate before regression?",
    ["statistics", "regression", "feature-engineering"], ["log-transform", "skewness", "interpretation"], SOURCES.stats,
    ["Uses log when multiplicative effects and variance stabilization help", "Checks for zeros and handles with offset or separate modeling", "Interprets coefficients on log scale carefully", "Compares models with and without transform on validation metric", "Validates residuals after transformation"]),
  q("ds-med-rubric-061", "service", "Sample size for survey",
    "A client wants to estimate NPS within plus or minus 3 points. How do you approximate required respondents?",
    ["statistics", "sampling", "product-analytics"], ["sample-size", "confidence-interval", "nps"], SOURCES.stats,
    ["Uses margin of error formula with estimated proportion", "Accounts for conservative p=0.5 if unsure", "Adjusts for expected response rate to set invitations", "Discusses stratification by key segments", "Reports cost-time trade-off"]),
  q("ds-med-rubric-062", "service", "Automated versus manual labels",
    "A client wants to train on rules-based pseudo-labels for 1M rows with 500 manual labels. What risks do you highlight?",
    ["statistics", "labeling", "model-evaluation"], ["weak-labels", "bias", "validation"], SOURCES.fractal,
    ["Warns that pseudo-labels inherit rule biases and limit ceiling performance", "Uses manual labels for validation and calibration", "Tracks label confidence and error modes", "Plans iterative relabeling on failure cases", "Does not report inflated metrics from circular evaluation"]),
  q("ds-med-rubric-063", "service", "Central Limit Theorem intuition",
    "A junior analyst asks why averaging many user session lengths yields a near-normal distribution. Explain CLT simply.",
    ["statistics", "probability", "communication"], ["central-limit-theorem", "sampling-distribution", "intuition"], SOURCES.stats,
    ["Explains sum or average of many independent-ish observations", "Notes conditions: sufficient sample size and finite variance", "Connects to confidence intervals and t-tests on means", "Clarifies CLT does not normalize raw skewed data automatically", "Uses simple numeric example"]),
  q("ds-med-rubric-064", "service", "Simpson's paradox in hiring funnel",
    "Overall pass rate rises but every department's pass rate falls. Explain Simpson's paradox and next steps.",
    ["statistics", "causal-inference", "communication"], ["simpsons-paradox", "aggregation", "stratification"], SOURCES.stats,
    ["Shows how weighted aggregation can reverse segment trends", "Requires analysis by department and applicant mix changes", "Avoids misleading executive summary at aggregate only", "Visualizes with mosaic or faceted rates", "Recommends decision-making at appropriate granularity"]),
  q("ds-med-rubric-065", "service", "Deliverable for non-technical sponsor",
    "You must deliver churn analysis results to a sponsor who will not read code. What does the deck include?",
    ["communication", "product-analytics", "consulting"], ["storytelling", "deliverables", "stakeholders"], SOURCES.fractal,
    ["Leads with business question, metric movement, and recommendation", "Includes one clear chart with definition footnotes", "States limitations, data gaps, and next experiment", "Separates appendix methods from executive summary", "Defines owner and monitoring plan post-delivery"]),

  // Semiconductors (5)
  q("ds-med-rubric-066", "semiconductors", "Wafer defect spatial pattern",
    "Defects cluster at wafer edge in recent lots. Describe analyses to confirm pattern and prioritize investigation.",
    ["statistics", "product-analytics", "hypothesis-testing"], ["spatial-analysis", "process-control", "defects"], SOURCES.dsInterview,
    ["Visualizes defect density by wafer radius and lot", "Tests edge versus center rates with appropriate statistical test", "Checks tool, batch, and operator covariates", "Rules out mapping or inspection artifact", "Recommends targeted metrology on edge ring"]),
  q("ds-med-rubric-067", "semiconductors", "DOE for process window",
    "Process engineers can vary two temperature settings in a limited DOE. How would you plan and analyze the experiment?",
    ["statistics", "experimentation", "hypothesis-testing"], ["design-of-experiments", "factorial", "response-surface"], SOURCES.stats,
    ["Proposes factorial or central composite design within safe bounds", "Defines primary yield or parametric response", "Analyzes main effects and interaction plots", "Checks reproducibility with center points", "Communicates optimal window with uncertainty"]),
  q("ds-med-rubric-068", "semiconductors", "Equipment comparison with small batches",
    "Only six batches per tool are available to compare mean thickness. Which test or interval approach is appropriate?",
    ["statistics", "hypothesis-testing", "product-analytics"], ["small-sample", "t-test", "assumptions"], SOURCES.stats,
    ["Checks normality and variance assumptions with small n", "Uses two-sample t-test or nonparametric alternative if needed", "Reports confidence interval for mean difference", "Acknowledges low power and need for more data", "Avoids overconfident conclusions"]),
  q("ds-med-rubric-069", "semiconductors", "SPC chart interpretation",
    "An X-bar chart shows one point above the upper control limit. What actions and statistical interpretation apply?",
    ["statistics", "product-analytics", "process-control"], ["spc", "control-charts", "special-cause"], SOURCES.stats,
    ["Identifies special cause signal versus common cause noise", "Investigates assignable causes before adjusting limits", "Avoids tampering by overreacting to random variation", "Documents corrective action and follow-up lots", "Retrains if pattern suggests measurement drift"]),
  q("ds-med-rubric-070", "semiconductors", "Predicting parametric yield",
    "You have inline measurements predicting final parametric fail. How would you handle class imbalance and cost asymmetry?",
    ["classification", "statistics", "model-evaluation"], ["imbalanced-data", "cost-sensitive", "manufacturing"], SOURCES.dsInterview,
    ["Uses metrics aligned with scrap cost versus false alarm cost", "Applies stratified validation by lot and tool", "Considers threshold tuning for downstream rework capacity", "Checks stability across process nodes", "Pairs model with engineer review for borderline cases"]),

  // Startup (5)
  q("ds-med-rubric-071", "startup", "Early-stage funnel with tiny traffic",
    "A startup has 300 weekly sign-ups. Can they A/B test landing page copy reliably?",
    ["experimentation", "statistics", "product-analytics"], ["small-sample", "power", "startups"], SOURCES.ab,
    ["Calculates power for plausible conversion lifts", "Suggests sequential testing, longer run, or bolder variants if ethical", "Uses precise primary metric and avoids many simultaneous tests", "Considers qualitative user tests as complement", "Sets decision rule before peeking"]),
  q("ds-med-rubric-072", "startup", "Growth metric vs revenue",
    "Leadership tracks DAU growth while revenue is flat. How would you diagnose the gap?",
    ["product-analytics", "statistics", "communication"], ["growth-metrics", "monetization", "diagnostics"], SOURCES.dsInterview,
    ["Examines activation, retention, and monetization funnel separately", "Checks whether new users are lower quality channels", "Compares cohort revenue not only headline DAU", "Proposes metrics tied to sustainable unit economics", "Recommends experiments on paywall or pricing"]),
  q("ds-med-rubric-073", "startup", "Prioritizing roadmap with limited data",
    "You have survey qual data and partial usage logs. How do you prioritize two feature bets?",
    ["product-analytics", "communication", "statistics"], ["prioritization", "small-data", "startups"], SOURCES.dsInterview,
    ["Combines qualitative severity with quantitative reach estimates", "Defines measurable success criteria for each bet", "Runs cheap prototypes or fake-door tests where possible", "Communicates uncertainty explicitly", "Plans fast post-launch measurement"]),
  q("ds-med-rubric-074", "startup", "Retention curve for new app",
    "Day-1 retention is 40% but day-7 is 12%. What analyses help find the drop-off cause?",
    ["product-analytics", "statistics", "time-series"], ["retention", "cohort-analysis", "onboarding"], SOURCES.dsInterview,
    ["Maps user journey events between day 1 and day 7", "Segments by acquisition channel and device", "Compares retained versus churned feature usage", "Checks for product bugs or notification failures", "Proposes targeted onboarding experiment"]),
  q("ds-med-rubric-075", "startup", "Investor metric sanity check",
    "Founders claim 300% YoY growth from 50 to 200 customers. What statistical and business questions do you ask?",
    ["statistics", "communication", "product-analytics"], ["metrics", "sanity-check", "startups"], SOURCES.dsInterview,
    ["Verifies numerator definition and churn replacement", "Asks about revenue, retention, and concentration in top accounts", "Checks whether growth is sustainable or promo-driven", "Requests cohort view not only totals", "Highlights uncertainty with small base sizes"]),
];

const mcqs = [
  m("ds-med-mcq-001", "fintech", "P-value interpretation",
    "A hypothesis test returns p = 0.03 at alpha = 0.05. Which statement is most correct?",
    ["statistics", "hypothesis-testing"], ["p-values", "interpretation"], SOURCES.stats,
    ["The null hypothesis is false", "There is a 3% probability the null is true", "If the null were true, seeing this result or more extreme would be unlikely", "The effect size is large"], "C",
    "A p-value is the probability of observing data at least this extreme assuming the null hypothesis is true."),
  m("ds-med-mcq-002", "fintech", "Imbalanced classification metric",
    "Which metric is generally most informative for a rare positive event in classification?",
    ["model-evaluation", "classification"], ["imbalanced-data", "metrics"], SOURCES.stats,
    ["Accuracy", "PR-AUC or F1", "R-squared", "Silhouette score"], "B",
    "Precision-recall based metrics focus on positive-class performance when negatives dominate."),
  m("ds-med-mcq-003", "fintech", "Confidence interval meaning",
    "A 95% confidence interval for conversion rate means what in the frequentist sense?",
    ["statistics", "probability"], ["confidence-intervals", "frequentist"], SOURCES.stats,
    ["95% of users convert within the interval", "In repeated samples, 95% of such intervals contain the true rate", "There is a 95% probability the true rate is inside this specific interval", "The point estimate is wrong 95% of the time"], "B",
    "Frequentist confidence intervals refer to long-run coverage properties of the procedure."),
  m("ds-med-mcq-004", "fintech", "Logistic regression output",
    "An odds ratio of 1.8 for a binary feature in logistic regression implies what?",
    ["regression", "statistics"], ["logistic-regression", "odds-ratio"], SOURCES.stats,
    ["Odds multiply by 1.8 when the feature increases by one unit, holding others fixed", "Probability increases by 1.8", "The feature causes an 80% increase in outcome with certainty", "The coefficient must be zero"], "A",
    "Odds ratio exp(beta) scales odds multiplicatively for a one-unit increase."),
  m("ds-med-mcq-005", "fintech", "Sample ratio mismatch",
    "Which test is commonly used to detect sample ratio mismatch in A/B tests?",
    ["experimentation", "statistics"], ["sample-ratio-mismatch", "chi-square"], SOURCES.ab,
    ["Chi-square goodness-of-fit on assignment counts", "K-means clustering", "Kolmogorov-Smirnov on revenue", "Silhouette score"], "A",
    "SRM checks whether observed assignment counts deviate from expected randomization ratios."),

  m("ds-med-mcq-006", "ecommerce", "Retention definition",
    "Which definition is a standard weekly retention metric?",
    ["product-analytics", "statistics"], ["retention", "cohorts"], SOURCES.dsInterview,
    ["Share of a signup cohort active in week k after signup", "Total daily active users divided by installs", "Average session length across all users", "Number of new SKUs added"], "A",
    "Cohort retention tracks the same signup group over subsequent periods."),
  m("ds-med-mcq-007", "ecommerce", "Median versus mean",
    "For heavily skewed order values, which summary is usually more representative of a typical order?",
    ["statistics", "product-analytics"], ["robust-statistics", "skewness"], SOURCES.stats,
    ["Mean", "Median", "Maximum", "Variance"], "B",
    "Median is robust to extreme values in skewed distributions."),
  m("ds-med-mcq-008", "ecommerce", "Experiment unit",
    "Testing a homepage layout should usually randomize at which unit to avoid interference?",
    ["experimentation", "ab-testing"], ["randomization-unit", "network-effects"], SOURCES.ab,
    ["User or browser cookie", "Individual page element click", "Warehouse SKU", "Daily aggregate revenue"], "A",
    "Randomization at the user level avoids within-user contamination across variants."),
  m("ds-med-mcq-009", "ecommerce", "Multiple testing",
    "Running 50 segment tests without correction primarily increases risk of what?",
    ["statistics", "experimentation"], ["multiple-testing", "false-discovery"], SOURCES.stats,
    ["False positives", "Lower variance", "Higher power always", "Causal identification"], "A",
    "Many tests inflate the chance of finding spurious significant results."),
  m("ds-med-mcq-010", "ecommerce", "MAPE issue",
    "Why can MAPE be problematic when actual demand is often zero?",
    ["forecasting", "statistics"], ["mape", "intermittent-demand"], SOURCES.stats,
    ["It divides by actual values and blows up near zero", "It cannot be computed for time series", "It requires binary labels", "It equals RMSE for count data"], "A",
    "MAPE is unstable when denominators are zero or very small."),

  m("ds-med-mcq-011", "enterprise", "Regularization purpose",
    "L2 regularization in linear regression primarily helps with what?",
    ["regression", "statistics"], ["regularization", "overfitting"], SOURCES.stats,
    ["Shrinks coefficients to reduce overfitting", "Guarantees causal inference", "Removes need for validation data", "Converts regression to classification"], "A",
    "L2 penalty discourages large weights and improves generalization."),
  m("ds-med-mcq-012", "enterprise", "Train-test split leakage",
    "Fitting a scaler on all data before splitting causes what problem?",
    ["data-leakage", "validation"], ["preprocessing-leakage", "cross-validation"], SOURCES.fractal,
    ["Validation information leaks into preprocessing", "Labels become balanced automatically", "Model cannot overfit", "Test set size doubles"], "A",
    "Global preprocessing uses statistics from validation/test data, optimistically biasing evaluation."),
  m("ds-med-mcq-013", "enterprise", "Type I error",
    "In hypothesis testing, Type I error is:",
    ["statistics", "hypothesis-testing"], ["type-i-error", "alpha"], SOURCES.stats,
    ["Rejecting a true null hypothesis", "Failing to reject a false null", "Measuring effect size", "Collecting too large a sample"], "A",
    "Type I error is a false positive conclusion about the null."),
  m("ds-med-mcq-014", "enterprise", "PCA prerequisite",
    "Before applying PCA, numeric features should usually be:",
    ["statistics", "unsupervised-learning"], ["pca", "scaling"], SOURCES.stats,
    ["Standardized to comparable scales", "Converted to categorical codes", "Sorted alphabetically", "Duplicated"], "A",
    "PCA is scale-sensitive; standardization prevents large-variance features dominating."),
  m("ds-med-mcq-015", "enterprise", "Uplift modeling goal",
    "Uplift modeling primarily targets users who:",
    ["causal-inference", "product-analytics"], ["uplift-modeling", "targeting"], SOURCES.dsInterview,
    ["Respond because of the treatment", "Would convert regardless of treatment", "Never respond under any condition", "Have missing labels only"], "A",
    "Uplift focuses on persuadable users whose outcome changes due to treatment."),

  m("ds-med-mcq-016", "product", "Control chart signal",
    "One point beyond upper control limits in an X-bar chart most likely indicates:",
    ["statistics", "process-control"], ["spc", "special-cause"], SOURCES.stats,
    ["A special-cause shift worth investigation", "Random common-cause noise only", "Guaranteed improved yield", "Need to widen spec without analysis"], "A",
    "Control limit breaches suggest assignable special causes rather than routine variation."),
  m("ds-med-mcq-017", "product", "Survival censoring",
    "Right censoring in reliability data means:",
    ["statistics", "survival-analysis"], ["censoring", "reliability"], SOURCES.stats,
    ["Observation ended before the event occurred", "The event time was negative", "All units failed", "Labels were randomly swapped"], "A",
    "Censored units have unknown event times beyond the observation window."),
  m("ds-med-mcq-018", "product", "Poisson data",
    "Count of daily defects is best modeled with error structure similar to:",
    ["statistics", "regression"], ["poisson", "count-data"], SOURCES.stats,
    ["Poisson or negative binomial", "Normal with negative values allowed", "Uniform on [0,1]", "Binary only"], "A",
    "Count outcomes are nonnegative integers often modeled with Poisson-family distributions."),
  m("ds-med-mcq-019", "product", "Simpson's paradox",
    "Simpson's paradox occurs when:",
    ["statistics", "causal-inference"], ["simpsons-paradox", "aggregation"], SOURCES.stats,
    ["Aggregate trend reverses within all subgroups", "Sample size is too large", "p-values equal zero", "Correlation implies causation"], "A",
    "Weighted aggregation can reverse direction of trends seen in each subgroup."),
  m("ds-med-mcq-020", "product", "Cluster count selection",
    "Silhouette score is commonly used to:",
    ["unsupervised-learning", "statistics"], ["clustering", "k-selection"], SOURCES.dsInterview,
    ["Compare cluster separation/cohesion for different k", "Test causal effects", "Compute p-values for regression", "Validate SQL queries"], "A",
    "Silhouette helps assess clustering quality across candidate k values."),

  m("ds-med-mcq-021", "service", "Cross-validation fold fit",
    "When using k-fold CV, preprocessing such as scaling should be:",
    ["validation", "statistics"], ["cross-validation", "leakage"], SOURCES.fractal,
    ["Fit on training folds only for each split", "Fit once on the entire dataset", "Fit on the validation fold only", "Skipped for tree models always"], "A",
    "Preprocessing must be learned without validation fold information each split."),
  m("ds-med-mcq-022", "service", "Effect size vs p-value",
    "A very large sample can yield a significant p-value even when:",
    ["statistics", "hypothesis-testing"], ["effect-size", "p-values"], SOURCES.stats,
    ["The practical effect is tiny", "The null is true with certainty", "Variance is infinite", "Data are perfectly balanced"], "A",
    "Large n detects minuscule differences that may lack practical importance."),
  m("ds-med-mcq-023", "service", "Chi-square use",
    "Chi-square test of independence is appropriate for:",
    ["statistics", "hypothesis-testing"], ["chi-square", "categorical-data"], SOURCES.stats,
    ["Two categorical variables in a contingency table", "Continuous normal outcomes only", "Time series autocorrelation only", "Image pixel classification"], "A",
    "Chi-square assesses association between categorical variables."),
  m("ds-med-mcq-024", "service", "Bayesian prior role",
    "A informative prior in Bayesian analysis mainly:",
    ["statistics", "probability"], ["bayesian", "prior"], SOURCES.stats,
    ["Encodes existing knowledge before seeing new data", "Eliminates need for likelihood", "Guarantees unbiased estimates", "Replaces cross-validation"], "A",
    "Priors represent belief about parameters updated by data through the likelihood."),
  m("ds-med-mcq-025", "service", "Baseline model purpose",
    "A strong reason to build a baseline model first is to:",
    ["model-selection", "consulting"], ["baseline", "value-proof"], SOURCES.fractal,
    ["Quantify incremental value of complex approaches", "Avoid defining metrics", "Skip validation entirely", "Guarantee deep learning wins"], "A",
    "Baselines anchor performance and justify additional model complexity."),
];

const companyTagsFor = (category, index) => {
  const companies = COMPANIES[category];
  return Array.from({ length: 4 }, (_, offset) => companies[(index * 4 + offset) % companies.length]);
};

const rubricFor = (criteria) =>
  criteria.map((text, index) => ({
    text,
    category: ["problemFraming", "technicalReasoning", "tradeoffs", "evaluation", "communication"][index] || "coverage",
    importance: index < 3 ? "mustHave" : "goodToHave",
    expectedAnswerMode: "conceptual",
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

const rubricCsv = "ds-data-scientist-medium-rubric-75.csv";
const mcqCsv = "ds-data-scientist-medium-mcq-25.csv";

await writeCsv(
  rubricCsv,
  ["questionId", "title", "question", "companyTags", "topics", "subtopics", "url", "rubric", "source", "verified", "qualityScore"],
  descriptive.map((item) => ({
    questionId: item.id,
    title: item.title,
    question: item.question,
    companyTags: tagsForItem(item).join("|"),
    topics: item.topics.join("|"),
    subtopics: item.subtopics.join("|"),
    url: item.source,
    rubric: JSON.stringify(rubricFor(item.criteria)),
    source: "public_interview_pattern_curated",
    verified: "false",
    qualityScore: "0.9",
  }))
);

// Reset offsets for MCQ company rotation
for (const key of Object.keys(categoryOffsets)) categoryOffsets[key] = 0;

await writeCsv(
  mcqCsv,
  ["questionId", "title", "question", "companyTags", "topics", "subtopics", "url", "optionA", "optionB", "optionC", "optionD", "correctOptionId", "explanation", "source", "verified", "qualityScore"],
  mcqs.map((item) => ({
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

const summary = {
  outputDir,
  rubricFile: rubricCsv,
  mcqFile: mcqCsv,
  rubricRows: descriptive.length,
  mcqRows: mcqs.length,
  rubricByCategory: descriptive.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + 1;
    return acc;
  }, {}),
};

// Optional DB dedupe check when MONGO_URI is available
if (process.env.MONGO_URI) {
  const mongoose = (await import("mongoose")).default;
  const InterviewQuestion = (await import("../models/InterviewQuestion.js")).default;
  await mongoose.connect(process.env.MONGO_URI);
  const existing = await InterviewQuestion.find({}, { questionId: 1, title: 1, question: 1 }).lean();
  const existingIds = new Set(existing.map((row) => row.questionId));
  const existingTitleKeys = new Set(existing.map((row) => normalizeKey(row.title)));
  const existingQuestionKeys = new Set(existing.map((row) => normalizeKey(row.question?.slice(0, 120))));

  const allNew = [...descriptive, ...mcqs];
  const dupIds = allNew.filter((item) => existingIds.has(item.id)).map((item) => item.id);
  const dupTitles = allNew.filter((item) => existingTitleKeys.has(normalizeKey(item.title))).map((item) => item.title);
  const dupQuestions = allNew
    .filter((item) => existingQuestionKeys.has(normalizeKey(item.question.slice(0, 120))))
    .map((item) => item.id);

  summary.dbDedupe = {
    existingQuestionCount: existing.length,
    duplicateIds: dupIds,
    duplicateTitles: dupTitles,
    duplicateQuestionPrefixes: dupQuestions,
  };

  if (dupIds.length || dupTitles.length || dupQuestions.length) {
    console.error(JSON.stringify(summary, null, 2));
    await mongoose.disconnect();
    process.exit(1);
  }
  await mongoose.disconnect();
}

console.log(JSON.stringify(summary, null, 2));
