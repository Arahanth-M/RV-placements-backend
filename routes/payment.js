// PAYMENT GATEWAY INTEGRATION - COMMENTED OUT
// import express from 'express';
// import dotenv from 'dotenv';
// import crypto from 'crypto';
// import razorpayInstance from "../utils/instance.js"
// import Payment from '../models/orders.js';
// import { membershipAmount } from '../utils/constants.js';
// import User from '../models/User.js';
// import requireAuth from '../middleware/requireAuth.js';

// dotenv.config();
import express from 'express';
const paymentRouter = express.Router();

// PAYMENT GATEWAY INTEGRATION - ALL ROUTES COMMENTED OUT
// // Webhook signature validation function
// const verifyWebhookSignature = (body, signature, secret) => {
//     const expectedSignature = crypto
//         .createHmac('sha256', secret)
//         .update(body)
//         .digest('hex');
//     
//     return crypto.timingSafeEqual(
//         Buffer.from(signature, 'hex'),
//         Buffer.from(expectedSignature, 'hex')
//     );
// };

// paymentRouter.post("/create", requireAuth, async(req,res) => {
//     try{
//         const {firstName , lastName , emailId} = req.user
//         const order = await razorpayInstance.orders.create({
//             amount: membershipAmount["premium"]*100,
//             currency: "INR",
//             receipt: "receipt#1",
//             notes: {
//                 firstName,lastName,emailId,
//                 membershipType: "premium",
//             },
//         });
//         //save it in the database
//         const payment = new Payment({
//             userId: req.user.id,
//             orderId: order.id,
//             status: order.status,
//             amount: order.amount,
//             currency: order.currency,
//             receipt: order.receipt,
//             notes: order.notes
//         });
//         const savedPayment = await payment.save();

//         //return back my order details to frontend
//         res.json({...savedPayment.toJSON(),keyId : process.env.RAZORPAY_KEY_ID});

//     }catch(err){
//         return res.status(500).json({msg: err.message});
//     }
// });


// // Webhook endpoint for Razorpay payment verification
// // Note: This endpoint should not require authentication as it's called by Razorpay
// paymentRouter.post("/webhook", express.raw({type: 'application/json'}), async(req,res) => {
//     try{
//         const signature = req.headers['x-razorpay-signature'];
//         const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        
//         console.log('🔔 Webhook received');
//         console.log('🔔 Webhook signature:', signature);
//         console.log('🔔 Webhook body length:', req.body.length);
        
//         // Parse the raw body
//         const body = JSON.parse(req.body.toString());
//         console.log('🔔 Webhook payload:', JSON.stringify(body, null, 2));
        
//         // Verify webhook signature if secret is available
//         if (webhookSecret && signature) {
//             const isValidSignature = verifyWebhookSignature(req.body, signature, webhookSecret);
//             if (!isValidSignature) {
//                 console.log('❌ Invalid webhook signature');
//                 return res.status(400).json({msg: "Invalid webhook signature"});
//             }
//             console.log('✅ Webhook signature verified');
//         } else {
//             console.log('⚠️ Skipping webhook signature validation (no secret or signature provided)');
//         }
        
//         // Razorpay webhook payload structure
//         const event = body.event;
//         const paymentDetails = body.payload?.payment?.entity;

//         if (!event || !paymentDetails) {
//             console.log('❌ Invalid webhook payload:', body);
//             return res.status(400).json({msg: "Invalid webhook payload"});
//         }

//         console.log('📅 Event:', event);
//         console.log('💳 Payment details:', paymentDetails);

//         // Only process payment.captured events
//         if (event !== 'payment.captured') {
//             console.log('ℹ️ Ignoring non-capture event:', event);
//             return res.status(200).json({msg: "Event ignored"});
//         }

//         const payment = await Payment.findOne({orderId: paymentDetails.order_id});
//         if (!payment) {
//             console.log('❌ Payment not found for order:', paymentDetails.order_id);
//             return res.status(404).json({msg: "Payment not found"});
//         }

//         console.log('📝 Found payment record:', payment._id);

//         // Update payment status
//         payment.status = paymentDetails.status;
//         payment.paymentId = paymentDetails.id;
//         payment.method = paymentDetails.method;
//         await payment.save();
//         console.log('✅ Payment status updated to:', paymentDetails.status);

//         // Update user premium status if payment is successful
//         if (paymentDetails.status === 'captured') {
//             const user = await User.findOne({_id: payment.userId});
//             if (user) {
//                 console.log('👤 Updating user premium status:', user._id);
//                 console.log('👤 Current user status - isPremium:', user.isPremium, 'membershipType:', user.membershipType);
                
//                 user.isPremium = true;
//                 user.membershipType = "premium";
//                 await user.save();
                
//                 console.log('✅ User premium status updated - isPremium:', user.isPremium, 'membershipType:', user.membershipType);
//             } else {
//                 console.log('❌ User not found for payment:', payment.userId);
//             }
//         }

//         console.log('✅ Webhook processed successfully');
//         return res.status(200).json({msg: "Webhook received successfully"});

//     }catch(err){
//         console.error('❌ Webhook error:', err);
//         return res.status(500).json({msg: err.message});
//     }
// });

// paymentRouter.get("/verify", requireAuth, async(req,res) => {
//     const user = req.user;
//     console.log('Premium verification request for user:', user._id, 'isPremium:', user.isPremium);
//     if(user.isPremium){
//         return res.json({
//             isPremium: true,
//             membershipType: "premium"
//         });
//     }
//     return res.json({isPremium: false});
// })

