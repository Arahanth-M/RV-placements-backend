import mongoose from "mongoose";
import { PLACEMENT_HUB_CLUSTER_KEYS } from "../utils/placementCluster.js";
import {
  COMPANY_VISIT_DEFAULT_YEAR,
  PLACEMENT_OPEN_DREAM_SETTING_YEARS,
} from "../utils/placementYears.js";

const openDreamMinLpaByClusterShape = Object.fromEntries(
  PLACEMENT_HUB_CLUSTER_KEYS.map((key) => [
    key,
    { type: Number, min: 0, max: 200, default: 10 },
  ])
);

const clusterThresholdSchema = new mongoose.Schema(openDreamMinLpaByClusterShape, {
  _id: false,
});

function defaultClusterThresholdMap() {
  return Object.fromEntries(PLACEMENT_HUB_CLUSTER_KEYS.map((k) => [k, 10]));
}

const placementHubSettingsSchema = new mongoose.Schema(
  {
    /** Singleton row — only `default` is used. */
    settingsKey: {
      type: String,
      required: true,
      unique: true,
      default: "default",
      trim: true,
    },
    /**
     * Minimum LPA for Open dream vs Dream: year → cluster → LPA.
     * Keys are year strings (`"2026"`, `"2024"`, …).
     */
    openDreamMinLpaByYear: {
      type: Map,
      of: clusterThresholdSchema,
      default: () =>
        new Map(
          PLACEMENT_OPEN_DREAM_SETTING_YEARS.map((y) => [
            String(y),
            defaultClusterThresholdMap(),
          ])
        ),
    },
    /** @deprecated — migrated into {@link openDreamMinLpaByYear} on read */
    openDreamMinLpaByCluster: {
      type: clusterThresholdSchema,
      required: false,
    },
  },
  { timestamps: true }
);

export default mongoose.model("PlacementHubSettings", placementHubSettingsSchema);
