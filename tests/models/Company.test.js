import mongoose from 'mongoose';
import Company from '../../models/Company.js';

describe('Company Model', () => {
  beforeEach(async () => {
    // Clear any existing companies
    await Company.deleteMany({});
  });

  describe('Company Creation', () => {
    it('should create a company with valid data', async () => {
      const companyData = {
        name: 'Google Inc.',
        type: 'FTE',
        business_model: 'B2C',
        eligibility: 'CS/IT students with 70%+ marks',
        date_of_visit: '2024-01-15',
        count: 50
      };

      const company = new Company(companyData);
      const savedCompany = await company.save();

      expect(savedCompany._id).toBeDefined();
      expect(savedCompany.name).toBe(companyData.name);
      expect(savedCompany.type).toBe(companyData.type);
      expect(savedCompany.business_model).toBe(companyData.business_model);
    });

    it('should fail validation when name is missing', async () => {
      const companyData = {
        type: 'FTE',
        business_model: 'B2C'
      };

      const company = new Company(companyData);
      
      await expect(company.save()).rejects.toThrow();
    });

    it('should fail validation when name is too short', async () => {
      const companyData = {
        name: 'A',
        type: 'FTE',
        business_model: 'B2C'
      };

      const company = new Company(companyData);
      
      await expect(company.save()).rejects.toThrow(/at least 2 characters/);
    });

    it('should fail validation when name is too long', async () => {
      const companyData = {
        name: 'A'.repeat(51), // 51 characters
        type: 'FTE',
        business_model: 'B2C'
      };

      const company = new Company(companyData);
      
      await expect(company.save()).rejects.toThrow(/cannot exceed 50 characters/);
    });

    it('should fail validation when type is missing', async () => {
      const companyData = {
        name: 'Google Inc.',
        business_model: 'B2C'
      };

      const company = new Company(companyData);
      
      await expect(company.save()).rejects.toThrow();
    });
  });

  describe('Company Schema Validation', () => {
    it('should trim whitespace from name', async () => {
      const companyData = {
        name: '  Google Inc.  ',
        type: 'FTE',
        business_model: 'B2C'
      };

      const company = new Company(companyData);
      const savedCompany = await company.save();

      expect(savedCompany.name).toBe('Google Inc.');
    });

    it('should accept valid business models', async () => {
      const companyData = {
        name: 'Microsoft Corp',
        type: 'FTE',
        business_model: 'B2B'
      };

      const company = new Company(companyData);
      const savedCompany = await company.save();

      expect(savedCompany.business_model).toBe('B2B');
    });

    it('should limit eligibility to 500 characters', async () => {
      const companyData = {
        name: 'Apple Inc',
        type: 'FTE',
        business_model: 'B2C',
        eligibility: 'A'.repeat(501) // 501 characters
      };

      const company = new Company(companyData);
      
      await expect(company.save()).rejects.toThrow(/maximum allowed length/);
    });
  });

  describe('Company Field Constraints', () => {
    it('should handle missing optional fields', async () => {
      const companyData = {
        name: 'Meta Platforms',
        type: 'Internship'
      };

      const company = new Company(companyData);
      const savedCompany = await company.save();

      expect(savedCompany.business_model).toBeUndefined();
      expect(savedCompany.eligibility).toBeUndefined();
      expect(savedCompany.count).toBeUndefined();
    });

    it('should accept numeric count field', async () => {
      const companyData = {
        name: 'Amazon Inc',
        type: 'FTE',
        count: 100
      };

      const company = new Company(companyData);
      const savedCompany = await company.save();

      expect(savedCompany.count).toBe("100"); // Count is stored as string
    });

    it('should accept date_of_visit field', async () => {
      const companyData = {
        name: 'Netflix Inc',
        type: 'FTE',
        date_of_visit: '2024-02-20'
      };

      const company = new Company(companyData);
      const savedCompany = await company.save();

      expect(savedCompany.date_of_visit).toBe('2024-02-20');
    });
  });

  describe('Company Query Operations', () => {
    beforeEach(async () => {
      // Seed test data
      await Company.insertMany([
        {
          name: 'Google Inc.',
          type: 'FTE',
          business_model: 'B2C',
          eligibility: 'CS/IT students',
          count: 50
        },
        {
          name: 'Microsoft Corp',
          type: 'Internship',
          business_model: 'B2B',
          eligibility: 'All branches',
          count: 30
        },
        {
          name: 'Amazon Inc',
          type: 'FTE',
          business_model: 'B2C',
          eligibility: 'CS/IT students',
          count: 75
        }
      ]);
    });

    it('should find companies by type', async () => {
      const fteCompanies = await Company.find({ type: 'FTE' });
      
      expect(fteCompanies).toHaveLength(2);
      expect(fteCompanies.map(c => c.name)).toContain('Google Inc.');
      expect(fteCompanies.map(c => c.name)).toContain('Amazon Inc');
    });

    it('should find companies by business model', async () => {
      const b2cCompanies = await Company.find({ business_model: 'B2C' });
      
      expect(b2cCompanies).toHaveLength(2);
      expect(b2cCompanies.map(c => c.name)).toContain('Google Inc.');
      expect(b2cCompanies.map(c => c.name)).toContain('Amazon Inc');
    });

    it('should find companies by count greater than specified value', async () => {
      const highCountCompanies = await Company.find({ count: { $gt: 40 } });
      
      expect(highCountCompanies).toHaveLength(2);
      expect(highCountCompanies.map(c => c.name)).toContain('Google Inc.');
      expect(highCountCompanies.map(c => c.name)).toContain('Amazon Inc');
    });

    it('should sort companies by count in descending order', async () => {
      const sortedCompanies = await Company.find({}).sort({ count: -1 });
      
      expect(sortedCompanies[0].count).toBe("75"); // Amazon
      expect(sortedCompanies[1].count).toBe("50"); // Google
      expect(sortedCompanies[2].count).toBe("30"); // Microsoft
    });
  });
});
