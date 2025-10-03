export default {
  // Test environment
  testEnvironment: 'node',
  
  // ES modules support
  
  // Module file extensions
  moduleFileExtensions: ['js', 'json'],
  
  // Test patterns
  testMatch: [
    '**/tests/**/*.test.js',
    '**/tests/**/*.spec.js'
  ],
  
  // Coverage configuration
  collectCoverageFrom: [
    'routes/**/*.js',
    'models/**/*.js',
    'services/**/*.js',
    'config/**/*.js',
    'utils/**/*.js',
    '!**/node_modules/**',
    '!**/tests/**'
  ],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  
  // Clear mocks automatically
  clearMocks: true,
  
  // Verbose output
  verbose: true,
  
  // Test timeout (in milliseconds)
  testTimeout: 30000,
  
  // Forces all tests to be run in sequence
  forceExit: true,
  
  // Detect open handles
  detectOpenHandles: true,
  
  // Global variables
  globals: {
    'process.env.NODE_ENV': 'test'
  }
};