import {
  getOpenDreamMinRupeesForClusterSync,
  getOpenDreamMinLpaByYearSync,
  loadPlacementHubSettingsCache,
  updatePlacementHubOpenDreamThresholds,
} from "../../services/placementHubSettingsService.js";
import PlacementHubSettings from "../../models/PlacementHubSettings.js";

describe("placementHubSettingsService", () => {
  beforeEach(async () => {
    await PlacementHubSettings.deleteMany({});
    await loadPlacementHubSettingsCache();
  });

  it("defaults to 10 LPA per cluster and year when unset", () => {
    const byYear = getOpenDreamMinLpaByYearSync();
    expect(byYear["2026"].cs).toBe(10);
    expect(byYear["2024"].me).toBe(10);
    expect(getOpenDreamMinRupeesForClusterSync("me", 2026)).toBe(1_000_000);
  });

  it("persists year- and cluster-specific thresholds", async () => {
    await updatePlacementHubOpenDreamThresholds({
      2026: { cs: 10, me: 8 },
      2027: { cs: 12, me: 9 },
    });
    expect(getOpenDreamMinRupeesForClusterSync("cs", 2026)).toBe(1_000_000);
    expect(getOpenDreamMinRupeesForClusterSync("me", 2026)).toBe(800_000);
    expect(getOpenDreamMinRupeesForClusterSync("cs", 2027)).toBe(1_200_000);
    expect(getOpenDreamMinRupeesForClusterSync("me", 2027)).toBe(900_000);
    expect(getOpenDreamMinRupeesForClusterSync("ec", 2027)).toBe(1_000_000);
  });

  it("migrates legacy openDreamMinLpaByCluster to all years", async () => {
    await PlacementHubSettings.create({
      settingsKey: "default",
      openDreamMinLpaByCluster: { cs: 11, ec: 10, me: 7, chem: 10 },
    });
    await loadPlacementHubSettingsCache();
    expect(getOpenDreamMinRupeesForClusterSync("me", 2024)).toBe(700_000);
    expect(getOpenDreamMinRupeesForClusterSync("cs", 2028)).toBe(1_100_000);
  });
});
