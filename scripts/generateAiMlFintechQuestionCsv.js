import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(__dirname, "data", "generated-interview-imports");

const FINTECH_COMPANIES = [
  "Arcesium",
  "Axis Bank",
  "BNY Mellon",
  "Bajaj Finserve Health Ltd.",
  "Commonwealth Bank of Australia (CBA)",
  "DE Shaw",
  "Deutsche Bank",
  "Dhurin",
  "Digit Life Insurance",
  "ETG",
  "Edelman Financial Engines",
  "Ethos Technologies (Ethos Life)",
  "Fidelity Investments",
  "Futures First",
  "Goldman Sachs",
  "Green Light Financial Technology",
  "Groww",
  "HSBC",
  "Hyperface",
  "IDFC First Bank",
  "Intuit",
  "Ion Group",
  "JPMorganChase",
  "JusPay",
  "MUFG",
  "Morgan Stanley",
  "Navi",
  "Northern Trust",
  "OnePay",
  "PhonePe",
  "Prosperr.io",
  "Qnance Technologies LLP",
  "Razorpay",
  "Societe Generale",
  "Standard Chartered Bank",
  "State Street",
  "Super Money",
  "UPSWING Financial Technology",
  "Visa",
  "Wells Fargo",
  "Zeta",
];

const SOURCES = {
  visa: "https://hkasawatia.medium.com/my-data-scientist-interview-experience-at-visa-13a2e59251a2",
  visaGuide: "https://www.interviewquery.com/interview-guides/visa-machine-learning-engineer",
  razorpay: "https://www.geeksforgeeks.org/interview-experiences/razorpay-pse-intern-interview-experience-on-campus-2025/",
  razorpayScale: "https://razorpay.com/unfiltered/data-science-at-scale-using-apache-flink/",
  paytm: "https://www.geeksforgeeks.org/interview-experiences/paytm-interview-experience-for-data-engineer/",
  jpmorgan: "https://www.datainterview.com/blog/jpmorgan-chase-machine-learning-engineer-interview",
  goldman: "https://www.datainterview.com/blog/goldman-sachs-data-scientist-interview",
  fraud: "https://system-design.space/en/chapter/fraud-risk-ml-system-case/",
};

