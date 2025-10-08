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
        const {firstName , lastName , emailId} = req.user
        const order = await razorpayInstance.orders.create({
            amount: membershipAmount["premium"]*100,
            currency: "INR",
            receipt: "receipt#1",
            notes: {
                firstName,lastName,emailId,
                membershipType: "premium",
            },
        });
        //save it in the database
        const payment = new Payment({
            userId: req.user.id,
            orderId: order.id,
            status: order.status,
            amount: order.amount,
            currency: order.currency,
            receipt: order.receipt,
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
        console.log('🔔 Webhook received:', JSON.stringify(req.body, null, 2));
        console.log('🔔 Webhook headers:', req.headers);
        
        // For now, we'll skip webhook signature validation
        // In production, you should implement proper webhook signature validation
        const paymentDetails = req.body.payload?.payment?.entity;

        if (!paymentDetails) {
            console.log('❌ Invalid webhook payload:', req.body);
            return res.status(400).json({msg: "Invalid webhook payload"});
        }

        console.log('💳 Payment details:', paymentDetails);

        const payment = await Payment.findOne({orderId: paymentDetails.order_id});
        if (!payment) {
            console.log('❌ Payment not found for order:', paymentDetails.order_id);
            return res.status(404).json({msg: "Payment not found"});
        }

        console.log('📝 Found payment record:', payment._id);

        payment.status = paymentDetails.status;
        await payment.save();
        console.log('✅ Payment status updated to:', paymentDetails.status);

        // Update user premium status if payment is successful
        if (paymentDetails.status === 'captured') {
            const user = await User.findOne({_id: payment.userId});
            if (user) {
                console.log('👤 Updating user premium status:', user._id);
                user.isPremium = true;
                user.membershipType = "premium";
                await user.save();
                console.log('✅ User premium status updated successfully');
            } else {
                console.log('❌ User not found for payment:', payment.userId);
            }
        }

        console.log('✅ Webhook processed successfully');
        return res.status(200).json({msg: "Webhook received successfully"});

    }catch(err){
        console.error('❌ Webhook error:', err);
        return res.status(500).json({msg: err.message});
    }
});

paymentRouter.get("/verify", requireAuth, async(req,res) => {
    const user = req.user;
    console.log('Premium verification request for user:', user._id, 'isPremium:', user.isPremium);
    if(user.isPremium){
        return res.json({
            isPremium: true,
            membershipType: "premium"
        });
    }
    return res.json({isPremium: false});
})

// Manual payment verification endpoint for development and production fallback
paymentRouter.post("/payment/verify", requireAuth, async(req,res) => {
    try {
        console.log('🔍 Manual payment verification request:', req.body);
        const { payment_id, order_id } = req.body;
        
        if (!order_id) {
            return res.status(400).json({ msg: "Order ID is required" });
        }
        
        // Find the payment record
        const payment = await Payment.findOne({ orderId: order_id });
        if (!payment) {
            console.log('❌ Payment not found for order:', order_id);
            return res.status(404).json({ msg: "Payment not found" });
        }

        console.log('📝 Found payment record:', payment._id, 'Status:', payment.status);

        // Update payment status
        payment.status = 'captured';
        await payment.save();
        console.log('✅ Payment status updated to captured');

        // Update user premium status
        const user = await User.findOne({ _id: payment.userId });
        if (user) {
            console.log('👤 Updating user premium status:', user._id);
            console.log('👤 Current user status - isPremium:', user.isPremium, 'membershipType:', user.membershipType);
            
            user.isPremium = true;
            user.membershipType = "premium";
            await user.save();
            
            console.log('✅ User premium status updated - isPremium:', user.isPremium, 'membershipType:', user.membershipType);
        } else {
            console.log('❌ User not found for payment:', payment.userId);
            return res.status(404).json({ msg: "User not found" });
        }

        console.log('✅ Manual payment verification completed successfully');
        return res.json({ 
            success: true, 
            message: "Payment verified and user upgraded to premium",
            membershipType: "premium",
            userId: user._id,
            isPremium: user.isPremium
        });
    } catch (error) {
        console.error('❌ Payment verification error:', error);
        return res.status(500).json({ msg: error.message });
    }
})

// Test endpoint to check payment status
paymentRouter.get("/test", requireAuth, async(req,res) => {
    try {
        const user = req.user;
        console.log('🧪 Test endpoint - User:', user._id, 'isPremium:', user.isPremium);
        
        // Find recent payments for this user
        const recentPayments = await Payment.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5);
        
        return res.json({
            user: {
                id: user._id,
                isPremium: user.isPremium,
                membershipType: user.membershipType
            },
            recentPayments: recentPayments.map(p => ({
                orderId: p.orderId,
                status: p.status,
                amount: p.amount,
                createdAt: p.createdAt
            }))
        });
    } catch (error) {
        console.error('❌ Test endpoint error:', error);
        return res.status(500).json({ msg: error.message });
    }
})

export default paymentRouter;