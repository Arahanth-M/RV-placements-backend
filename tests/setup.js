import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Use a test-specific MongoDB URI
const TEST_MONGO_URI = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/rv-placements-test';

beforeAll(async () => {
  // Connect to test database
  await mongoose.connect(TEST_MONGO_URI);
  
  console.log('🧪 Test database connected');
});

beforeEach(async () => {
  // Clear all collections before each test
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
});

afterAll(async () => {
  // Clean up
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  
  console.log('🧪 Test database disconnected');
});

// Global test timeout
// Jest timeout is configured in jest.config.js
