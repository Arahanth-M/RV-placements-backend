import mongoose from 'mongoose';
const { Schema } = mongoose;

const userSchema = new Schema({
  userId: { 
    type: String, 
    required: true, 
    unique: true  
  },
  username: String,
  email: { 
    type: String, 
    sparse: true  
  },
  isPremium: {
    type: Boolean,
    default: false
  },
  membershipType: {
    type: String,
  },
  picture: String,
  fillForm: {
    type: Boolean,
    default: false
  },
  points: {
    type: Number,
    default: 0
  },
  role: {
    type: String,
    enum: ["student", "admin", "company", "spc"],
    default: "student"
  },
  isBetaListed: {
    type: Boolean,
    default: false
  },
  hasSubmittedMissingCompanyRequest: {
    type: Boolean,
    default: false
  },
  lastActiveAt: {
    type: Date,
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

userSchema.index({ createdAt: 1 });
userSchema.index({ lastActiveAt: 1 });

export default mongoose.model("User", userSchema);