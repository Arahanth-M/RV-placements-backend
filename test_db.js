import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function test() {
  try {
    console.log('Connecting to:', process.env.MONGO_URI);
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    
    const collections = await db.listCollections().toArray();
    console.log('Collections:', collections.map(c => c.name));
    
    const usersCollection = db.collection('users_2026');
    const sample = await usersCollection.findOne();
    
    if (sample) {
      console.log('Sample keys:', Object.keys(sample));
      console.log('Sample data:', JSON.stringify(sample, null, 2));
    } else {
      console.log('No data found in users_2026');
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

test();
