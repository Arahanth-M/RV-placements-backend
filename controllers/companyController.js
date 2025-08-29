import Company from '../models/Company.js';

export async function createCompany(req, res) {
  try {
    const company = await Company.create(req.body);
    console.log('the endpoint is being hit');
    return res.status(201).json(company);
  } catch (e) {
    console.log('some error occured ');
    return res.status(400).json({ error: e.message });
  }
}

export async function hello(req, res) {
  res.send('hi from the server');
}