const descriptive = [
  {
    id: "aiml-fintech-med-001",
    title: "Fraud model beyond accuracy",
    question:
      "A payment-fraud model reports 99.7% accuracy, but investigators say it misses too many fraudulent transactions. Walk through how you would evaluate the model, choose metrics, and set an operating threshold.",
    topics: ["classification", "imbalanced-data", "model-evaluation"],
    subtopics: ["precision-recall", "pr-auc", "thresholding", "business-cost"],
    source: SOURCES.visaGuide,
    points: [
      "Recognizes that accuracy is misleading for a severely imbalanced fraud dataset",
      "Uses precision, recall, PR-AUC, confusion matrix, and cost-sensitive business metrics",
      "Explains the false-positive versus false-negative trade-off in payments",
      "Selects thresholds using fraud loss, approval rate, or manual-review capacity",
      "Validates performance by time period and relevant customer or merchant segments",
    ],
  },
  {
    id: "aiml-fintech-med-002",
    title: "Time-aware fraud validation",
    question:
      "You have two years of transaction data and must predict fraud next month. Why can a random train-test split give an overly optimistic result, and how would you design the validation strategy?",
    topics: ["validation", "fraud-detection", "time-series"],
    subtopics: ["temporal-split", "leakage", "backtesting"],
    source: SOURCES.goldman,
    points: [
      "Explains that random splitting can move future patterns or duplicate entities into training",
      "Uses chronological train, validation, and test windows",
      "Preserves label-maturity windows so unresolved transactions are not treated as legitimate",
      "Considers rolling or walk-forward validation across multiple periods",
      "Checks performance under seasonal events and changing fraud regimes",
    ],
  },
  {
    id: "aiml-fintech-med-003",
    title: "Learning with delayed chargeback labels",
    question:
      "Chargebacks arrive 30–60 days after a card transaction, but the fraud model is retrained weekly. How would you construct labels and a training process without incorrectly marking unresolved transactions as legitimate?",
    topics: ["fraud-detection", "labeling", "ml-pipeline"],
    subtopics: ["delayed-labels", "label-maturity", "proxy-labels"],
    source: SOURCES.fraud,
    points: [
      "Separates unresolved, matured legitimate, and confirmed fraudulent outcomes",
      "Trains primary models only on examples whose label window has matured",
      "Uses early signals such as analyst decisions carefully as noisy or proxy labels",
      "Tracks label source and maturity metadata for reproducibility",
      "Evaluates delayed-label bias and updates the model when final outcomes arrive",
    ],
  },
  {
    id: "aiml-fintech-med-004",
    title: "Fraud concept drift",
    question:
      "A fraud model performed well three months ago, but fraudsters have changed their behavior and recall is falling. How would you detect, diagnose, and respond to this concept drift?",
    topics: ["model-monitoring", "fraud-detection", "production-ml"],
    subtopics: ["concept-drift", "feature-drift", "retraining"],
    source: SOURCES.fraud,
    points: [
      "Monitors score, feature, approval, challenge, and fraud-rate distributions by segment",
      "Distinguishes data-quality incidents from genuine behavior or concept drift",
      "Uses delayed ground-truth metrics when labels mature",
      "Proposes rolling training windows, recalibration, or retraining triggers",
      "Uses safe rollout practices such as shadow or champion-challenger evaluation",
    ],
  },
  {
    id: "aiml-fintech-med-005",
    title: "Online-offline feature consistency",
    question:
      "An offline fraud model has strong validation metrics, but production performance is poor. Investigation shows that transaction-velocity features differ between training and serving. How would you prevent and debug this training-serving skew?",
    topics: ["feature-engineering", "production-ml", "feature-store"],
    subtopics: ["training-serving-skew", "point-in-time-correctness", "data-quality"],
    source: SOURCES.razorpayScale,
    points: [
      "Identifies inconsistent feature definitions and event-time handling as likely causes",
      "Uses shared feature definitions or a feature store for offline and online computation",
      "Builds point-in-time correct historical features to avoid leakage",
      "Logs online feature values and compares them with offline recomputation",
      "Adds freshness, null-rate, range, and distribution monitoring for features",
    ],
  },
  {
    id: "aiml-fintech-med-006",
    title: "Smart payment routing model",
    question:
      "Design the ML approach for routing a payment to the bank or payment processor most likely to succeed. What would you predict, which features would you use, and how would you evaluate the policy?",
    topics: ["ranking", "payment-routing", "applied-ml"],
    subtopics: ["contextual-features", "offline-evaluation", "exploration"],
    source: SOURCES.razorpayScale,
    points: [
      "Frames the output as success probability or ranking per available route",
      "Uses bank, payment method, amount, issuer, time, latency, and recent route-health features",
      "Avoids leakage from post-routing outcomes unavailable at decision time",
      "Evaluates success rate, latency, cost, and segment-level reliability",
      "Discusses exploration, feedback bias, fallback rules, and safe online experimentation",
    ],
  },
  {
    id: "aiml-fintech-med-007",
    title: "Cost-sensitive fraud threshold",
    question:
      "A new threshold catches 12% more fraud but also blocks 3% more legitimate payments. How would you decide whether to deploy it?",
    topics: ["decision-threshold", "fraud-detection", "business-metrics"],
    subtopics: ["expected-cost", "false-declines", "segmentation"],
    source: SOURCES.visaGuide,
    points: [
      "Quantifies fraud prevented and revenue or customer cost from false declines",
      "Uses calibrated probabilities or an expected-cost decision rule",
      "Examines effects by amount, merchant, geography, and customer segment",
      "Considers a review or step-up-authentication band instead of binary blocking",
      "Proposes controlled rollout with guardrails and post-deployment monitoring",
    ],
  },
  {
    id: "aiml-fintech-med-008",
    title: "Explainable credit-risk model",
    question:
      "A gradient-boosted credit-risk model outperforms logistic regression, but compliance requires adverse-action explanations. How would you balance predictive performance, stability, and explainability?",
    topics: ["credit-risk", "explainability", "model-governance"],
    subtopics: ["shap", "calibration", "regulatory-compliance"],
    source: SOURCES.goldman,
    points: [
      "Compares global model behavior with per-decision explanations",
      "Uses constrained features and explanation techniques such as SHAP with validation",
      "Checks stability, calibration, fairness, and monotonic behavior",
      "Considers an interpretable challenger or monotonic model when appropriate",
      "Documents limitations, reason-code generation, human review, and auditability",
    ],
  },
  {
    id: "aiml-fintech-med-009",
    title: "Graph features for fraud rings",
    question:
      "Individual transactions look normal, but fraud is coordinated across accounts sharing devices, cards, IP addresses, and merchants. How would you model and detect these fraud rings?",
    topics: ["graph-ml", "fraud-detection", "feature-engineering"],
    subtopics: ["entity-resolution", "connected-components", "graph-features"],
    source: SOURCES.fraud,
    points: [
      "Represents accounts and related entities as a heterogeneous graph",
      "Creates linkage, neighborhood-risk, velocity, and shared-entity features",
      "Addresses entity resolution, changing identifiers, and event-time windows",
      "Suggests graph algorithms or graph models with a simpler baseline first",
      "Prevents leakage and supports low-latency online feature retrieval",
    ],
  },
  {
    id: "aiml-fintech-med-010",
    title: "Cold-start merchant risk",
    question:
      "A risk model depends heavily on a merchant’s transaction history. How would you score a newly onboarded merchant with almost no historical data?",
    topics: ["cold-start", "risk-modeling", "feature-engineering"],
    subtopics: ["hierarchical-features", "priors", "uncertainty"],
    source: SOURCES.visaGuide,
    points: [
      "Uses onboarding, category, geography, product, and network-level contextual features",
      "Introduces population or peer-group priors rather than zero-filled history",
      "Represents uncertainty and applies conservative limits or review during cold start",
      "Updates features and scores as evidence accumulates",
      "Evaluates new merchants separately from established merchants",
    ],
  },
  {
    id: "aiml-fintech-med-011",
    title: "Unsupervised anomaly detection",
    question:
      "You need to identify novel transaction abuse patterns before enough fraud labels exist. How would you build and evaluate an unsupervised anomaly-detection component?",
    topics: ["anomaly-detection", "fraud-detection", "unsupervised-learning"],
    subtopics: ["isolation-forest", "autoencoder", "human-review"],
    source: SOURCES.jpmorgan,
    points: [
      "Defines useful behavioral and peer-relative features before selecting a model",
      "Compares practical methods such as isolation forests, clustering, or autoencoders",
      "Recognizes that anomalies are not automatically fraud",
      "Evaluates using analyst review, later labels, precision at capacity, and stability",
      "Combines anomaly scores with supervised models or rules and monitors drift",
    ],
  },
  {
    id: "aiml-fintech-med-012",
    title: "Probability calibration",
    question:
      "A default-risk classifier ranks customers well, but among applicants assigned a 20% risk score only 8% actually default. Why does this matter, and how would you diagnose and correct it?",
    topics: ["calibration", "credit-risk", "model-evaluation"],
    subtopics: ["reliability-curve", "brier-score", "isotonic-regression"],
    source: SOURCES.goldman,
    points: [
      "Explains the difference between discrimination or ranking and calibration",
      "Uses reliability diagrams and metrics such as Brier score or log loss",
      "Checks calibration by time and important customer segments",
      "Applies Platt scaling, isotonic regression, or recalibration on held-out data",
      "Connects calibrated probabilities to pricing, limits, provisions, or thresholds",
    ],
  },
  {
    id: "aiml-fintech-med-013",
    title: "XGBoost overfitting diagnosis",
    question:
      "An XGBoost transaction-risk model has excellent training AUC but substantially lower validation AUC. Explain how you would diagnose and reduce the overfitting.",
    topics: ["gradient-boosting", "overfitting", "model-tuning"],
    subtopics: ["learning-rate", "tree-depth", "early-stopping"],
    source: SOURCES.visa,
    points: [
      "Checks split correctness, leakage, duplicates, and temporal distribution shift first",
      "Uses learning curves and early stopping on an appropriate validation set",
      "Tunes depth, minimum child weight, learning rate, number of trees, and regularization",
      "Uses row and column subsampling where appropriate",
      "Evaluates with relevant imbalanced metrics rather than training AUC alone",
    ],
  },
  {
    id: "aiml-fintech-med-014",
    title: "Post-outcome feature leakage",
    question:
      "A loan-default model uses a feature called `days_past_due_30d` and achieves unusually high test performance. What questions would you ask to determine whether this is leakage?",
    topics: ["data-leakage", "credit-risk", "feature-engineering"],
    subtopics: ["prediction-time-availability", "point-in-time-data"],
    source: SOURCES.goldman,
    points: [
      "Defines the prediction timestamp and target observation window",
      "Checks whether the feature is created after the lending decision or default outcome",
      "Examines ETL timestamps and backfills for point-in-time correctness",
      "Rebuilds datasets using only information available at prediction time",
      "Re-evaluates using chronological splits after removing leaked signals",
    ],
  },
  {
    id: "aiml-fintech-med-015",
    title: "Missing transaction features",
    question:
      "A payment model receives merchant-category and device-risk features with missing values that are not missing at random. How would you investigate and handle them?",
    topics: ["missing-data", "data-quality", "feature-engineering"],
    subtopics: ["missingness-indicator", "imputation", "pipeline-monitoring"],
    source: SOURCES.visa,
    points: [
      "Measures missingness by source, time, segment, and outcome",
      "Investigates whether missingness itself carries risk or indicates an upstream incident",
      "Uses appropriate imputation plus missingness indicators rather than blind mean filling",
      "Fits transformations on training data only and handles unknown categories",
      "Monitors missing-rate drift and defines serving fallbacks",
    ],
  },
  {
    id: "aiml-fintech-med-016",
    title: "Logistic regression versus boosting",
    question:
      "For a first version of a loan-approval risk model, how would you decide between logistic regression and gradient-boosted trees?",
    topics: ["model-selection", "credit-risk", "supervised-learning"],
    subtopics: ["baseline", "interpretability", "nonlinearity"],
    source: SOURCES.jpmorgan,
    points: [
      "Starts with problem constraints, data size, feature types, and decision latency",
      "Explains logistic regression’s interpretability, calibration, and linear assumptions",
      "Explains boosting’s ability to model nonlinearities and interactions",
      "Compares models on temporal validation, calibration, fairness, stability, and business cost",
      "Considers governance and chooses the simplest model that meets requirements",
    ],
  },
  {
    id: "aiml-fintech-med-017",
    title: "Validation for market time series",
    question:
      "You are predicting next-day market volatility from historical prices and news features. Describe a validation setup that avoids look-ahead bias and gives a realistic estimate of deployment performance.",
    topics: ["time-series", "validation", "financial-ml"],
    subtopics: ["walk-forward-validation", "look-ahead-bias", "non-stationarity"],
    source: SOURCES.goldman,
    points: [
      "Orders all samples and feature computations by event availability time",
      "Uses expanding-window or rolling walk-forward validation",
      "Prevents overlapping target windows or uses a gap when needed",
      "Fits preprocessing and feature selection independently within each training fold",
      "Tests across multiple market regimes and includes realistic baselines",
    ],
  },
  {
    id: "aiml-fintech-med-018",
    title: "Sampling bias in experiments",
    question:
      "A fintech app’s control and treatment groups have noticeably different proportions of high-value customers before an experiment begins. How would you test and address this imbalance?",
    topics: ["experimentation", "statistics", "sampling-bias"],
    subtopics: ["randomization-check", "standardized-difference", "stratification"],
    source: SOURCES.visa,
    points: [
      "Checks assignment logic and pre-treatment covariate balance",
      "Uses distribution tests or standardized differences without relying on one p-value alone",
      "Considers stratified randomization, rerandomization, weighting, or covariate adjustment",
      "Avoids conditioning on post-treatment variables",
      "Documents the issue and runs sensitivity analysis before interpreting impact",
    ],
  },
  {
    id: "aiml-fintech-med-019",
    title: "Fairness in credit decisions",
    question:
      "A credit model has similar overall AUC across demographic groups but very different false-rejection rates. How would you investigate and mitigate the issue?",
    topics: ["responsible-ai", "credit-risk", "model-evaluation"],
    subtopics: ["fairness-metrics", "segment-analysis", "governance"],
    source: SOURCES.goldman,
    points: [
      "Explains why equal aggregate AUC does not imply equal decision outcomes",
      "Measures threshold-based error rates, calibration, and data quality by group",
      "Investigates representation, label, measurement, and proxy-feature bias",
      "Considers data, model, or threshold mitigations with legal and policy review",
      "Monitors utility and fairness after deployment without hiding trade-offs",
    ],
  },
  {
    id: "aiml-fintech-med-020",
    title: "Predicting customer churn",
    question:
      "Design a model to identify customers likely to stop using a digital-banking app in the next 30 days. Explain target construction, features, validation, and how the prediction would be used.",
    topics: ["churn-modeling", "classification", "product-ml"],
    subtopics: ["target-definition", "behavioral-features", "uplift"],
    source: SOURCES.visaGuide,
    points: [
      "Defines churn and observation or prediction windows without leakage",
      "Uses recency, frequency, product usage, failed transactions, and support interactions",
      "Uses temporal validation and appropriate imbalance metrics",
      "Separates churn propensity from whether an intervention can change behavior",
      "Defines campaign capacity, incremental impact, and monitoring metrics",
    ],
  },
  {
    id: "aiml-fintech-med-021",
    title: "Modeling transaction sequences",
    question:
      "Fraud often appears as a sequence of small test transactions followed by a large payment. How would you represent transaction history, and when would a sequence model be justified?",
    topics: ["sequence-modeling", "fraud-detection", "deep-learning"],
    subtopics: ["temporal-features", "rnn", "transformer"],
    source: SOURCES.jpmorgan,
    points: [
      "Begins with interpretable velocity, recency, amount-change, and pattern features",
      "Describes ordered event representations with time gaps and categorical embeddings",
      "Compares sequence models with simpler boosted-tree baselines",
      "Handles variable history, cold start, latency, and point-in-time correctness",
      "Justifies added complexity through temporal validation and measurable lift",
    ],
  },
  {
    id: "aiml-fintech-med-022",
    title: "Low-latency fraud scoring",
    question:
      "A fraud score must be produced inside a payment authorization path with a 100 ms p99 budget. Outline the ML-serving design and the main trade-offs.",
    topics: ["ml-system-design", "fraud-detection", "real-time-inference"],
    subtopics: ["latency", "feature-store", "fallback"],
    source: SOURCES.razorpayScale,
    points: [
      "Separates streaming feature computation, online feature storage, and model serving",
      "Budgets latency across feature lookup, inference, networking, and decision logic",
      "Uses precomputed or incrementally updated features where possible",
      "Defines timeouts, cached defaults, rules, or safe fallback behavior",
      "Monitors latency, freshness, model versions, decisions, and business outcomes",
    ],
  },
  {
    id: "aiml-fintech-med-023",
    title: "Shadow and canary model rollout",
    question:
      "You have a new fraud model with better offline PR-AUC. How would you deploy it safely before allowing it to block payments?",
    topics: ["model-deployment", "fraud-detection", "mlops"],
    subtopics: ["shadow-mode", "canary", "champion-challenger"],
    source: SOURCES.fraud,
    points: [
      "Runs the model in shadow mode on production traffic without affecting decisions",
      "Compares scores, latency, coverage, and eventual labels against the champion",
      "Uses a small canary or review-only segment before automatic blocking",
      "Defines guardrails for false declines, approval rate, fraud loss, and system health",
      "Supports versioning, rollback, audit logs, and gradual traffic expansion",
    ],
  },
  {
    id: "aiml-fintech-med-024",
    title: "Monitoring before labels arrive",
    question:
      "Ground-truth fraud labels arrive weeks late. Which signals would you monitor daily to detect that the production model may be failing?",
    topics: ["model-monitoring", "fraud-detection", "delayed-labels"],
    subtopics: ["proxy-metrics", "drift", "operational-monitoring"],
    source: SOURCES.fraud,
    points: [
      "Monitors input schema, missingness, freshness, and feature distributions",
      "Tracks score, decision, approval, challenge, and block-rate distributions",
      "Uses analyst outcomes, customer reports, or issuer responses as qualified proxies",
      "Slices monitoring by merchant, geography, channel, and model version",
      "Combines proxy alerts with matured-label performance when available",
    ],
  },
  {
    id: "aiml-fintech-med-025",
    title: "Debugging prediction skew",
    question:
      "The same transaction receives a score of 0.18 in an offline notebook and 0.71 from the production service. Describe a systematic debugging process.",
    topics: ["production-ml", "debugging", "reproducibility"],
    subtopics: ["feature-skew", "model-versioning", "preprocessing"],
    source: SOURCES.jpmorgan,
    points: [
      "Captures the exact request, event timestamp, online features, and model version",
      "Compares preprocessing, feature order, types, defaults, and transformations",
      "Checks point-in-time feature values, freshness, and dependency versions",
      "Replays the production artifact in a controlled environment",
      "Adds parity tests, schema contracts, and prediction logging to prevent recurrence",
    ],
  },
  {
    id: "aiml-fintech-med-026",
    title: "Retraining policy under drift",
    question:
      "Would you retrain a payment-risk model on a fixed schedule or only when drift is detected? Propose a practical policy and explain the trade-offs.",
    topics: ["mlops", "model-monitoring", "retraining"],
    subtopics: ["drift-trigger", "scheduled-training", "model-approval"],
    source: SOURCES.razorpayScale,
    points: [
      "Explains benefits and risks of both scheduled and trigger-based retraining",
      "Uses data freshness, label maturity, drift, and performance as retraining inputs",
      "Combines a regular cadence with exceptional triggers where appropriate",
      "Requires validation, comparison with champion, and approval before promotion",
      "Maintains reproducible data, feature, code, and model versions",
    ],
  },
  {
    id: "aiml-fintech-med-027",
    title: "Production recall collapse",
    question:
      "A newly deployed fraud model passes latency checks, but confirmed-fraud recall drops sharply while offline tests remain unchanged. What hypotheses would you investigate first?",
    topics: ["production-ml", "fraud-detection", "debugging"],
    subtopics: ["data-pipeline", "threshold", "population-shift"],
    source: SOURCES.visaGuide,
    points: [
      "Checks model artifact, threshold, routing, and feature-service versions",
      "Investigates missing, stale, reordered, or differently transformed features",
      "Compares production population and score distributions with validation data",
      "Checks label joining, feedback delay, and metric implementation",
      "Rolls back or uses a safe fallback while preserving evidence for root-cause analysis",
    ],
  },
  {
    id: "aiml-fintech-med-028",
    title: "Transaction data quality gates",
    question:
      "Before training a transaction-risk model, what automated data-quality checks would you place between ingestion and model training?",
    topics: ["data-quality", "ml-pipeline", "fraud-detection"],
    subtopics: ["schema-validation", "distribution-checks", "data-contracts"],
    source: SOURCES.paytm,
    points: [
      "Validates schema, types, ranges, required fields, and identifier uniqueness",
      "Checks volume, freshness, duplicates, missingness, and referential integrity",
      "Detects distribution changes and impossible relationships",
      "Checks label availability, maturity, leakage, and class balance",
      "Quarantines bad batches, records lineage, and blocks training on critical failures",
    ],
  },
  {
    id: "aiml-fintech-med-029",
    title: "Accuracy versus interpretability",
    question:
      "A neural model improves loan-default AUC from 0.82 to 0.835 over an interpretable model. What evidence would you require before accepting the additional complexity?",
    topics: ["model-selection", "explainability", "credit-risk"],
    subtopics: ["statistical-significance", "governance", "operational-cost"],
    source: SOURCES.goldman,
    points: [
      "Tests whether the lift is stable and statistically or practically meaningful",
      "Evaluates calibration, threshold utility, fairness, and segment performance",
      "Accounts for latency, reliability, maintenance, and monitoring costs",
      "Assesses explanation, audit, compliance, and adverse-action requirements",
      "Keeps the simpler model unless incremental business value justifies the risk",
    ],
  },
  {
    id: "aiml-fintech-med-030",
    title: "Financial document embeddings",
    question:
      "You must retrieve relevant clauses from long financial-policy documents. How would you choose and evaluate an embedding and chunking strategy?",
    topics: ["nlp", "embeddings", "information-retrieval"],
    subtopics: ["chunking", "retrieval-metrics", "domain-adaptation"],
    source: SOURCES.jpmorgan,
    points: [
      "Defines retrieval units based on headings, clauses, tables, and semantic boundaries",
      "Compares domain-capable embeddings using a labeled query-relevance set",
      "Uses retrieval metrics such as recall at k, MRR, or nDCG",
      "Considers metadata filters, hybrid lexical-vector retrieval, and reranking",
      "Tests versioning, latency, access control, and failure cases",
    ],
  },
  {
    id: "aiml-fintech-med-031",
    title: "Evaluating a compliance RAG assistant",
    question:
      "A banking assistant uses retrieval-augmented generation to answer compliance questions. Design an evaluation plan that catches unsupported or outdated answers.",
    topics: ["generative-ai", "rag", "model-evaluation"],
    subtopics: ["groundedness", "retrieval-quality", "safety"],
    source: SOURCES.jpmorgan,
    points: [
      "Builds a versioned expert-reviewed test set including unanswerable and adversarial queries",
      "Evaluates retrieval relevance and answer correctness separately",
      "Measures citation support, groundedness, completeness, and abstention quality",
      "Checks document freshness, permissions, prompt injection, and sensitive-data leakage",
      "Adds human review, monitoring, audit trails, and release gates",
    ],
  },
  {
    id: "aiml-fintech-med-032",
    title: "Classifying transaction descriptions",
    question:
      "Design an NLP model that maps noisy bank-transaction descriptions to categories such as groceries, travel, utilities, and transfers. How would you handle abbreviations and unseen merchants?",
    topics: ["nlp", "text-classification", "fintech"],
    subtopics: ["normalization", "embeddings", "unknown-class"],
    source: SOURCES.jpmorgan,
    points: [
      "Normalizes noise while preserving informative merchant and transaction tokens",
      "Establishes lexical or linear baselines before more complex embeddings",
      "Uses merchant dictionaries, character features, or subword representations for abbreviations",
      "Supports confidence thresholds and unknown or fallback categories",
      "Evaluates macro metrics, confusion pairs, new merchants, and temporal drift",
    ],
  },
  {
    id: "aiml-fintech-med-033",
    title: "Forecasting payment volume",
    question:
      "A payments platform must forecast hourly transaction volume for capacity planning. How would you model holidays, promotions, trend changes, and prediction uncertainty?",
    topics: ["forecasting", "time-series", "capacity-planning"],
    subtopics: ["seasonality", "backtesting", "prediction-interval"],
    source: SOURCES.razorpayScale,
    points: [
      "Uses multiple seasonalities, calendar events, promotions, and relevant external features",
      "Creates naive seasonal baselines before advanced models",
      "Uses rolling-origin backtesting without future information",
      "Produces calibrated prediction intervals rather than only point forecasts",
      "Monitors error by horizon and retrains or adapts after structural breaks",
    ],
  },
  {
    id: "aiml-fintech-med-034",
    title: "Defending a project model choice",
    question:
      "Choose one ML project you have built. Explain why you selected that model, what baseline you compared against, and what evidence would make you replace your original choice.",
    topics: ["project-deep-dive", "model-selection", "experimentation"],
    subtopics: ["baseline", "tradeoffs", "iteration"],
    source: SOURCES.razorpay,
    points: [
      "Frames the problem, target, constraints, and success metrics clearly",
      "Explains model choice using data and operational constraints rather than popularity",
      "Provides a meaningful baseline and controlled comparison",
      "Discusses errors, limitations, and alternative approaches",
      "Defines evidence or production outcomes that would trigger a different model",
    ],
  },
  {
    id: "aiml-fintech-med-035",
    title: "Experimenting with a risk intervention",
    question:
      "A model recommends step-up verification for medium-risk payments. How would you run an experiment to measure whether the intervention reduces fraud without harming good customers?",
    topics: ["experimentation", "fraud-detection", "causal-inference"],
    subtopics: ["randomization", "guardrails", "delayed-outcomes"],
    source: SOURCES.visaGuide,
    points: [
      "Defines treatment eligibility and randomization before observing outcomes",
      "Chooses fraud loss or chargebacks plus conversion and customer-friction guardrails",
      "Accounts for delayed fraud labels and sufficient experiment duration",
      "Checks interference, compliance, sample size, and heterogeneous segment effects",
      "Uses intention-to-treat analysis and a clear rollout decision rule",
    ],
  },
];

