import dotenv from "dotenv";

dotenv.config();

function requiredTrimmedEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `Missing required environment variable ${name}. Add it to your .env file (see .env.example).`
    );
  }
  return v;
}

/** Physical MongoDB collection for the Student model — value comes only from env. */
export const mongoCollectionStudents = requiredTrimmedEnv(
  "MONGODB_STUDENTS_COLLECTION"
);

/** Physical MongoDB collection for the PlacementData model — value comes only from env. */
export const mongoCollectionPlacementData = requiredTrimmedEnv(
  "MONGODB_PLACEMENTDATAS_COLLECTION"
);
