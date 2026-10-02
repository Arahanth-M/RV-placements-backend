import mongoose from "mongoose";

const personSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, trim: true },
    name: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    /** Short reason for joining — set on join requests; shown to host. */
    note: { type: String, trim: true, maxlength: 400, default: "" },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const peerSessionSchema = new mongoose.Schema(
  {
    hostUserId: { type: String, required: true, trim: true, index: true },
    sessionType: {
      type: String,
      required: true,
      enum: ["mock_interview", "study_group", "doubt_clarification"],
      index: true,
    },
    topic: { type: String, required: true, trim: true, maxlength: 160 },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
    /** Shared video room — only returned to accepted participants during the slot window. */
    meetLink: { type: String, required: true, trim: true },
    /** Google Calendar event id when Meet was auto-created via Calendar API. */
    googleEventId: { type: String, trim: true, default: "" },
    slotStart: { type: Date, required: true, index: true },
    slotEnd: { type: Date, required: true },
    maxParticipants: { type: Number, required: true, min: 2, max: 8 },
    /** Host + accepted members (count against seats). */
    participants: { type: [personSchema], default: [] },
    /** Waiting for host approval — do not count against seats until accepted. */
    joinRequests: { type: [personSchema], default: [] },
    status: {
      type: String,
      enum: ["open", "full", "completed", "cancelled"],
      default: "open",
      index: true,
    },
    /** Short shareable code so others can find the session (e.g. PS7K2M). */
    inviteCode: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
      unique: true,
      index: true,
    },
    /** Optional metadata only — never used as a join filter. */
    collegeId: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

peerSessionSchema.index({ status: 1, slotStart: 1 });
peerSessionSchema.index({ "participants.userId": 1, slotStart: -1 });
peerSessionSchema.index({ "joinRequests.userId": 1, slotStart: -1 });

export default mongoose.models.PeerSession ||
  mongoose.model("PeerSession", peerSessionSchema, "peer_sessions");
