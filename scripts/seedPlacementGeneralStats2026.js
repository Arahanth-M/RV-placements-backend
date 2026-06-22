/**
 * One-time seed for 2026 general stats from the verified static snapshot.
 * Run from RV-placements-backend: node scripts/seedPlacementGeneralStats2026.js
 */
import "../config/mongoCollections.js";
import { connectDB } from "../config/db.js";
import { config } from "../config/constants.js";
import PlacementGeneralStats from "../models/PlacementGeneralStats.js";
import { statsDocumentFromPayload } from "../services/placementGeneralStatsImportService.js";

const STATS_2026 = {
  year: 2026,
  totalOffers: 850,
  kpis: {
    totalOffers: 850,
    companiesRecruited: 189,
    highestCtc: { value: "₹67L", note: "Arcesium & Confluent" },
    averageCtc: { value: "₹15.6L", note: "Median ₹12L" },
    ppoOffers: { value: 94, note: "11.1% of total offers" },
    campusPlacements: { value: 756, note: "88.9% of total offers" },
    offersAbove30L: { value: 54, note: "6.4% of total offers" },
  },
  byDepartment: [
    { department: "CSE", offers: 208, students: 220, placementPct: 94.5 },
    { department: "ECE", offers: 124, students: 132, placementPct: 93.9 },
    { department: "ISE", offers: 78, students: 84, placementPct: 92.9 },
    { department: "ME", offers: 71, students: 82, placementPct: 86.6 },
    { department: "CS-DS", offers: 54, students: 58, placementPct: 93.1 },
    { department: "AI/ML", offers: 54, students: 58, placementPct: 93.1 },
    { department: "CS-CYB", offers: 51, students: 56, placementPct: 91.1 },
    { department: "IEM", offers: 41, students: 48, placementPct: 85.4 },
    { department: "ETE", offers: 37, students: 44, placementPct: 84.1 },
    { department: "Civil", offers: 32, students: 40, placementPct: 80 },
    { department: "EEE", offers: 28, students: 36, placementPct: 77.8 },
    { department: "EIE", offers: 25, students: 34, placementPct: 73.5 },
    { department: "ASE", offers: 21, students: 30, placementPct: 70 },
    { department: "BT", offers: 13, students: 36, placementPct: 36.1 },
    { department: "CH", offers: 13, students: 18, placementPct: 72.2 },
  ],
  ctcDistribution: [
    { range: "< ₹10L", offers: 216, color: "#B5D4F4" },
    { range: "₹10–20L", offers: 427, color: "#378ADD" },
    { range: "₹20–30L", offers: 153, color: "#185FA5" },
    { range: "₹30–50L", offers: 38, color: "#BA7517" },
    { range: "> ₹50L", offers: 16, color: "#534AB7" },
  ],
  ctcByDepartment: [
    { department: "CSE", "< ₹10L": 18, "₹10–20L": 92, "₹20–30L": 58, "₹30–50L": 28, "> ₹50L": 12, total: 208 },
    { department: "ECE", "< ₹10L": 28, "₹10–20L": 58, "₹20–30L": 28, "₹30–50L": 8, "> ₹50L": 2, total: 124 },
    { department: "ISE", "< ₹10L": 12, "₹10–20L": 38, "₹20–30L": 22, "₹30–50L": 5, "> ₹50L": 1, total: 78 },
    { department: "ME", "< ₹10L": 22, "₹10–20L": 35, "₹20–30L": 11, "₹30–50L": 3, "> ₹50L": 0, total: 71 },
    { department: "CS-DS", "< ₹10L": 4, "₹10–20L": 22, "₹20–30L": 20, "₹30–50L": 6, "> ₹50L": 2, total: 54 },
    { department: "AI/ML", "< ₹10L": 5, "₹10–20L": 20, "₹20–30L": 22, "₹30–50L": 5, "> ₹50L": 2, total: 54 },
    { department: "CS-CYB", "< ₹10L": 6, "₹10–20L": 24, "₹20–30L": 16, "₹30–50L": 4, "> ₹50L": 1, total: 51 },
    { department: "IEM", "< ₹10L": 14, "₹10–20L": 20, "₹20–30L": 6, "₹30–50L": 1, "> ₹50L": 0, total: 41 },
    { department: "ETE", "< ₹10L": 10, "₹10–20L": 18, "₹20–30L": 7, "₹30–50L": 2, "> ₹50L": 0, total: 37 },
    { department: "Civil", "< ₹10L": 18, "₹10–20L": 11, "₹20–30L": 3, "₹30–50L": 0, "> ₹50L": 0, total: 32 },
    { department: "EEE", "< ₹10L": 12, "₹10–20L": 12, "₹20–30L": 3, "₹30–50L": 1, "> ₹50L": 0, total: 28 },
    { department: "EIE", "< ₹10L": 11, "₹10–20L": 10, "₹20–30L": 3, "₹30–50L": 1, "> ₹50L": 0, total: 25 },
    { department: "ASE", "< ₹10L": 10, "₹10–20L": 9, "₹20–30L": 2, "₹30–50L": 0, "> ₹50L": 0, total: 21 },
    { department: "BT", "< ₹10L": 8, "₹10–20L": 4, "₹20–30L": 1, "₹30–50L": 0, "> ₹50L": 0, total: 13 },
    { department: "CH", "< ₹10L": 8, "₹10–20L": 4, "₹20–30L": 1, "₹30–50L": 0, "> ₹50L": 0, total: 13 },
  ],
  topCompanies: [
    { company: "Oracle / OFSS", offers: 36 },
    { company: "Boeing", offers: 22 },
    { company: "Honeywell", offers: 22 },
    { company: "Deutsche Bank", offers: 18 },
    { company: "SAP", offers: 18 },
    { company: "Qualcomm", offers: 17 },
    { company: "HSBC", offers: 16 },
    { company: "Bitgo", offers: 15 },
    { company: "Societe Generale", offers: 14 },
    { company: "Baxter", offers: 13 },
    { company: "Genpact", offers: 13 },
    { company: "HPE", offers: 13 },
  ],
  monthlyTimeline: [
    { month: "May–Aug (PPO)", chartLabel: "PPO", offers: 94, companies: 20, variant: "ppo" },
    { month: "Aug", chartLabel: "Aug", offers: 78, companies: 11, variant: "default" },
    { month: "Sept", chartLabel: "Sept", offers: 262, companies: 52, variant: "default" },
    { month: "Oct", chartLabel: "Oct", offers: 79, companies: 18, variant: "default" },
    { month: "Nov", chartLabel: "Nov", offers: 77, companies: 17, variant: "default" },
    { month: "Nov–Dec", chartLabel: "Nov–Dec", offers: 14, companies: 7, variant: "default" },
    { month: "Dec", chartLabel: "Dec", offers: 94, companies: 27, variant: "default" },
    { month: "Jan", chartLabel: "Jan", offers: 67, companies: 22, variant: "default" },
    { month: "Feb", chartLabel: "Feb", offers: 41, companies: 13, variant: "default" },
    { month: "Mar", chartLabel: "Mar", offers: 15, companies: 5, variant: "late" },
    { month: "Apr", chartLabel: "Apr", offers: 29, companies: 12, variant: "late" },
  ],
  departmentAvgCtc: [
    { department: "CSE", avgCtc: 21.6, offers: 208 },
    { department: "ISE", avgCtc: 18.4, offers: 78 },
    { department: "AI/ML", avgCtc: 17.7, offers: 54 },
    { department: "CS-CYB", avgCtc: 17.1, offers: 51 },
    { department: "CS-DS", avgCtc: 17.0, offers: 54 },
    { department: "ECE", avgCtc: 15.3, offers: 124 },
    { department: "ETE", avgCtc: 13.6, offers: 37 },
    { department: "EEE", avgCtc: 10.3, offers: 28 },
    { department: "EIE", avgCtc: 10.3, offers: 25 },
    { department: "IEM", avgCtc: 9.6, offers: 41 },
    { department: "ME", avgCtc: 9.3, offers: 71 },
    { department: "CH", avgCtc: 8.4, offers: 13 },
    { department: "BT", avgCtc: 8.2, offers: 13 },
    { department: "ASE", avgCtc: 8.1, offers: 21 },
    { department: "Civil", avgCtc: 6.8, offers: 32 },
  ],
};

async function main() {
  await connectDB(config.MONGO_URI);
  const doc = statsDocumentFromPayload(STATS_2026, "seed-script", "seed");
  const saved = await PlacementGeneralStats.findOneAndUpdate(
    { year: 2026 },
    { $set: doc },
    { upsert: true, new: true }
  );
  console.log(`Seeded placement general stats for ${saved.year} (${saved.totalOffers} offers).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
