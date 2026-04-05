import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function verify() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users_2026');
    
    // Get a sample user to test against
    const sample = await usersCollection.findOne();
    if (!sample) {
      console.log('No users found in users_2026');
      return;
    }
    
    const emailToTest = sample.emailId || sample.email;
    if (!emailToTest) {
      console.log('Sample user has no email field');
      return;
    }
    
    console.log('Testing with email:', emailToTest);
    
    // Test case 1: Exact match
    const match1 = await usersCollection.findOne({
      emailId: { $regex: new RegExp(`^${emailToTest}$`, "i") }
    });
    console.log('Exact match found:', !!match1);
    
    // Test case 2: Case-insensitive match
    const upperEmail = emailToTest.toUpperCase();
    const match2 = await usersCollection.findOne({
      emailId: { $regex: new RegExp(`^${upperEmail}$`, "i") }
    });
    console.log('Upper case match found:', !!match2);
    
    // Test case 3: Match from email field (if present)
    const match3 = await usersCollection.findOne({
      $or: [
        { emailId: { $regex: new RegExp(`^${emailToTest}$`, "i") } },
        { email: { $regex: new RegExp(`^${emailToTest}$`, "i") } }
      ]
    });
    console.log('OR match found:', !!match3);

  } catch (err) {
    console.error('Error during verification:', err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

verify();