const mcqs = [
  {
    id: "aiml-fintech-med-mcq-001",
    title: "Metric for rare fraud",
    question:
      "Fraud represents 0.2% of transactions. Which metric is generally most informative for comparing classifiers when the positive class matters?",
    topics: ["model-evaluation", "imbalanced-data"],
    subtopics: ["pr-auc"],
    source: SOURCES.visaGuide,
    options: [
      ["A", "Overall accuracy"],
      ["B", "PR-AUC"],
      ["C", "Mean squared error"],
      ["D", "Adjusted R-squared"],
    ],
    answer: "B",
    explanation:
      "PR-AUC emphasizes precision and recall for the rare positive class and is usually more informative than accuracy in heavily imbalanced fraud data.",
  },
  {
    id: "aiml-fintech-med-mcq-002",
    title: "Correct temporal validation",
    question:
      "Which validation approach best estimates performance for a model that predicts next week’s transaction fraud from historical data?",
    topics: ["validation", "fraud-detection"],
    subtopics: ["temporal-split"],
    source: SOURCES.goldman,
    options: [
      ["A", "Randomly split individual transactions into folds"],
      ["B", "Train on newer data and test on older data"],
      ["C", "Train on earlier periods and test on later unseen periods"],
      ["D", "Evaluate only on the training set"],
    ],
    answer: "C",
    explanation:
      "Chronological validation reflects deployment and reduces leakage from future behavior into training.",
  },
  {
    id: "aiml-fintech-med-mcq-003",
    title: "Regularization for sparse features",
    question:
      "A logistic-regression model has thousands of correlated transaction features. Which regularization is most likely to drive some coefficients exactly to zero?",
    topics: ["regularization", "linear-models"],
    subtopics: ["l1"],
    source: SOURCES.jpmorgan,
    options: [
      ["A", "L1 regularization"],
      ["B", "L2 regularization"],
      ["C", "Early stopping only"],
      ["D", "Batch normalization"],
    ],
    answer: "A",
    explanation:
      "L1 adds an absolute-value penalty and can produce sparse solutions with coefficients equal to zero.",
  },
  {
    id: "aiml-fintech-med-mcq-004",
    title: "Meaning of calibration",
    question:
      "A well-calibrated credit-risk model assigns a score of 0.3 to a group of comparable applicants. What should approximately happen?",
    topics: ["calibration", "credit-risk"],
    subtopics: ["reliability"],
    source: SOURCES.goldman,
    options: [
      ["A", "About 30% of that group should exhibit the target outcome"],
      ["B", "The model should classify every applicant as positive"],
      ["C", "The group’s ROC-AUC must equal 0.3"],
      ["D", "Exactly 30 applicants must be present"],
    ],
    answer: "A",
    explanation:
      "Calibration means predicted probabilities align with observed frequencies among similarly scored examples.",
  },
  {
    id: "aiml-fintech-med-mcq-005",
    title: "Safe use of SMOTE",
    question:
      "Where should SMOTE be applied when evaluating a fraud classifier with cross-validation?",
    topics: ["imbalanced-data", "validation"],
    subtopics: ["smote", "leakage"],
    source: SOURCES.visaGuide,
    options: [
      ["A", "To the entire dataset before splitting"],
      ["B", "Only within each training fold"],
      ["C", "Only to the validation fold"],
      ["D", "After predictions are generated"],
    ],
    answer: "B",
    explanation:
      "Resampling must occur only inside each training fold; applying it before splitting leaks synthetic information into validation.",
  },
  {
    id: "aiml-fintech-med-mcq-006",
    title: "Detecting label leakage",
    question:
      "Which feature is most likely to leak the target when predicting whether a transaction will result in a chargeback?",
    topics: ["data-leakage", "fraud-detection"],
    subtopics: ["prediction-time-availability"],
    source: SOURCES.fraud,
    options: [
      ["A", "Transaction amount at authorization time"],
      ["B", "Merchant category known at authorization time"],
      ["C", "Chargeback case status recorded 45 days later"],
      ["D", "Number of prior transactions before authorization"],
    ],
    answer: "C",
    explanation:
      "A status recorded after the prediction event contains direct information about the future target.",
  },
  {
    id: "aiml-fintech-med-mcq-007",
    title: "Concept drift signal",
    question:
      "Which situation best describes concept drift in a payment-fraud model?",
    topics: ["model-monitoring", "fraud-detection"],
    subtopics: ["concept-drift"],
    source: SOURCES.fraud,
    options: [
      ["A", "The CSV column order changes"],
      ["B", "The relationship between transaction features and fraud changes over time"],
      ["C", "Training takes longer on a larger machine"],
      ["D", "A feature has the same distribution every day"],
    ],
    answer: "B",
    explanation:
      "Concept drift occurs when the relationship between inputs and the target changes, such as fraudsters adopting new tactics.",
  },
  {
    id: "aiml-fintech-med-mcq-008",
    title: "False-decline trade-off",
    question:
      "If a fraud model’s threshold is increased from 0.5 to 0.8 before blocking a transaction, what is the most likely immediate effect?",
    topics: ["thresholding", "fraud-detection"],
    subtopics: ["precision-recall"],
    source: SOURCES.visaGuide,
    options: [
      ["A", "More transactions are blocked and recall always rises"],
      ["B", "Fewer transactions are blocked, often increasing precision and reducing recall"],
      ["C", "Calibration automatically becomes perfect"],
      ["D", "Class imbalance disappears"],
    ],
    answer: "B",
    explanation:
      "A higher positive threshold usually produces fewer positive decisions, which often raises precision while lowering recall.",
  },
  {
    id: "aiml-fintech-med-mcq-009",
    title: "Purpose of a feature store",
    question:
      "What is the strongest reason to use shared feature definitions for offline training and online fraud scoring?",
    topics: ["feature-store", "production-ml"],
    subtopics: ["training-serving-skew"],
    source: SOURCES.razorpayScale,
    options: [
      ["A", "It guarantees every model is unbiased"],
      ["B", "It reduces training-serving inconsistencies"],
      ["C", "It eliminates the need for monitoring"],
      ["D", "It makes all features categorical"],
    ],
    answer: "B",
    explanation:
      "Shared definitions and consistent computation reduce skew between historical training values and production values.",
  },
  {
    id: "aiml-fintech-med-mcq-010",
    title: "XGBoost learning rate",
    question:
      "What is the usual effect of lowering the learning rate in gradient boosting while allowing more trees?",
    topics: ["gradient-boosting", "model-tuning"],
    subtopics: ["learning-rate"],
    source: SOURCES.visa,
    options: [
      ["A", "Each tree contributes a smaller correction, often requiring more trees"],
      ["B", "The model becomes an unsupervised algorithm"],
      ["C", "All tree depths become one automatically"],
      ["D", "The target no longer needs labels"],
    ],
    answer: "A",
    explanation:
      "The learning rate shrinks each tree’s contribution; smaller values commonly require more boosting rounds and careful early stopping.",
  },
  {
    id: "aiml-fintech-med-mcq-011",
    title: "Threshold under review capacity",
    question:
      "A fraud-operations team can manually review only 1,000 transactions daily. Which evaluation measure most directly reflects this constraint?",
    topics: ["model-evaluation", "fraud-detection"],
    subtopics: ["precision-at-k"],
    source: SOURCES.visaGuide,
    options: [
      ["A", "Precision among the top 1,000 scored transactions"],
      ["B", "Training accuracy"],
      ["C", "Number of model parameters"],
      ["D", "Mean feature value"],
    ],
    answer: "A",
    explanation:
      "Precision at the available review capacity measures how many investigated cases are truly useful under the operational limit.",
  },
  {
    id: "aiml-fintech-med-mcq-012",
    title: "Population Stability Index",
    question:
      "What is Population Stability Index commonly used to monitor in a deployed risk model?",
    topics: ["model-monitoring", "drift"],
    subtopics: ["psi"],
    source: SOURCES.fraud,
    options: [
      ["A", "Changes in a feature or score distribution between populations"],
      ["B", "The exact causal effect of the model"],
      ["C", "GPU memory utilization only"],
      ["D", "Whether labels are perfectly correct"],
    ],
    answer: "A",
    explanation:
      "PSI is a distribution-shift indicator; it does not by itself prove a performance or causal change.",
  },
  {
    id: "aiml-fintech-med-mcq-013",
    title: "Shadow deployment",
    question:
      "What happens when a candidate fraud model is deployed in shadow mode?",
    topics: ["model-deployment", "mlops"],
    subtopics: ["shadow-mode"],
    source: SOURCES.fraud,
    options: [
      ["A", "It scores live traffic but does not control the production decision"],
      ["B", "It immediately replaces the production model for all users"],
      ["C", "It trains only on synthetic data"],
      ["D", "It runs without logging predictions"],
    ],
    answer: "A",
    explanation:
      "Shadow mode observes live inputs and records candidate predictions without affecting customer-facing decisions.",
  },
  {
    id: "aiml-fintech-med-mcq-014",
    title: "Local model explanation",
    question:
      "Which method is commonly used to estimate feature contributions for an individual tree-model prediction?",
    topics: ["explainability", "model-governance"],
    subtopics: ["shap"],
    source: SOURCES.goldman,
    options: [
      ["A", "SHAP"],
      ["B", "K-means inertia"],
      ["C", "Teacher forcing"],
      ["D", "BLEU score"],
    ],
    answer: "A",
    explanation:
      "SHAP is commonly used for local and global feature-attribution analysis, though explanations still require validation and governance.",
  },
  {
    id: "aiml-fintech-med-mcq-015",
    title: "Handling unresolved labels",
    question:
      "When chargebacks take 60 days to mature, how should a transaction from yesterday with no chargeback currently be labeled for supervised training?",
    topics: ["labeling", "fraud-detection"],
    subtopics: ["delayed-labels"],
    source: SOURCES.fraud,
    options: [
      ["A", "Definitely legitimate"],
      ["B", "Definitely fraudulent"],
      ["C", "Unresolved and excluded or handled separately until maturity"],
      ["D", "Randomly assigned a label"],
    ],
    answer: "C",
    explanation:
      "Absence of a chargeback before the maturity window does not establish a legitimate outcome; treating it as negative introduces label bias.",
  },
];

