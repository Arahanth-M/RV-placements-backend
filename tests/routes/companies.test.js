import request from 'supertest';
import app from '../../server.js';
import { seedApprovedSplitCompany } from '../helpers/seedSplitCompany.js';

describe('Company API Routes (split schema)', () => {
  describe('GET /api/companies', () => {
    beforeEach(async () => {
      await seedApprovedSplitCompany({
        name: 'Google Inc.',
        type: 'FTE',
        business_model: 'B2C',
        eligibility: 'CS/IT students',
        date_of_visit: '2024-01-15',
        count: 50,
      });
      await seedApprovedSplitCompany({
        name: 'Microsoft Corp',
        nameKey: 'microsoft corp',
        type: 'Internship',
        business_model: 'B2B',
        eligibility: 'All branches',
        date_of_visit: '2024-02-20',
        count: 30,
      });
    });

    it('should get all approved companies (merged list)', async () => {
      const response = await request(app)
        .get('/api/companies')
        .expect(200);

      expect(response.body).toHaveLength(2);
      const names = response.body.map((c) => c.name).sort();
      expect(names).toEqual(['Google Inc.', 'Microsoft Corp'].sort());
      expect(response.body[0]).toHaveProperty('name');
      expect(response.body[0]).toHaveProperty('type');
      expect(response.body[0]).toHaveProperty('business_model');
      expect(response.body[0]).not.toHaveProperty('interviewQuestions');
      expect(response.body[0]).not.toHaveProperty('About The Company');
    });
  });

  describe('GET /api/companies/preview-logos', () => {
    beforeEach(async () => {
      await seedApprovedSplitCompany({
        name: 'Preview A',
        type: 'FTE',
        business_model: 'B2C',
        eligibility: 'CS',
        date_of_visit: '2024-01-15',
        count: 1,
      });
    });

    it('returns counts and logo slices for category tiles', async () => {
      const res = await request(app).get('/api/companies/preview-logos').expect(200);

      expect(res.body).toHaveProperty('counts');
      expect(res.body).toHaveProperty('logos');
      for (const key of [
        'dream',
        'openDream',
        'internshipOnly',
        'summerInternship',
        'offCampus',
      ]) {
        expect(res.body.counts).toHaveProperty(key);
        expect(typeof res.body.counts[key]).toBe('number');
        expect(res.body.logos).toHaveProperty(key);
        expect(Array.isArray(res.body.logos[key])).toBe(true);
        expect(res.body.logos[key].length).toBeLessThanOrEqual(5);
      }
    });
  });
});
