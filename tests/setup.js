import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Stable secret for JWT in tests (auth middleware must match sign/verify)
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-for-jest';
}

// Quiet per-request JWT debug lines during tests (set to "true" to exercise logs)
if (process.env.DEBUG_JWT_AUTH === undefined) {
  process.env.DEBUG_JWT_AUTH = '0';
}

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
