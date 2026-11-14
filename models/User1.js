import mongoose from "mongoose";

const user1Schema = new mongoose.Schema(
  {
    googleId: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
    },
    username: {
      type: String,
      trim: true,
      default: "",
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
      unique: true,
    },
    profilePicture: {
      type: String,
      trim: true,
      default: "",
    },
    points: {
      type: Number,
      default: 0,
    },
    role: {
      type: String,
      enum: ["student", "spc"],
      default: "student",
    },
    /**
     * Placement hub this SPC may review/write (`cs` | `ec` | `me` | `chem`).
     * Unset on students and on SPCs not yet re-assigned in the cluster flow.
     */
    spcCluster: {
      type: String,
      enum: ["cs", "ec", "me", "chem"],
    },
    hasSubmittedMissingCompanyRequest: {
      type: Boolean,
      default: false,
    },
    /** Opt-in for email updates (Subscribe). In-app notifications go to everyone. */
    notificationsSubscribed: {
      type: Boolean,
      default: false,
    },
    /** DPDP: timestamp when the user accepted the current privacy notice. */
    privacyConsentAcceptedAt: {
      type: Date,
      default: null,
    },
    /** DPDP: notice version string accepted (must match config/privacyPolicy.js). */
    privacyPolicyVersion: {
      type: String,
      trim: true,
      default: "",
    },
    /**
     * DPDP feature-level consents (general platform), e.g.
     * { aiInterview: { acceptedAt, version }, billingCheckout: { acceptedAt, version } }
     */
    featureConsents: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastLoginAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: "users1",
  }
);

user1Schema.index({ email: 1 }, { unique: true });
user1Schema.index({ role: 1 });
user1Schema.index({ lastLoginAt: -1 });
user1Schema.index({ notificationsSubscribed: 1 });

export default mongoose.models.User1 || mongoose.model("User1", user1Schema);
