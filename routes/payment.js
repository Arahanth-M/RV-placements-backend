// import express from 'express';
// import dotenv from 'dotenv';

// dotenv.config();
// const paymentRouter = express.Router();

// paymentRouter.post("/payment/create",async(req,res) => {
//     try{
//         const order = await razorpayInstance.orders.create({
//             amount: 70000,
//             currency: "INR",
//             receipt: "receipt#1",
//             notes: {
//                 firstName: "value1",
//                 lastName: "value2",
//                 memberShipType: "silver",
//             },
//         });
//         //save it in the database
//         console.log(order);
//         //return back my order details to frontend
//         res.json({order});

//     }catch(err){
//         return res.status(500).json({msg: err.message});
//     }
// });

// export default paymentRouter;