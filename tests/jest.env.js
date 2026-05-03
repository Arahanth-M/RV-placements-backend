/**
 * Runs before any test modules load (Jest `setupFiles`).
 * Ensures required Mongo collection env vars exist for the application under test.
 * Actual collection names live here only for the test harness, not in app source.
 */
process.env.MONGODB_STUDENTS_COLLECTION ||= "students";
process.env.MONGODB_PLACEMENTDATAS_COLLECTION ||= "placementdatas";