const companyTagsFor = (index) =>
  Array.from({ length: 4 }, (_, offset) => FINTECH_COMPANIES[(index * 4 + offset) % FINTECH_COMPANIES.length]);

const rubricFor = (points) =>
  points.map((text, index) => ({
    text,
    category: ["problemFraming", "technicalReasoning", "tradeoffs", "evaluation", "productionReadiness"][index] || "coverage",
    importance: index < 3 ? "mustHave" : "goodToHave",
    expectedAnswerMode: "conceptual",
  }));

const csvEscape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
const writeCsv = async (fileName, columns, rows) => {
  const text = [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\n");
  await fs.writeFile(path.join(outputDir, fileName), `${text}\n`, "utf8");
};

await fs.mkdir(outputDir, { recursive: true });

await writeCsv(
  "ai-ml-fintech-medium-rubric-35.csv",
  [
    "questionId",
    "title",
    "question",
    "companyTags",
    "topics",
    "subtopics",
    "url",
    "rubric",
    "source",
    "verified",
    "qualityScore",
  ],
  descriptive.map((item, index) => ({
    questionId: item.id,
    title: item.title,
    question: item.question,
    companyTags: companyTagsFor(index).join("|"),
    topics: item.topics.join("|"),
    subtopics: item.subtopics.join("|"),
    url: item.source,
    rubric: JSON.stringify(rubricFor(item.points)),
    source: "public_interview_pattern_curated",
    verified: "false",
    qualityScore: "0.9",
  }))
);

await writeCsv(
  "ai-ml-fintech-medium-mcq-15.csv",
  [
    "questionId",
    "title",
    "question",
    "companyTags",
    "topics",
    "subtopics",
    "url",
    "optionA",
    "optionB",
    "optionC",
    "optionD",
    "correctOptionId",
    "explanation",
    "source",
    "verified",
    "qualityScore",
  ],
  mcqs.map((item, index) => {
    const options = Object.fromEntries(item.options.map(([id, text]) => [`option${id}`, text]));
    return {
      questionId: item.id,
      title: item.title,
      question: item.question,
      companyTags: companyTagsFor(descriptive.length + index).join("|"),
      topics: item.topics.join("|"),
      subtopics: item.subtopics.join("|"),
      url: item.source,
      ...options,
      correctOptionId: item.answer,
      explanation: item.explanation,
      source: "public_interview_pattern_curated",
      verified: "false",
      qualityScore: "0.9",
    };
  })
);

console.log(
  JSON.stringify({
    outputDir,
    files: [
      { name: "ai-ml-fintech-medium-rubric-35.csv", rows: descriptive.length },
      { name: "ai-ml-fintech-medium-mcq-15.csv", rows: mcqs.length },
    ],
    fintechCompaniesCovered: new Set(
      Array.from({ length: descriptive.length + mcqs.length }, (_, index) => companyTagsFor(index)).flat()
    ).size,
  })
);
