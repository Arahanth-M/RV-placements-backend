export const EVENT_TYPES = Object.freeze({
  COMPANY_APPROVED: "COMPANY_APPROVED",
  /** Fan-out in-app to all users; email only to subscribers. */
  COMPANY_UPDATED: "COMPANY_UPDATED",
  /** New placement event/announcement created by admin. */
  EVENT_CREATED: "EVENT_CREATED",
});
