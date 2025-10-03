import request from 'supertest';
import app from '../../server.js';
import Submission from '../../models/Submission.js';
import Company from '../../models/Company.js';
import User from '../../models/User.js';

describe('Submissions API Routes', () => {
  let testCompany;
  let testUser;

  beforeEach(async () => {
    // Create test company
    testCompany = new Company({
      name: 'Google Inc.',
      type: 'FTE',
      business_model: 'B2C',
      eligibility: 'CS/IT students',
      date_of_visit: '2024-01-15'
    });
    await testCompany.save();

    // Create test user
    testUser = new User({
      googleId: 'testGoogleId123',
      username: 'test_user',
      email: 'test@example.com'
    });
    await testUser.save();
  });

  describe('POST /api/submissions', () => {
    it('should create a new submission with authenticated user', async () => {
      const submissionData = {
        companyId: testCompany._id,
        type: 'onlineQuestions',
        content: JSON.stringify({
          question: 'Reverse a linked list',
          solution: 'Using two pointers'
        })
      };

      // Mock authentication middleware
      const response = await request(app)
        .post('/api/submissions')
        .send(submissionData)
        .set('Cookie', 'connect.sid=mock-session-id')
        .expect(201);

      expect(response.body.message).toBeDefined();
    });

    it('should reject submission without authentication', async () => {
      const submissionData = {
        companyId: testCompany._id,
        type: 'onlineQuestions',
        content: 'Test content'
      };

      await request(app)
        .post('/api/submissions')
        .send(submissionData)
        .expect(401);
    });

    it('should reject submission with missing required fields', async () => {
      const incompleteData = {
        companyId: testCompany._id,
        type: 'onlineQuestions'
        // missing content field
      };

      await request(app)
        .post('/api/submissions')
        .send(incompleteData)
        .expect(400);
    });

    it('should reject submission with invalid company ID', async () => {
      const submissionData = {
        companyId: 'invalid-id',
        type: 'onlineQuestions',
        content: 'Test content'
      };

      await request(app)
        .post('/api/submissions')
        .send(submissionData)
        .expect(400);
    });

    it('should reject submission with invalid type', async () => {
      const submissionData = {
        companyId: testCompany._id,
        type: 'invalidType',
        content: 'Test content'
      };

      await request(app)
        .post('/api/submissions')
        .send(submissionData)
        .expect(400);
    });
  });

  describe('Submission Types', () => {
    it('should accept onlineQuestions type', async () => {
      const submissionData = {
        companyId: testCompany._id,
        type: 'onlineQuestions',
        content: JSON.stringify({
          question: 'Find duplicate in array',
          solution: 'Use Set to track visited elements'
        })
      };

      const response = await request(app)
        .post('/api/submissions')
        .send(submissionData)
        .expect(201);

      expect(response.body.message).toContain('Submission received');
    });

    it('should accept interviewQuestions type', async () => {
      const submissionData = {
        companyId: testCompany._id,
        type: 'interviewQuestions',
        content: 'Describe your experience with React hooks'
      };

      const response = await request(app)
        .post('/api/submissions')
        .send(submissionData)
        .expect(201);

      expect(response.body.message).toContain('Submission received');
    });

    it('should accept interviewProcess type', async () => {
      const submissionData = {
        companyId: testCompany._id,
        type: 'interviewProcess',
        content: 'Technical round followed by HR round'
      };

      const response = await request(app)
        .post('/api/submissions')
        .send(submissionData)
        .expect(201);

      expect(response.body.message).toContain('Submission received');
    });
  });

  describe('Submission Content Validation', () => {
    it('should accept valid JSON content for onlineQuestions', async () => {
      const submissionData = {
        companyId: testCompany._id,
        type: 'onlineQuestions',
        content: JSON.stringify({
          question: 'Implement merge sort',
          solution: 'function mergeSort(arr) { /* implementation */ }'
        })
      };

      await request(app)
        .post('/api/submissions')
        .send(submissionData)
        .expect(201);
    });

    it('should accept string content for other types', async () => {
      const submissionData = {
        companyId: testCompany._id,
        type: 'interviewProcess',
        content: 'Technical interview was challenging but fair'
      };

      await request(app)
        .post('/api/submissions')
        .send(submissionData)
        .expect(201);
    });

    it('should reject empty content', async () => {
      const submissionData = {
        companyId: testCompany._id,
        type: 'interviewQuestions',
        content: ''
      };

      await request(app)
        .post('/api/submissions')
        .send(submissionData)
        .expect(400);
    });

    it('should reject content that is too long', async () => {
      const submissionData = {
        companyId: testCompany._id,
        type: 'interviewProcess',
        content: 'x'.repeat(10001) // Assuming max length is 10000
      };

      await request(app)
        .post('/api/submissions')
        .send(submissionData)
        .expect(400);
    });
  });

  describe('Database Integration', () => {
    it('should save submission to database with correct user info', async () => {
      const submissionData = {
        companyId: testCompany._id,
        type: 'onlineQuestions',
        content: 'Test content'
      };

      // Mock the authenticated user
      const mockReq = {
        user: testUser,
        body: submissionData
      };

      // Create submission directly
      const newSubmission = new Submission({
        ...submissionData,
        submittedBy: {
          name: testUser.username,
          email: testUser.email
        }
      });

      const savedSubmission = await newSubmission.save();

      expect(savedSubmission.submittedBy.name).toBe(testUser.username);
      expect(savedSubmission.submittedBy.email).toBe(testUser.email);
      expect(savedSubmission.companyId.toString()).toBe(testCompany._id.toString());
      expect(savedSubmission.type).toBe('onlineQuestions');
    });

    it('should populate company information in submission', async () => {
      const submissionData = {
        companyId: testCompany._id,
        type: 'onlineQuestions',
        content: 'Test content',
        submittedBy: {
          name: testUser.username,
          email: testUser.email
        }
      };

      const submission = new Submission(submissionData);
      await submission.save();

      const populatedSubmission = await Submission
        .findById(submission._id)
        .populate('companyId');

      expect(populatedSubmission.companyId.name).toBe(testCompany.name);
    });
  });
});
