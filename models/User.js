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
  createdAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model("User", userSchema);