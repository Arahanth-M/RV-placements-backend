import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../server.js';
import Submission from '../../models/Submission.js';
import User from '../../models/User.js';
import { buildJwtPayloadFromUser } from '../../utils/jwtUserClaims.js';
import { seedApprovedSplitCompany } from '../helpers/seedSplitCompany.js';
import CompanyVisit from '../../models/CompanyVisit.js';

/** Cookie header value for authJWT (same secret as tests/setup.js default). */
const authCookieForUser = (user) => {
  const secret = process.env.JWT_SECRET;
  const payload = buildJwtPayloadFromUser(user);
  const token = jwt.sign(payload, secret, { expiresIn: '1h' });
  return `token=${token}`;
};

describe('Submissions API Routes', () => {
  let testCompany;
  let testVisit;
  let testUser;

  beforeEach(async () => {
    const { staticRow, visit } = await seedApprovedSplitCompany({
      name: 'Google Inc.',
      type: 'FTE',
      business_model: 'B2C',
      eligibility: 'CS/IT students',
      date_of_visit: '2024-01-15',
    });
    testCompany = staticRow;
    testVisit = visit;

    testUser = new User({
      userId: 'testGoogleId123',
      username: 'test_user',
      email: 'test@example.com',
      isBetaListed: true,
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

      const response = await request(app)
        .post('/api/submissions')
        .send(submissionData)
        .set('Cookie', authCookieForUser(testUser))
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
      };

      await request(app)
        .post('/api/submissions')
        .send(incompleteData)
        .set('Cookie', authCookieForUser(testUser))
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
        .set('Cookie', authCookieForUser(testUser))
        .expect(500);
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
        .set('Cookie', authCookieForUser(testUser))
        .expect(500);
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
        .set('Cookie', authCookieForUser(testUser))
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
        .set('Cookie', authCookieForUser(testUser))
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
        .set('Cookie', authCookieForUser(testUser))
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
        .set('Cookie', authCookieForUser(testUser))
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
        .set('Cookie', authCookieForUser(testUser))
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
        .set('Cookie', authCookieForUser(testUser))
        .expect(400);
    });

    it('should accept long content (no max length in schema)', async () => {
      const submissionData = {
        companyId: testCompany._id,
        type: 'interviewProcess',
        content: 'x'.repeat(10001)
      };

      await request(app)
        .post('/api/submissions')
        .send(submissionData)
        .set('Cookie', authCookieForUser(testUser))
        .expect(201);
    });
  });

  describe('GET /api/submissions/mine', () => {
    it('should return only the authenticated user submissions with company names', async () => {
      await Submission.insertMany([
        {
          companyId: testCompany._id,
          type: 'mustDoTopics',
          content: 'Practice graphs and DP',
          submittedBy: {
            name: testUser.username,
            email: testUser.email,
          },
          submittedAt: new Date('2026-04-28T10:00:00.000Z'),
        },
        {
          companyId: testCompany._id,
          type: 'interviewProcess',
          content: 'OA, technical, HR',
          submittedBy: {
            name: testUser.username,
            email: testUser.email,
          },
          submittedAt: new Date('2026-04-29T10:00:00.000Z'),
        },
        {
          companyId: testCompany._id,
          type: 'onlineQuestions',
          content: 'Should not be returned',
          submittedBy: {
            name: 'other_user',
            email: 'other@example.com',
          },
          submittedAt: new Date('2026-04-30T10:00:00.000Z'),
        },
      ]);

      const response = await request(app)
        .get('/api/submissions/mine')
        .set('Cookie', authCookieForUser(testUser))
        .expect(200);

      expect(Array.isArray(response.body.submissions)).toBe(true);
      expect(response.body.submissions).toHaveLength(2);
      expect(response.body.submissions[0].type).toBe('interviewProcess');
      expect(response.body.submissions[0].companyName).toBe('Google Inc.');
      expect(response.body.submissions[1].type).toBe('mustDoTopics');
    });
  });

  describe('GET /api/submissions/since-last-login', () => {
    const authCookieWithPreviousLogin = (user, previousLastLoginAt) => {
      const secret = process.env.JWT_SECRET;
      const payload = buildJwtPayloadFromUser(user, { previousLastLoginAt });
      const token = jwt.sign(payload, secret, { expiresIn: '1h' });
      return `token=${token}`;
    };

    it('returns an empty digest when previousLastLoginAt is missing', async () => {
      const response = await request(app)
        .get('/api/submissions/since-last-login')
        .set('Cookie', authCookieForUser(testUser))
        .expect(200);

      expect(response.body.companies).toEqual([]);
      expect(response.body.since).toBeNull();
    });

    it('groups approved OA, interview questions, experiences, must-do, and recruitment since last login', async () => {
      const previousLogin = new Date('2026-08-20T10:00:00.000Z');

      await Submission.insertMany([
        {
          companyId: testCompany._id,
          type: 'onlineQuestions',
          content: 'OA 1',
          status: 'approved',
          approvedAt: new Date('2026-08-21T10:00:00.000Z'),
          submittedBy: { name: 'other', email: 'other@example.com' },
        },
        {
          companyId: testCompany._id,
          type: 'onlineQuestions',
          content: 'OA 2',
          status: 'approved',
          approvedAt: new Date('2026-08-21T11:00:00.000Z'),
          submittedBy: { name: 'other', email: 'other@example.com' },
        },
        {
          companyId: testCompany._id,
          type: 'interviewQuestions',
          content: 'IQ 1',
          status: 'approved',
          approvedAt: new Date('2026-08-21T12:00:00.000Z'),
          submittedBy: { name: 'other', email: 'other@example.com' },
        },
        {
          companyId: testCompany._id,
          type: 'interviewProcess',
          content: 'Experience',
          status: 'approved',
          approvedAt: new Date('2026-08-21T13:00:00.000Z'),
          submittedBy: { name: 'other', email: 'other@example.com' },
        },
        {
          companyId: testCompany._id,
          type: 'mustDoTopics',
          content: 'Graphs',
          status: 'approved',
          approvedAt: new Date('2026-08-21T13:30:00.000Z'),
          submittedBy: { name: 'other', email: 'other@example.com' },
        },
        {
          companyId: testCompany._id,
          type: 'onlineQuestions',
          content: 'Pending should be ignored',
          status: 'pending',
          submittedBy: { name: 'other', email: 'other@example.com' },
        },
        {
          companyId: testCompany._id,
          type: 'onlineQuestions',
          content: 'Too old',
          status: 'approved',
          approvedAt: new Date('2026-08-01T10:00:00.000Z'),
          submittedBy: { name: 'other', email: 'other@example.com' },
        },
        {
          companyId: testCompany._id,
          type: 'interviewQuestions',
          content: 'Own submission ignored',
          status: 'approved',
          approvedAt: new Date('2026-08-21T14:00:00.000Z'),
          submittedBy: { name: testUser.username, email: testUser.email },
        },
      ]);

      await CompanyVisit.updateOne(
        { _id: testVisit._id },
        {
          $set: {
            recruitment_process: {
              submittedAt: '2026-08-21T15:00:00.000Z',
              submittedBy: { name: 'other', email: 'other@example.com' },
            },
          },
        }
      );

      const response = await request(app)
        .get('/api/submissions/since-last-login')
        .set('Cookie', authCookieWithPreviousLogin(testUser, previousLogin.toISOString()))
        .expect(200);

      expect(response.body.companies).toHaveLength(1);
      expect(response.body.companies[0].companyName).toBe('Google Inc.');
      expect(response.body.companies[0].year).toBe(2026);
      expect(response.body.companies[0].onlineQuestions).toBe(2);
      expect(response.body.companies[0].interviewQuestions).toBe(1);
      expect(response.body.companies[0].interviewProcess).toBe(1);
      expect(response.body.companies[0].mustDoTopics).toBe(1);
      expect(response.body.companies[0].recruitmentProcess).toBe(1);
      expect(response.body.companies[0].summary).toBe(
        '2 OA questions, 1 interview question, 1 interview experience, 1 must-do topic, 1 recruitment process'
      );
    });

    it('uses the since query param when JWT previousLastLoginAt is missing', async () => {
      await Submission.insertMany([
        {
          companyId: testCompany._id,
          type: 'onlineQuestions',
          content: 'OA after visit',
          status: 'approved',
          approvedAt: new Date('2026-08-21T10:00:00.000Z'),
          submittedBy: { name: 'other', email: 'other@example.com' },
        },
        {
          companyId: testCompany._id,
          type: 'onlineQuestions',
          content: 'OA after visit 2',
          status: 'approved',
          approvedAt: new Date('2026-08-21T10:05:00.000Z'),
          submittedBy: { name: 'other', email: 'other@example.com' },
        },
      ]);

      const response = await request(app)
        .get('/api/submissions/since-last-login')
        .query({ since: '2026-08-20T10:00:00.000Z' })
        .set('Cookie', authCookieForUser(testUser))
        .expect(200);

      expect(response.body.companies).toHaveLength(1);
      expect(response.body.companies[0].onlineQuestions).toBe(2);
      expect(response.body.companies[0].year).toBe(2026);
      expect(response.body.companies[0].summary).toBe('2 OA questions');
    });
  });

  describe('Database Integration', () => {
    it('should save submission to database with correct user info', async () => {
      const submissionData = {
        companyId: testCompany._id,
        type: 'onlineQuestions',
        content: 'Test content'
      };

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

      expect(populatedSubmission.companyId.name).toBe('Google Inc.');
    });
  });
});
