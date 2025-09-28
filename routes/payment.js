import express from 'express';
import dotenv from 'dotenv';
import razorpayInstance from "../utils/instance"
import Payment from '../models/orders';
import { membershipAmount } from '../utils/constants';
import User from '../models/User';

dotenv.config();
const paymentRouter = express.Router();

paymentRouter.post("/payment/create",async(req,res) => {
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


//this is the API called by webhook and hence login should not be applicable only for this api 
//make sure it is not inside login . that is what u should figure out . other than that everything is up and running once u get a razorpay dashboard
paymentRouter.post("/payment/webhook" , async(req,res) => {
    try{
        const webhookSignature = req.headers('X-Razorpay-Signature')
        const isWebhookValid = validateWebhookSignature(JSON.stringify(req.body),webhookSignature,process.env.WEBHOOK_SECRET);

        if(!isWebhookValid){
            return res.status(400).json({msg:"webhook signature is invalid"})
        }

        const paymentDetails = req.body.payload.payment.entity;

        const payment = await Payment.findOne({orderId: paymentDetails.order_id});
        payment.status = paymentDetails.status;
        await payment.save();

        const user = await User.findOne({_id: payment.userId});
        user.isPremium = true;
        user.membershipType = payment.notes.membershipType;
        await user.save();

        // if(req.body.event == "payment.captured"){

        // }
        // if(req.body.event == "payment.failed"){

        // }
        return res.status(200).json({msg: "Webhook recieved successfully"});

    }catch(err){
        return res.status(500).json({msg: err.message});
    }
});

paymentRouter.get("/premium/verify",async(req,res) => {
    const user = req.user;
    if(user.isPremium){
        return res.json({isPremium: true});
    }
    return res.json({isPremium: false});
})

export default paymentRouter;