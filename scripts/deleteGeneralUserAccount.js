/**
 * Ops script: fulfill a general-platform account deletion request.
 *
 * Usage:
 *   node scripts/deleteGeneralUserAccount.js --email=user@gmail.com --dry-run
 *   node scripts/deleteGeneralUserAccount.js --email=user@gmail.com
 *   node scripts/deleteGeneralUserAccount.js --userId=google-oauth-id
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { config } from "../config/constants.js";
import {
  ACCOUNT_DELETE_CHECKLIST,
  deleteGeneralUserAccount,
} from "../services/accountDeletionService.js";

dotenv.config();

function parseArgs(argv) {
  const out = { dryRun: false, email: "", userId: "" };
  for (const raw of argv) {
    const arg = String(raw || "");
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg.startsWith("--email=")) out.email = arg.slice("--email=".length);
    else if (arg.startsWith("--userId=")) out.userId = arg.slice("--userId=".length);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email && !args.userId) {
    console.error("Provide --email=... and/or --userId=...");
    console.error("Checklist:");
    for (const step of ACCOUNT_DELETE_CHECKLIST) console.error(` - ${step}`);
    process.exit(1);
  }

  await mongoose.connect(config.MONGO_URI);
  try {
    const result = await deleteGeneralUserAccount({
      email: args.email,
      userId: args.userId,
      dryRun: args.dryRun,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
