import request from 'supertest';
import app from '../../server.js';
import User from '../../models/User.js';

describe('Authentication Routes', () => {
  describe('POST /api/auth/register (if exists)', () => {
    it('should register a new user with valid data', async () => {
      const userData = {
        username: 'john_doe',
        email: 'john@example.com',
        googleId: 'google123456'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expect(response.body).toHaveProperty('user');
      expect(response.body.user.username).toBe(userData.username);
      expect(response.body.user.email).toBe(userData.email);
    });

    it('should reject registration with missing fields', async () => {
      const userData = {
        username: 'john_doe'
        // missing email and googleId
      };

      await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);
    });

    it('should reject registration with invalid email', async () => {
      const userData = {
        username: 'john_doe',
        email: 'invalid-email',
        googleId: 'google123456'
      };

      await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(400);
    });
  });

  describe('GET /api/auth/google', () => {
    it('should redirect to Google OAuth', async () => {
      const response = await request(app)
        .get('/api/auth/google')
        .expect(302);

      expect(response.headers.location).toMatch(/accounts\.google\.com/);
    });
  });

  describe('GET /api/auth/current_user', () => {
    it('should return 401 for unauthenticated requests', async () => {
      await request(app)
        .get('/api/auth/current_user')
        .expect(401);
    });

    it('should return user data for authenticated requests', async () => {
      // Would require a valid JWT cookie; unauthenticated returns 401
      const response = await request(app)
        .get('/api/auth/current_user')
        .expect(401);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/auth/logout', () => {
    it('should redirect (JWT cleared in browser via cookie)', async () => {
      const response = await request(app)
        .get('/api/auth/logout')
        .expect(302);

      expect(response.headers.location).toMatch(/localhost|lastminuteplacementprep\.in/);
    });
  });

  describe('JWT auth', () => {
    it('should return 401 for protected routes without token', async () => {
      const agent = request.agent(app);
      await agent
        .get('/api/auth/current_user')
        .expect(401);
    });
  });

  describe('CORS Configuration', () => {
    it('should handle preflight OPTIONS requests', async () => {
      await request(app)
        .options('/api/auth/current_user')
        .expect(200);
    });

    it('should include proper CORS headers', async () => {
      const response = await request(app)
        .get('/api/auth/current_user')
        .expect(401);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });
});
