import express from 'express';
import dotenv from 'dotenv';
import razorpayInstance from "../utils/instance.js"
import Payment from '../models/orders.js';
import { membershipAmount } from '../utils/constants.js';
import User from '../models/User.js';
import requireAuth from '../middleware/requireAuth.js';

dotenv.config();
const paymentRouter = express.Router();

paymentRouter.post("/create", requireAuth, async(req,res) => {
    try{
        const {membershipType} = req.body;
        const {firstName , lastName , emailId} = req.user
        const order = await razorpayInstance.orders.create({
            amount: membershipAmount[membershipType]*100,
            currency: "INR",
            receipt: "receipt#1",
            notes: {
                firstName,lastName,emailId,
                membershipType: membershipType,
            },
        });
        //save it in the database
        const payment = new Payment({
            userId: req.user.id,
            orderId: order.id,
            status: order.status,
            amount: order.amount,
            currency: order.currency,
            reciept: order.receipt,
            notes: order.notes
        });
        const savedPayment = await payment.save();

        //return back my order details to frontend
        res.json({...savedPayment.toJSON(),keyId : process.env.RAZORPAY_KEY_ID});

    }catch(err){
        return res.status(500).json({msg: err.message});
    }
});


// Webhook endpoint for Razorpay payment verification
// Note: This endpoint should not require authentication as it's called by Razorpay
paymentRouter.post("/webhook", async(req,res) => {
    try{
        // For now, we'll skip webhook signature validation
        // In production, you should implement proper webhook signature validation
        const paymentDetails = req.body.payload?.payment?.entity;

        if (!paymentDetails) {
            return res.status(400).json({msg: "Invalid webhook payload"});
        }

        const payment = await Payment.findOne({orderId: paymentDetails.order_id});
        if (!payment) {
            return res.status(404).json({msg: "Payment not found"});
        }

        payment.status = paymentDetails.status;
        await payment.save();

        // Update user premium status if payment is successful
        if (paymentDetails.status === 'captured') {
            const user = await User.findOne({_id: payment.userId});
            if (user) {
                user.isPremium = true;
                user.membershipType = payment.notes.membershipType;
                await user.save();
            }
        }

        return res.status(200).json({msg: "Webhook received successfully"});

    }catch(err){
        console.error('Webhook error:', err);
        return res.status(500).json({msg: err.message});
    }
});

paymentRouter.get("/verify", requireAuth, async(req,res) => {
    const user = req.user;
    if(user.isPremium){
        return res.json({
            isPremium: true,
            membershipType: user.membershipType || 'silver' // Default to silver if not specified
        });
    }
    return res.json({isPremium: false});
})

export default paymentRouter;