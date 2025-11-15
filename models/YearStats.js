import mongoose from "mongoose";

// Flexible schema for year stats - allows dynamic fields
// This will work with any data structure in the 2024-stats and 2025-stats collections
const yearStatsSchema = new mongoose.Schema(
  {},
  { 
    strict: false, // Allow fields not defined in schema
    collection: null // Will be set dynamically based on year
  }
);

// Factory function to create models for different years
export const createYearStatsModel = (year) => {
  const collectionName = `${year}-stats`;
  return mongoose.models[collectionName] || mongoose.model(collectionName, yearStatsSchema, collectionName);
};

// Export models for 2024 and 2025
export const YearStats2024 = createYearStatsModel(2024);
export const YearStats2025 = createYearStatsModel(2025);

export default YearStats2024;

