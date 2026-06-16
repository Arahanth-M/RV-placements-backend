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
    { department: "CSE", offers: 208 },
    { department: "ECE", offers: 124 },
    { department: "ISE", offers: 78 },
    { department: "ME", offers: 71 },
    { department: "CS-DS", offers: 54 },
    { department: "AI/ML", offers: 54 },
    { department: "CS-CYB", offers: 51 },
    { department: "IEM", offers: 41 },
    { department: "ETE", offers: 37 },
    { department: "Civil", offers: 32 },
    { department: "EEE", offers: 28 },
    { department: "EIE", offers: 25 },
    { department: "ASE", offers: 21 },
    { department: "BT", offers: 13 },
    { department: "CH", offers: 13 },
  ],
  ctcDistribution: [
    { range: "< ₹10L", offers: 216, color: "#B5D4F4" },
    { range: "₹10–20L", offers: 427, color: "#378ADD" },
    { range: "₹20–30L", offers: 153, color: "#185FA5" },
    { range: "₹30–50L", offers: 38, color: "#BA7517" },
    { range: "> ₹50L", offers: 16, color: "#534AB7" },
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
    { month: "May–Aug (PPO)", chartLabel: "PPO", offers: 94, variant: "ppo" },
    { month: "Aug", chartLabel: "Aug", offers: 78, variant: "default" },
    { month: "Sept", chartLabel: "Sept", offers: 262, variant: "default" },
    { month: "Oct", chartLabel: "Oct", offers: 79, variant: "default" },
    { month: "Nov", chartLabel: "Nov", offers: 77, variant: "default" },
    { month: "Nov–Dec", chartLabel: "Nov–Dec", offers: 14, variant: "default" },
    { month: "Dec", chartLabel: "Dec", offers: 94, variant: "default" },
    { month: "Jan", chartLabel: "Jan", offers: 67, variant: "default" },
    { month: "Feb", chartLabel: "Feb", offers: 41, variant: "default" },
    { month: "Mar", chartLabel: "Mar", offers: 15, variant: "late" },
    { month: "Apr", chartLabel: "Apr", offers: 29, variant: "late" },
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
