import express from "express";
import { validateSignUpData } from "../utils/validation.js";
import User from "../models/User.js";
import bcrypt from "bcrypt";


const userRouter = express.Router();


userRouter.post("/signup", async (req, res) => {
    try {
        
        validateSignUpData(req);

        const {
            firstName,
            lastName,
            emailId,
            password
        } = req.body;

        
        const passwordHash = await bcrypt.hash(password, 10);
        console.log(passwordHash);

      
        const user = new User({
            firstName,
            lastName,
            emailId,
            password: passwordHash,
        });

        const savedUser = await user.save();
        const token = await savedUser.getJWT();

        res.cookie("token", token, {
            expires: new Date(Date.now() + 8 * 3600000),
        });

        res.json({
            message: "User Added successfully!",
            data: savedUser
        });
    } catch (err) {
        res.status(400).send("ERROR : " + err.message);
    }
});

userRouter.post("/login", async (req, res) => {
    try {
        const {
            emailId,
            password
        } = req.body;

        const user = await User.findOne({
            emailId: emailId
        });
        if (!user) {
            throw new Error("Invalid credentials");
        }
        const isPasswordValid = await user.validatePassword(password);

        if (isPasswordValid) {
            const token = await user.getJWT();

            res.cookie("token", token, {
                expires: new Date(Date.now() + 8 * 3600000),
            });
            res.send(user);
        } else {
            throw new Error("Invalid credentials");
        }
    } catch (err) {
        res.status(400).send("ERROR : " + err.message);
    }
});


userRouter.post("/logout", async (req, res) => {
  res.cookie("token", null, { expires: new Date(Date.now()) });
  res.send("Logout Successful!!");
});

export default userRouter;
