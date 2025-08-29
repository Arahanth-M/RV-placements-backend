// import express from "express";
// import cors from "cors";
// import { connectDB } from "./config/db.js";
// import Company from "./models/Company.js";
// const app = express();
// app.use(cors());
// app.use(express.json());

// app.get("/hello",(req,res) => {
//     console.log("hello");
//     return res.send("hi");
// })

// app.post("/api/companies",async (req,res) => {
//     try {
//         const company = await Company.create(req.body);
//         console.log('the endpoint is being hit');
//         return res.status(201).json(company);
//       } catch (e) {
//         console.log('some error occured ');
//         return res.status(400).json({ error: e.message });
//       }


// } );        
// const PORT =  7779;
// const MONGO_URI="mongodb+srv://Arahanth:MftpTuEzF7ILWZcY@nodejs.dkfd9.mongodb.net/RV-placements?retryWrites=true&w=majority&appName=NodeJS";


// connectDB(MONGO_URI).then(() => {
//   app.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));
// });



import express from "express";
import cors from "cors";
import { connectDB } from "./config/db.js";
import Company from "./models/Company.js";

const app = express();
app.use(cors({
  origin: "http://localhost:5173",   // your frontend vite dev server
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
app.use(express.json());




// 🔹 Create a new company
app.post("/api/companies", async (req, res) => {
  try {
    const company = await Company.create(req.body);
    console.log("✅ New company created");
    return res.status(201).json(company);
  } catch (e) {
    console.error("❌ Error creating company:", e.message);
    return res.status(400).json({ error: e.message });
  }
});

// 🔹 Get all companies (for cards)
app.get("/api/companies", async (req, res) => {
  try {
    // only return essential fields for cards
    const companies = await Company.find({}, "name type eligibility roles count");
    
    return res.json(companies);
  } catch (e) {
    console.error("❌ Error fetching companies:", e.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// 🔹 Get a single company by ID (for details page)
app.get("/api/companies/:id", async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }
    return res.json(company);
  } catch (e) {
    console.error("❌ Error fetching company:", e.message);
    return res.status(400).json({ error: "Invalid company ID" });
  }
});

// 🔹 Server + DB connection
const PORT = 7779;
const MONGO_URI =
  "mongodb+srv://Arahanth:MftpTuEzF7ILWZcY@nodejs.dkfd9.mongodb.net/RV-placements?retryWrites=true&w=majority&appName=NodeJS";

connectDB(MONGO_URI).then(() => {
  app.listen(PORT, () =>
    console.log(`🚀 Server running on http://localhost:${PORT}`)
  );
});