// // Manual payment verification endpoint for development and production fallback
// paymentRouter.post("/payment/verify", requireAuth, async(req,res) => {
//     try {
//         console.log('🔍 Manual payment verification request:', req.body);
//         const { payment_id, order_id } = req.body;
        
//         if (!order_id) {
//             return res.status(400).json({ msg: "Order ID is required" });
//         }
        
//         // Find the payment record
//         const payment = await Payment.findOne({ orderId: order_id });
//         if (!payment) {
//             console.log('❌ Payment not found for order:', order_id);
//             return res.status(404).json({ msg: "Payment not found" });
//         }

//         console.log('📝 Found payment record:', payment._id, 'Status:', payment.status);

//         // Verify payment with Razorpay
//         try {
//             const razorpayPayment = await razorpayInstance.payments.fetch(payment_id);
//             console.log('🔍 Razorpay payment details:', razorpayPayment);
            
//             if (razorpayPayment.status === 'captured') {
//                 // Update payment status
//                 payment.status = 'captured';
//                 payment.paymentId = payment_id;
//                 payment.method = razorpayPayment.method;
//                 await payment.save();
//                 console.log('✅ Payment status updated to captured');

//                 // Update user premium status
//                 const user = await User.findOne({ _id: payment.userId });
//                 if (user) {
//                     console.log('👤 Updating user premium status:', user._id);
//                     console.log('👤 Current user status - isPremium:', user.isPremium, 'membershipType:', user.membershipType);
                    
//                     user.isPremium = true;
//                     user.membershipType = "premium";
//                     await user.save();
                    
//                     console.log('✅ User premium status updated - isPremium:', user.isPremium, 'membershipType:', user.membershipType);
                    
//                     console.log('✅ Manual payment verification completed successfully');
//                     return res.json({ 
//                         success: true, 
//                         message: "Payment verified and user upgraded to premium",
//                         membershipType: "premium",
//                         userId: user._id,
//                         isPremium: user.isPremium
//                     });
//                 } else {
//                     console.log('❌ User not found for payment:', payment.userId);
//                     return res.status(404).json({ msg: "User not found" });
//                 }
//             } else {
//                 console.log('❌ Payment not captured, status:', razorpayPayment.status);
//                 return res.status(400).json({ msg: "Payment not captured" });
//             }
//         } catch (razorpayError) {
//             console.error('❌ Razorpay verification error:', razorpayError);
//             // Fallback: just update the payment status without Razorpay verification
//             payment.status = 'captured';
//             payment.paymentId = payment_id;
//             await payment.save();
            
//             const user = await User.findOne({ _id: payment.userId });
//             if (user) {
//                 user.isPremium = true;
//                 user.membershipType = "premium";
//                 await user.save();
                
//                 return res.json({ 
//                     success: true, 
//                     message: "Payment verified and user upgraded to premium (fallback mode)",
//                     membershipType: "premium",
//                     userId: user._id,
//                     isPremium: user.isPremium
//                 });
//             }
//         }
//     } catch (error) {
//         console.error('❌ Payment verification error:', error);
//         return res.status(500).json({ msg: error.message });
//     }
// })

// // Force refresh premium status endpoint
// paymentRouter.post("/refresh-status", requireAuth, async(req,res) => {
//     try {
//         const user = req.user;
//         console.log('🔄 Force refresh premium status for user:', user._id);
        
//         // Find the most recent successful payment for this user
//         const recentPayment = await Payment.findOne({ 
//             userId: user._id, 
//             status: 'captured' 
//         }).sort({ createdAt: -1 });
        
//         if (recentPayment) {
//             console.log('💳 Found successful payment:', recentPayment._id);
            
//             // Update user premium status
//             user.isPremium = true;
//             user.membershipType = "premium";
//             await user.save();
            
//             console.log('✅ User premium status refreshed - isPremium:', user.isPremium, 'membershipType:', user.membershipType);
            
//             return res.json({
//                 success: true,
//                 message: "Premium status refreshed successfully",
//                 isPremium: true,
//                 membershipType: "premium"
//             });
//         } else {
//             console.log('❌ No successful payment found for user');
//             user.isPremium = false;
//             user.membershipType = null;
//             await user.save();
            
//             return res.json({
//                 success: true,
//                 message: "No successful payment found, premium status reset",
//                 isPremium: false,
//                 membershipType: null
//             });
//         }
//     } catch (error) {
//         console.error('❌ Refresh status error:', error);
//         return res.status(500).json({ msg: error.message });
//     }
// });

// // Test endpoint to check payment status
// paymentRouter.get("/test", requireAuth, async(req,res) => {
//     try {
//         const user = req.user;
//         console.log('🧪 Test endpoint - User:', user._id, 'isPremium:', user.isPremium);
        
//         // Find recent payments for this user
//         const recentPayments = await Payment.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5);
        
//         return res.json({
//             user: {
//                 id: user._id,
//                 isPremium: user.isPremium,
//                 membershipType: user.membershipType
//             },
//             recentPayments: recentPayments.map(p => ({
//                 orderId: p.orderId,
//                 status: p.status,
//                 amount: p.amount,
//                 createdAt: p.createdAt
//             }))
//         });
//     } catch (error) {
//         console.error('❌ Test endpoint error:', error);
//         return res.status(500).json({ msg: error.message });
//     }
// })

export default paymentRouter;
