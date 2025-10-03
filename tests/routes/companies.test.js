import request from 'supertest';
import app from '../../server.js';
import Company from '../../models/Company.js';
import User from '../../models/User.js';

describe('Company API Routes', () => {
  describe('GET /api/companies', () => {
    beforeEach(async () => {
      // Seed test companies
      await Company.insertMany([
        {
          name: 'Google Inc.',
          type: 'FTE',
          business_model: 'B2C',
          eligibility: 'CS/IT students',
          date_of_visit: '2024-01-15',
          count: 50
        },
        {
          name: 'Microsoft Corp',
          type: 'Internship',
          business_model: 'B2B',
          eligibility: 'All branches',
          date_of_visit: '2024-02-20',
          count: 30
        }
      ]);
    });

    it('should get all companies', async () => {
      const response = await request(app)
        .get('/api/companies')
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0]).toHaveProperty('name');
      expect(response.body[0]).toHaveProperty('type');
      expect(response.body[0]).toHaveProperty('business_model');
    });

    it('should get companies with pagination', async () => {
      const response = await request(app)
        .get('/api/companies?limit=1&offset=0')
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBeDefined();
    });

    it('should get companies with filtering', async () => {
      const response = await request(app)
        .get('/api/companies?type=FTE')
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].type).toBe('FTE');
    });
  });

  describe('GET /api/companies/search', () => {
    beforeEach(async () => {
      await Company.insertMany([
        { name: 'Google Inc.', type: 'FTE', business_model: 'B2C' },
        { name: 'Google Maps', type: 'Internship', business_model: 'B2B' },
        { name: 'Microsoft Corp', type: 'FTE', business_model: 'B2B' }
      ]);
    });

    it('should search companies by name', async () => {
      const response = await request(app)
        .get('/api/companies/search?q=google')
        .expect(200);

      expect(response.body.companies).toHaveLength(2);
      expect(response.body.companies.map(c => c.name)).toContain('Google Inc.');
      expect(response.body.companies.map(c => c.name)).toContain('Google Maps');
    });

    it('should search companies case-insensitively', async () => {
      const response = await request(app)
        .get('/api/companies/search?q=GOOGLE')
        .expect(200);

      expect(response.body.companies).toHaveLength(2);
    });

    it('should return empty array for non-matching search', async () => {
      const response = await request(app)
        .get('/api/companies/search?q=nonexistent')
        .expect(200);

      expect(response.body.companies).toHaveLength(0);
    });
  });

  describe('GET /api/companies/filter', () => {
    beforeEach(async () => {
      await Company.insertMany([
        { name: 'Google Inc.', type: 'FTE', business_model: 'B2C', count: 50 },
        { name: 'Microsoft Corp', type: 'Internship', business_model: 'B2B', count: 30 },
        { name: 'Amazon Inc', type: 'FTE', business_model: 'B2C', count: 75 }
      ]);
    });

    it('should filter companies by type', async () => {
      const response = await request(app)
        .get('/api/companies/filter?type=FTE')
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body.map(c => c.type)).toEqual(['FTE', 'FTE']);
    });

    it('should filter companies by business model', async () => {
      const response = await request(app)
        .get('/api/companies/filter?businessModel=B2C')
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body.map(c => c.business_model)).toEqual(['B2C', 'B2C']);
    });

    it('should filter companies by multiple criteria', async () => {
      const response = await request(app)
        .get('/api/companies/filter?type=FTE&businessModel=B2C')
        .expect(200);

      expect(response.body).toHaveLength(2);
    });

    it('should sort companies by count', async () => {
      const response = await request(app)
        .get('/api/companies/filter?sortBy=count&sortOrder=desc')
        .expect(200);

      expect(response.body[0].count).toBe(75); // Amazon
      expect(response.body[1].count).toBe(50); // Google
      expect(response.body[2].count).toBe(30); // Microsoft
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid pagination parameters', async () => {
      await request(app)
        .get('/api/companies?limit=invalid')
        .expect(400);
    });

    it('should handle non-existent route', async () => {
      await request(app)
        .get('/api/companies/nonexistent')
        .expect(404);
    });

    it('should handle invalid filter parameters', async () => {
      await request(app)
        .get('/api/companies/filter?invalidParam=value')
        .expect(400);
    });
  });
});
