import dotenv from "dotenv";
dotenv.config();

export default {
  googleClientID: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  mongoURI: process.env.MONGO_URI,
  sessionSecret: process.env.SESSION_SECRET || 'your-secret-key',
  bucketName: process.env.BUCKET_NAME
};  