import express from "express";
import authJWT from "../middleware/authJWT.js";
import validateRequest from "../middleware/validateRequest.js";
import {
  listDriveEntries,
  createDriveEntry,
  updateDriveEntry,
  deleteDriveEntry,
  toggleChecklistItem,
} from "../services/driveCalendarService.js";
import {
  driveCalendarCreateSchema,
  driveCalendarUpdateSchema,
  driveCalendarChecklistToggleSchema,
} from "../validations/driveCalendar.validation.js";

const router = express.Router();

function mapError(res, error) {
  const code = error?.code;
  const status = error?.status || 400;
  if (!code) return null;
  return res.status(status).json({ error: error.message, code });
}

router.use(authJWT);

router.get("/", async (req, res) => {
  try {
    const entries = await listDriveEntries({
      user: req.user,
      from: req.query?.from,
      to: req.query?.to,
    });
    return res.json({ success: true, entries });
  } catch (error) {
    if (mapError(res, error)) return undefined;
    console.error("[drive-calendar] list failed:", error?.message || error);
    return res.status(500).json({ error: "Failed to list drive calendar entries" });
  }
});

router.post("/", validateRequest(driveCalendarCreateSchema), async (req, res) => {
  try {
    const result = await createDriveEntry({ user: req.user, ...req.body });
    return res.status(201).json({
      success: true,
      entry: result.entry,
    });
  } catch (error) {
    if (mapError(res, error)) return undefined;
    console.error("[drive-calendar] create failed:", error?.message || error);
    return res.status(500).json({ error: "Failed to create entry" });
  }
});

router.patch("/:entryId", validateRequest(driveCalendarUpdateSchema), async (req, res) => {
  try {
    const result = await updateDriveEntry({
      user: req.user,
      entryId: req.params.entryId,
      ...req.body,
    });
    return res.json({
      success: true,
      entry: result.entry,
    });
  } catch (error) {
    if (mapError(res, error)) return undefined;
    console.error("[drive-calendar] update failed:", error?.message || error);
    return res.status(500).json({ error: "Failed to update entry" });
  }
});

router.post(
  "/:entryId/checklist/toggle",
  validateRequest(driveCalendarChecklistToggleSchema),
  async (req, res) => {
    try {
      const result = await toggleChecklistItem({
        user: req.user,
        entryId: req.params.entryId,
        itemId: req.body.itemId,
        done: req.body.done,
      });
      return res.json({ success: true, entry: result.entry });
    } catch (error) {
      if (mapError(res, error)) return undefined;
      console.error("[drive-calendar] checklist toggle failed:", error?.message || error);
      return res.status(500).json({ error: "Failed to update checklist" });
    }
  }
);

router.delete("/:entryId", async (req, res) => {
  try {
    const result = await deleteDriveEntry({
      user: req.user,
      entryId: req.params.entryId,
    });
    return res.json(result);
  } catch (error) {
    if (mapError(res, error)) return undefined;
    console.error("[drive-calendar] delete failed:", error?.message || error);
    return res.status(500).json({ error: "Failed to delete entry" });
  }
});

export default router;
